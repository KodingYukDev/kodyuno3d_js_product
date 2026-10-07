import * as avr from 'avr8js'
import type { Hardware, PinMode } from '../cpp/hardware'
import { avrProfile, createAvrBoard } from './avrBoard.mjs'
import { attachUnoBuses } from './buses.mjs'
import { Ili9341, MifareClassic, Mfrc522 } from '../spiDevices'
import { FatImage, SdCard, type SdFile } from '../sdCard'
import { parseRfidUid } from '../rfidUid'
import { Ds18b20, OneWireBus } from '../oneWire'
import { captureFor, type LogicCapture } from '../logicAnalyzer'
import { pulseWaveCounts } from '../interpreter/analogModel'
import {
  createHx711, Max7219Chain, matrixPatch, createNeoPixelDecoder, createSignalDecoder, dhtFrame, dhtWaveform, DHT_START_MIN_CYCLES,
  bounceWaveform, echoWaveform, encoderWaveforms, necWaveform, waveformLevel, type InputWaveform, type PinRole,
} from './signalModels'

export interface FirmwareRunOptions {
  /**
   * Run the next slice. Returns a cancel function. Defaults to a MessageChannel
   * while the emulator is behind real time (no 4ms timer clamp, no background
   * throttling) and a timer once it has caught up (no busy spinning).
   */
  schedule?: (task: () => void, behind: boolean) => () => void
  /** Follow the wall clock (default). Off: exactly 1ms simulated per slice (tests). */
  paced?: boolean
}

/**
 * EEPROM keeps its contents across runs and page reloads, like the chip keeps
 * them across power cycles. One image per board model, in localStorage.
 */
const eepromImages = new Map<string, Uint8Array>()
function eepromFor(board: string, size: number): Uint8Array {
  let image = eepromImages.get(board)
  if (!image || image.length !== size) {
    image = new Uint8Array(size).fill(0xff)
    try {
      const saved = globalThis.localStorage?.getItem(`kodyuno-eeprom-${board}`)
      if (saved) { const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0)); if (bytes.length === size) image = bytes }
    } catch { /* storage unavailable: start erased */ }
    eepromImages.set(board, image)
  }
  return image
}
function saveEeprom(board: string, image: Uint8Array) {
  eepromImages.set(board, image)
  try {
    let binary = ''
    for (let i = 0; i < image.length; i += 4096) binary += String.fromCharCode(...image.subarray(i, i + 4096))
    globalThis.localStorage?.setItem(`kodyuno-eeprom-${board}`, btoa(binary))
  } catch { /* storage unavailable */ }
}
/** Erase the stored EEPROM of a board (all 0xFF), as a fresh chip. */
export function eraseEeprom(board: string) {
  eepromImages.delete(board)
  try { globalThis.localStorage?.removeItem(`kodyuno-eeprom-${board}`) } catch { /* ignore */ }
}

const UNO_CYCLES_PER_MS = 16000
/** After a stall (tab hidden, slow device) catch up at most this much at once. */
const MAX_CATCH_UP_MS = 250

function defaultSchedule(task: () => void, behind: boolean): () => void {
  if (behind && typeof MessageChannel !== 'undefined') {
    const channel = new MessageChannel()
    let live = true
    channel.port1.onmessage = () => { channel.port1.close(); if (live) task() }
    channel.port2.postMessage(0)
    return () => { live = false; channel.port1.close() }
  }
  const id = setTimeout(task, 0)
  return () => clearTimeout(id)
}

/** Cooperative main-thread runner paced to real time, <=8ms wall per slice.
 * Pin outputs are published every 256 cycles (16µs); circuit inputs are sampled
 * every 2048 cycles (128µs) except sensor replies, which stay 16µs-accurate.
 * Not a cycle-exact circuit model.
 * Parts that depend on signal shape (PWM, servo, buzzer, HC-SR04, DHT,
 * NeoPixel) are decoded from what the firmware drives on the pins — see
 * signalModels.ts.
 */
export function startAvrFirmware(hex: string, hardware: Hardware, onError: (message: string) => void, options: FirmwareRunOptions = {}) {
  const schedule = options.schedule ?? defaultSchedule
  const paced = options.paced ?? true
  // Uno/Nano (ATmega328P) and Mega 2560 (ATmega2560), all at 16 MHz.
  const profile = avrProfile(avr, hardware.board.id)
  if (!profile) throw new Error('Firmware AVR mendukung Arduino Uno, Nano dan Mega 2560.')
  let active = true
  let cancelNext: (() => void) | undefined
  let syncCount = 0
  const inputLevel: boolean[] = []
  /** UART bytes not yet handed to the monitor; decoded as UTF-8 when flushed. */
  let serialBytes: number[] = []
  const serialDecoder = new TextDecoder('utf-8')
  // WS2812 bits are ~20 cycles long, far below the 256-cycle sync step, so
  // NeoPixel pins are decoded from the exact port-write cycle instead.
  const neoPixels = new Map<number, ReturnType<typeof createNeoPixelDecoder>>()
  // MAX7219 matrices, also decoded per port write (shiftOut is µs-fast).
  const matrices = new Map<string, { din: number; clk: number; cs: number; chain: Max7219Chain; publish: () => void }>()
  /**
   * SPI chips modelled at register level (RC522, ILI9341). Chip select, D/C
   * and reset come from the exact port-write latch, so a CS pulse between
   * two register accesses is never missed.
   */
  type SpiChip = { cs: number; dc: number; rst: number; lastCs: number; lastRst: number; published: number; lastPublishedAt: number } &
    ({ kind: 'rfid'; chip: Mfrc522 } | { kind: 'tft'; chip: Ili9341 } | { kind: 'sd'; chip: SdCard })
  const spiChips = new Map<string, SpiChip>()
  /** MIFARE cards by UID, so data written to a card survives taking it off the reader. */
  const cards = new Map<string, MifareClassic>()
  let spiPublishedAt = 0
  /** Logic analyzers: channel pins sampled on every port write and sync step. */
  const analyzers = new Map<string, { capture: LogicCapture; published: number }>()
  let analyzersPublishedAt = 0
  const sampleAnalyzers = (cycle: number) => {
    for (const { capture } of analyzers.values()) {
      let mask = 0
      for (let ch = 0; ch < 8; ch++) {
        const pin = capture.channels[ch]
        if (pin < 0) continue
        // Outputs: the driven latch (timer outputs included); inputs: the pin itself.
        const level = uno.isOutput(pin) ? latch[pin] : uno.inputLevel(pin)
        mask |= level << ch
      }
      capture.record(cycle, mask)
    }
  }
  /** HX711 load-cell amplifiers: SCK edges from port writes, DOUT driven back at once. */
  const loadCells = new Map<string, { dt: number; sck: number; lastSck: number; chip: ReturnType<typeof createHx711> }>()
  /**
   * 1-Wire buses (DS18B20) by DQ pin. The master's pull comes from the exact
   * port/DDR write; the sensors' replies are timed with CPU clock events.
   */
  const oneWireBuses = new Map<number, { ids: string; bus: OneWireBus }>()
  const ds18b20s = new Map<string, Ds18b20>()
  /** Output latch level of every pin, kept current by port writes. */
  const latch: number[] = new Array(profile.pins.length).fill(0)
  const seedLatch = () => { for (let pin = 0; pin < latch.length; pin++) latch[pin] = uno.portLatch(pin) }
  const uno = createAvrBoard(avr, hex, profile, {
    eeprom: eepromFor(profile.id, profile.eepromBytes),
    onUart: ({ byte }) => { serialBytes.push(byte) },
    onGpio: ({ port, value, cycle }) => {
      dirtyPorts.add(port)
      if (!neoPixels.size && !matrices.size && !spiChips.size && !loadCells.size && !analyzers.size && !oneWireBuses.size) return
      const onPort = uno.portPins[port]
      if (!onPort) return
      for (let bit = 0; bit < 8; bit++) if (onPort[bit] >= 0) latch[onPort[bit]] = (value >> bit) & 1
      for (const cell of loadCells.values()) {
        if (latch[cell.sck] === cell.lastSck) continue
        cell.lastSck = latch[cell.sck]
        uno.setDigitalInput(cell.dt, cell.chip.clock(cell.lastSck === 1, cycle) === 1)
      }
      if (analyzers.size) sampleAnalyzers(cycle)
      for (const [pin, { bus }] of oneWireBuses) bus.master(uno.isOutput(pin) === 1 && latch[pin] === 0, cycle)
      for (const entry of spiChips.values()) {
        if (latch[entry.cs] && !entry.lastCs) entry.chip.deselect()
        if (entry.rst >= 0 && latch[entry.rst] && !entry.lastRst) entry.chip.reset() // NRSTPD LOW→HIGH: hard reset
        entry.lastCs = latch[entry.cs]
        if (entry.rst >= 0) entry.lastRst = latch[entry.rst]
      }
      for (const matrix of matrices.values()) if (matrix.chain.update(latch[matrix.din], latch[matrix.clk], latch[matrix.cs])) matrix.publish()
      for (const [pin, decoder] of neoPixels) {
        const [letter, bit] = uno.portOf(pin)
        if (letter === port) decoder.edge((value >> bit) & 1, cycle)
      }
    },
    // Hardware interface supplies 10-bit counts relative to nominal Uno 5V.
    // Feed voltage to peripheral; firmware-selected reference still applies.
    readAnalogVoltage: channel => {
      // A pulse sensor is a waveform, not a level: sample it at this cycle.
      const heart = hardware.componentOn('heart_sensor', `A${channel}`, 'signal')
      if (heart?.powered) return pulseWaveCounts(uno.cpu.cycles / 16e6, Number(heart.state.bpm)) * 5 / 1023
      return Math.max(0, Math.min(1023, hardware.analogRead(`A${channel}`))) * 5 / 1023
    },
  })
  const modes: (PinMode | undefined)[] = []
  const values: (number | undefined)[] = []
  const pwm = new Map<number, number>()
  const pinId = (pin: number) => uno.pinId(pin)
  const pinCount = uno.pinCount

  // Which pins feed a signal-level part, and where each HC-SR04 echoes back.
  const echoPinOf = new Map<number, number>()
  /** Sensor replies currently being driven onto input pins. */
  const waveforms = new Map<number, InputWaveform>()
  /** DHT data pins → sensor id/type, and when the host started pulling LOW. */
  const dhtPins = new Map<number, { id: string; type: 'dht11' | 'dht22' }>()
  /** Last IR frame counter seen per receiver, so each button press plays once. */
  const irSeen = new Map<string, number>()
  const lowSince = new Map<number, number>()
  /** Inputs wired to switch contacts that bounce when they change. */
  const bouncyPins = new Set<number>()
  /** Pins with something wired to them; the rest float and only see their pull-up. */
  let wiredPins: boolean[] = []
  /** Ports written since the last sync: only their pins can have changed state. */
  const dirtyPorts = new Set<string>(Object.keys(profile.ports))
  /** Input level last pushed into each pin; setting an unchanged level is skipped (hot path). */
  const applied: (boolean | undefined)[] = []
  const drive = (pin: number, high: boolean) => { if (applied[pin] !== high) { applied[pin] = high; uno.setDigitalInput(pin, high) } }
  /** Detent position already played to the firmware, per rotary encoder. */
  const encoderSeen = new Map<string, number>()
  const decoder = createSignalDecoder({
    servoAngle(pin, angle) {
      hardware.analogWrite(pinId(pin), Math.round((angle / 180) * 255))
      const part = hardware.componentOn('servo', pinId(pin), 'signal')
      if (part?.powered) hardware.patchComponent(part.id, { angle })
    },
    tone: (pin, frequency) => hardware.tone(pinId(pin), frequency),
    noTone: pin => hardware.noTone(pinId(pin)),
    echo(trigPin, start, end) {
      const echoPin = echoPinOf.get(trigPin)
      if (echoPin !== undefined) waveforms.set(echoPin, echoWaveform(start, end))
    },
  }, trigPin => {
    const part = hardware.componentOn('ultrasonic', pinId(trigPin), 'trig')
    const distance = Number(part?.state.distanceCm)
    return part?.powered && Number.isFinite(distance) ? distance : 0
  })
  let rolesCheckedAt = -Infinity
  const refreshRoles = () => {
    const roles = new Map<number, PinRole>()
    echoPinOf.clear()
    dhtPins.clear()
    const neoPins = new Set<number>()
    for (let pin = 0; pin < pinCount; pin++) {
      const id = pinId(pin)
      if (hardware.componentOn('servo', id, 'signal')) roles.set(pin, 'servo')
      else if (hardware.componentOn('buzzer', id, 'signal')) roles.set(pin, 'buzzer')
      for (const type of ['dht11', 'dht22'] as const) {
        const dht = hardware.componentOn(type, id, 'data')
        if (dht?.powered) dhtPins.set(pin, { id: dht.id, type })
      }
      if (['neopixel', 'neopixel_matrix', 'led_ring'].some(type => hardware.componentOn(type, id, 'din'))) neoPins.add(pin)
      const ir = hardware.componentOn('ir_receiver', id, 'out')
      if (ir?.powered) {
        const seq = Number(ir.state.sendSeq ?? 0)
        const seen = irSeen.get(ir.id)
        if (seen !== undefined && seq !== seen) {
          waveforms.set(pin, necWaveform(uno.cpu.cycles + 1600, Number(ir.state.address ?? 0), Number(ir.state.code ?? 0)))
        }
        irSeen.set(ir.id, seq)
      }
      const sonar = hardware.componentOn('ultrasonic', id, 'trig')
      if (sonar) {
        roles.set(pin, 'ultrasonic-trig')
        for (let echo = 0; echo < pinCount; echo++) {
          if (hardware.componentOn('ultrasonic', pinId(echo), 'echo')?.id === sonar.id) echoPinOf.set(pin, echo)
        }
      }
    }
    decoder.setRoles(roles)
    wiredPins = Array.from({ length: pinCount }, (_, pin) => hardware.pinWired ? hardware.pinWired(pinId(pin)) : true)
    bouncyPins.clear()
    for (const type of ['pushbutton', 'slide_switch'] as const) {
      for (const part of hardware.componentsOfType(type)) {
        if (part.state.noBounce === true) continue
        for (const role of ['signal', 'out', '2']) {
          const pin = part.rolePins[role]
          if (pin === undefined) continue
          for (let candidate = 0; candidate < pinCount; candidate++) if (String(pinId(candidate)) === String(pin)) bouncyPins.add(candidate)
        }
      }
    }
    const pinNumber = (value: number | string | '' | undefined) => {
      for (let pin = 0; pin < pinCount; pin++) if (String(pinId(pin)) === String(value)) return pin
      return -1
    }
    const liveMatrices = new Set<string>()
    for (const part of ['led_matrix', 'led_matrix4'].flatMap(type => hardware.componentsOfType(type))) {
      if (!part.powered) continue
      const din = pinNumber(part.rolePins.din), clk = pinNumber(part.rolePins.clk), cs = pinNumber(part.rolePins.cs)
      if (din < 0 || clk < 0 || cs < 0) continue
      liveMatrices.add(part.id)
      const existing = matrices.get(part.id)
      if (existing && existing.din === din && existing.clk === clk && existing.cs === cs) continue
      if (!matrices.size) seedLatch()
      // One chip per 8×8 module, chained DOUT→DIN inside the part.
      const chain = new Max7219Chain(part.type === 'led_matrix4' ? 4 : 1)
      matrices.set(part.id, { din, clk, cs, chain, publish: () => hardware.patchComponent(part.id, matrixPatch(chain.states)) })
    }
    for (const id of [...matrices.keys()]) if (!liveMatrices.has(id)) matrices.delete(id)
    // Register-level SPI chips on the hardware SPI pins (MOSI 11, MISO 12, SCK 13).
    const liveChips = new Set<string>()
    for (const part of ['rfid', 'tft_ili9341', 'microsd'].flatMap(type => hardware.componentsOfType(type))) {
      const roles = part.rolePins
      const cs = pinNumber(roles.cs ?? roles.sda)
      const onBus = pinNumber(roles.mosi) === profile.spi.mosi && pinNumber(roles.sck) === profile.spi.sck && (part.type === 'tft_ili9341' || pinNumber(roles.miso) === profile.spi.miso)
      const dc = pinNumber(roles.dc)
      if (!part.powered || cs < 0 || !onBus || (part.type === 'tft_ili9341' && dc < 0)) continue
      liveChips.add(part.id)
      let entry = spiChips.get(part.id)
      if (!entry || entry.cs !== cs || entry.dc !== dc) {
        if (!spiChips.size) {
          // First chip: seed the latch from the PORT registers written so far.
          seedLatch()
        }
        const rst = pinNumber(roles.rst)
        const base = { cs, dc, rst, lastCs: latch[cs], lastRst: rst >= 0 ? latch[rst] : 1, published: 0, lastPublishedAt: 0 }
        const files = Array.isArray(part.state.files) ? (part.state.files as SdFile[]).filter(f => typeof f?.name === 'string') : []
        entry = part.type === 'rfid' ? { ...base, kind: 'rfid', chip: entry?.kind === 'rfid' ? entry.chip : new Mfrc522() }
          : part.type === 'microsd' ? { ...base, rst: -1, kind: 'sd', chip: entry?.kind === 'sd' ? entry.chip : new SdCard(FatImage.format(files.map(f => ({ name: f.name, content: String(f.content ?? '') })))) }
          : { ...base, kind: 'tft', chip: entry?.kind === 'tft' ? entry.chip : new Ili9341() }
        spiChips.set(part.id, entry)
      }
      if (entry.kind === 'sd') entry.chip.inserted = part.state.mounted === true
      if (entry.kind === 'rfid') {
        const uid = parseRfidUid(part.state.uid)
        const key = uid?.map(byte => byte.toString(16).padStart(2, '0')).join('') ?? ''
        if (uid && part.state.cardPresent && !cards.has(key)) cards.set(key, new MifareClassic(uid))
        entry.chip.setCard(uid && part.state.cardPresent ? cards.get(key)! : null)
      }
    }
    for (const id of [...spiChips.keys()]) if (!liveChips.has(id)) spiChips.delete(id)
    const liveCells = new Set<string>()
    for (const part of hardware.componentsOfType('hx711')) {
      const dt = pinNumber(part.rolePins.dt), sck = pinNumber(part.rolePins.sck)
      if (!part.powered || dt < 0 || sck < 0) continue
      liveCells.add(part.id)
      const cell = loadCells.get(part.id)
      if (cell && cell.dt === dt && cell.sck === sck) continue
      if (!loadCells.size && !spiChips.size) {
        seedLatch()
      }
      const id = part.id
      loadCells.set(id, { dt, sck, lastSck: latch[sck], chip: createHx711(uno.cpu.cycles, () => {
        const grams = Number(hardware.components().find(entry => entry.id === id)?.state.weightGram)
        return Number.isFinite(grams) ? grams : 0
      }) })
    }
    for (const id of [...loadCells.keys()]) if (!liveCells.has(id)) loadCells.delete(id)
    // DS18B20 sensors, grouped by the pin their DQ wire goes to.
    const sensorsOnPin = new Map<number, string[]>()
    for (const part of hardware.componentsOfType('ds18b20')) {
      const dq = pinNumber(part.rolePins.data)
      if (!part.powered || dq < 0) continue
      sensorsOnPin.set(dq, [...(sensorsOnPin.get(dq) ?? []), part.id])
    }
    for (const pin of [...oneWireBuses.keys()]) if (!sensorsOnPin.has(pin)) { oneWireBuses.delete(pin); applied[pin] = undefined }
    for (const [pin, ids] of sensorsOnPin) {
      const key = ids.sort().join(',')
      if (oneWireBuses.get(pin)?.ids === key) continue
      if (!oneWireBuses.size && !analyzers.size && !loadCells.size && !spiChips.size) seedLatch()
      const devices = ids.map(id => {
        let sensor = ds18b20s.get(id)
        if (!sensor) {
          sensor = new Ds18b20(id, () => {
            const celsius = Number(hardware.components().find(entry => entry.id === id)?.state.temperature)
            return Number.isFinite(celsius) ? celsius : 25
          })
          ds18b20s.set(id, sensor)
        }
        return sensor
      })
      const bus = new OneWireBus(devices, {
        after: (cycles, task) => uno.cpu.addClockEvent(task, cycles),
        // The DQ pull-up (4.7 kΩ on a real board) keeps the idle wire HIGH.
        line: low => uno.setDigitalInput(pin, !low),
      })
      bus.master(uno.isOutput(pin) === 1 && latch[pin] === 0, uno.cpu.cycles)
      uno.setDigitalInput(pin, true)
      applied[pin] = undefined
      oneWireBuses.set(pin, { ids: key, bus })
    }
    // Rotary encoders: a change of the knob position plays the quadrature edges.
    for (const part of hardware.componentsOfType('rotary_encoder')) {
      const clk = pinNumber(part.rolePins.clk), dt = pinNumber(part.rolePins.dt)
      if (!part.powered || clk < 0 || dt < 0) continue
      const value = Math.round(Number(part.state.value) || 0)
      const seen = encoderSeen.get(part.id) ?? value
      encoderSeen.set(part.id, value)
      const pending = waveforms.get(clk)?.steps.at(-1)?.[0] ?? 0
      const pendingDt = waveforms.get(dt)?.steps.at(-1)?.[0] ?? 0
      const start = Math.max(uno.cpu.cycles + 1600, pending + 1600, pendingDt + 1600)
      if (value !== seen || !waveforms.has(clk) || !waveforms.has(dt)) {
        // Keep edges still queued from an earlier turn, then append this one.
        const turn = encoderWaveforms(start, value - seen)
        const keep = (pin: number) => (waveforms.get(pin)?.steps ?? []).filter(([at]) => at >= uno.cpu.cycles)
        const levelNow = (pin: number) => { const wave = waveforms.get(pin); return wave ? waveformLevel(wave, uno.cpu.cycles) : 1 }
        waveforms.set(clk, { initial: levelNow(clk), steps: [...keep(clk), ...turn.clk.steps], until: Infinity })
        waveforms.set(dt, { initial: levelNow(dt), steps: [...keep(dt), ...turn.dt.steps], until: Infinity })
      }
    }
    const liveAnalyzers = new Set<string>()
    for (const part of hardware.componentsOfType('logic_analyzer')) {
      liveAnalyzers.add(part.id)
      let entry = analyzers.get(part.id)
      if (!entry) {
        if (!analyzers.size && !loadCells.size && !spiChips.size) {
        seedLatch()
        }
        // A new run starts a fresh recording, as Wokwi does.
        entry = { capture: captureFor(part.id), published: -1 }
        entry.capture.reset(uno.cpu.cycles)
        analyzers.set(part.id, entry)
      }
      for (let ch = 0; ch < 8; ch++) {
        const pin = pinNumber(part.rolePins[`d${ch}`])
        entry.capture.channels[ch] = pin
        entry.capture.labels[ch] = pin < 0 ? '' : String(pinId(pin))
      }
    }
    for (const id of [...analyzers.keys()]) if (!liveAnalyzers.has(id)) analyzers.delete(id)
    for (const pin of [...neoPixels.keys()]) if (!neoPins.has(pin)) neoPixels.delete(pin)
    for (const pin of neoPins) {
      if (neoPixels.has(pin)) continue
      neoPixels.set(pin, createNeoPixelDecoder(pixels => {
        for (const type of ['neopixel', 'neopixel_matrix', 'led_ring']) {
          const part = hardware.componentOn(type, pinId(pin), 'din')
          if (!part?.powered) continue
          const first = pixels[0] ?? 0
          hardware.patchComponent(part.id, { pixels, red: (first >> 16) & 0xff, green: (first >> 8) & 0xff, blue: first & 0xff })
        }
      }))
    }
  }

  attachUnoBuses(avr, uno, hardware, sync, undefined, value => {
    let selected: SpiChip | undefined
    for (const entry of spiChips.values()) {
      if (latch[entry.cs]) continue
      if (selected) return 0xff // two chips selected at once: bus contention
      selected = entry
    }
    if (!selected) return undefined
    if (selected.rst >= 0 && !latch[selected.rst] && modes[selected.rst] === 'OUTPUT') return 0 // held in reset
    if (selected.kind === 'sd') return selected.chip.transfer(value)
    return selected.kind === 'tft' ? selected.chip.transfer(value, latch[selected.dc] === 1) : selected.chip.transfer(value)
  })
  /** Push TFT frames to the view at most ~25 times a second. */
  const publishSpiChips = (now: number) => {
    if (now - spiPublishedAt < 40) return
    spiPublishedAt = now
    for (const [id, entry] of spiChips) {
      if (entry.kind === 'sd') {
        // Card writes go back to the project's file list (what the SD shim reads too).
        if (entry.published === entry.chip.image.version || now - entry.lastPublishedAt < 500) continue
        entry.published = entry.chip.image.version
        entry.lastPublishedAt = now
        hardware.patchComponent(id, { files: entry.chip.image.files() })
        continue
      }
      if (entry.kind !== 'tft' || entry.published === entry.chip.version) continue
      entry.published = entry.chip.version
      hardware.patchComponent(id, { framebuffer: entry.chip.frame(), textRuns: [], lines: [], rotation: (entry.chip.madctl >> 5) & 1 })
    }
  }
  function sync() {
    const cycle = uno.cpu.cycles
    const sampleInputs = (syncCount++ & 7) === 0
    // Timer-driven PWM is read from the compare registers, exactly as the
    // hardware would output it; the toggling port bit is not re-published.
    const duties = uno.readPwm()
    for (const [pin, duty] of duties) {
      if (pwm.get(pin) !== duty) { hardware.analogWrite(pinId(pin), duty); pwm.set(pin, duty) }
    }
    for (const pin of [...pwm.keys()]) if (!duties.has(pin)) { pwm.delete(pin); values[pin] = undefined; dirtyPorts.add(uno.portOf(pin)[0]) }
    // Publish direction/output changes before sampling interconnected inputs.
    // Only pins on ports the firmware wrote since the last step can differ.
    const changed: number[] = []
    for (const port of dirtyPorts) for (const pin of uno.portPins[port]) if (pin >= 0) changed.push(pin)
    dirtyPorts.clear()
    for (const pin of changed) {
      if (pwm.has(pin)) continue
      const state = uno.pinState(pin)
      const mode = state === avr.PinState.Input ? 'INPUT' : state === avr.PinState.InputPullUp ? 'INPUT_PULLUP' : 'OUTPUT'
      const value = state === avr.PinState.High || state === avr.PinState.InputPullUp ? 1 : 0
      if (mode !== modes[pin]) {
        // DHT start signal: host held the data line LOW, then let it go.
        const dht = dhtPins.get(pin)
        const since = lowSince.get(pin)
        if (dht && modes[pin] === 'OUTPUT' && mode !== 'OUTPUT' && since !== undefined && cycle - since >= DHT_START_MIN_CYCLES) {
          const sensor = hardware.components().find(entry => entry.id === dht.id)
          const temperature = Number(sensor?.state.temperature), humidity = Number(sensor?.state.humidity)
          if (Number.isFinite(temperature) && Number.isFinite(humidity)) waveforms.set(pin, dhtWaveform(cycle, dhtFrame(dht.type, temperature, humidity)))
        }
        lowSince.delete(pin)
        hardware.pinMode(pinId(pin), mode); modes[pin] = mode; values[pin] = undefined
      }
      if (dhtPins.has(pin) && mode === 'OUTPUT') {
        if (value === 0 && !lowSince.has(pin)) lowSince.set(pin, cycle)
        if (value === 1) lowSince.delete(pin)
      }
      if (value !== values[pin]) {
        values[pin] = value
        if (mode === 'OUTPUT') decoder.observe(pin, value, cycle)
        if (mode !== 'OUTPUT' || decoder.forwardsLevel(pin)) hardware.digitalWrite(pinId(pin), value)
      }
    }
    const cellOnPin = (pin: number) => { for (const cell of loadCells.values()) if (cell.dt === pin) return cell; return undefined }
    for (let pin = 0; pin < pinCount; pin++) {
      if (modes[pin] === 'OUTPUT' || pwm.has(pin)) continue
      if (oneWireBuses.has(pin)) continue // the sensors own this wire's level
      const cell = loadCells.size ? cellOnPin(pin) : undefined
      if (cell) { applied[pin] = undefined; uno.setDigitalInput(pin, cell.chip.level(cycle) === 1); continue }
      const wave = waveforms.get(pin)
      if (wave) {
        if (cycle >= wave.until) waveforms.delete(pin)
        else { drive(pin, waveformLevel(wave, cycle) === 1); continue }
      }
      // Reading the circuit goes through the store; doing it every 16µs was
      // what kept the emulator far below real time.
      if (wiredPins.length && !wiredPins[pin]) {
        // Nothing attached: the pin reads its own pull-up (HIGH) or LOW.
        drive(pin, modes[pin] === 'INPUT_PULLUP')
        continue
      }
      if (sampleInputs || inputLevel[pin] === undefined) {
        const next = hardware.digitalRead(pinId(pin)) !== 0
        if (inputLevel[pin] !== undefined && next !== inputLevel[pin] && bouncyPins.has(pin)) {
          inputLevel[pin] = next
          waveforms.set(pin, bounceWaveform(cycle, next ? 1 : 0))
          drive(pin, !next) // contacts still at the old level this instant
          continue
        }
        inputLevel[pin] = next
      }
      drive(pin, inputLevel[pin])
    }
    if (uno.uart.rxEnable && !uno.uart.rxBusy && hardware.serialAvailable() > 0) uno.uart.writeByte(hardware.serialRead() & 255)
    if (analyzers.size) sampleAnalyzers(cycle)
  }
  const stop = () => {
    active = false
    cancelNext?.()
    for (const pin of [...pwm.keys()]) hardware.analogWrite(pinId(pin), 0)
    decoder.setRoles(new Map())
    // Flush the last card writes (SD.close() just before Stop must not be lost).
    for (const [id, entry] of spiChips) if (entry.kind === 'sd' && entry.published !== entry.chip.image.version) hardware.patchComponent(id, { files: entry.chip.image.files() })
    for (const [id, entry] of analyzers) hardware.patchComponent(id, { events: entry.capture.masks.length, recording: false })
    uno.stop()
    saveEeprom(profile.id, uno.eepromMemory)
    serialBytes = []
  }
  /** Hand pending UART output to the monitor (UBRR0 as the sketch set it). */
  const flushSerial = () => {
    if (!serialBytes.length) return
    // UBRR0 as the sketch set it: the monitor garbles text at another baud.
    hardware.serialBaud?.(Math.round(uno.uart.baudRate))
    hardware.serialWrite(serialDecoder.decode(Uint8Array.from(serialBytes), { stream: true }))
    serialBytes = []
  }
  function tick() {
    if (!active) return
    try {
      // Parts can be rewired while running; re-read the roles ~10x a second.
      const now = performance.now()
      if (now - rolesCheckedAt > 100) { refreshRoles(); rolesCheckedAt = now }
      const deadline = now + 8
      let budget = UNO_CYCLES_PER_MS
      if (paced) {
        owed += Math.min(now - lastWall, MAX_CATCH_UP_MS) * UNO_CYCLES_PER_MS
        lastWall = now
        budget = Math.min(owed, MAX_CATCH_UP_MS * UNO_CYCLES_PER_MS)
      }
      const start = uno.cpu.cycles
      const end = start + budget
      // owed can be negative after an overshoot: sit this tick out.
      if (budget > 0) do { sync(); uno.runCycles(256) } while (active && uno.cpu.cycles < end && performance.now() < deadline)
      // Keep the overshoot of the last chunk as debt (no drift), but never owe
      // more than one catch-up window: a stall must not replay as a burst.
      if (paced) owed = Math.min(owed - (uno.cpu.cycles - start), MAX_CATCH_UP_MS * UNO_CYCLES_PER_MS)
      sync()
      decoder.tick(uno.cpu.cycles)
      for (const neo of neoPixels.values()) neo.tick(uno.cpu.cycles)
      if (spiChips.size) publishSpiChips(performance.now())
      if (analyzers.size && performance.now() - analyzersPublishedAt > 250) {
        analyzersPublishedAt = performance.now()
        for (const [id, entry] of analyzers) {
          if (entry.published === entry.capture.masks.length) continue
          entry.published = entry.capture.masks.length
          hardware.patchComponent(id, { events: entry.published, recording: !entry.capture.full })
        }
      }
      flushSerial()
      if (active) cancelNext = schedule(tick, paced && owed > 2048)
    } catch (error) {
      // Whatever the sketch printed before it crashed is the clue to why.
      try { flushSerial() } catch { /* monitor already gone */ }
      stop()
      onError(error instanceof Error ? error.message : String(error))
    }
  }
  let lastWall = performance.now()
  let owed = 0
  cancelNext = schedule(tick, false)
  return { stop }
}

/** Former name, kept for callers written before Mega support. */
export const startUnoFirmware = startAvrFirmware
