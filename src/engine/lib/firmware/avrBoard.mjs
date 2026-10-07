// AVR boards on avr8js: ATmega328P (Uno, Nano) and ATmega2560 (Mega 2560).
// Each profile carries the chip's own interrupt vectors, peripheral register
// addresses and Arduino pin → port/bit map, so compiled sketches run on the
// same silicon layout they were built for. Browser-safe: no Node APIs.

/** Sleep Mode Control Register (SE = bit 0, SM2:0 = bits 3:1), same on both chips. */
const SMCR = 0x53
const PORT_ADDR = { A: 0x22, B: 0x25, C: 0x28, D: 0x2b, E: 0x2e, F: 0x31, G: 0x34, H: 0x102, J: 0x105, K: 0x108, L: 0x10b }

/** Arduino pin number → [port, bit], from the cores' pins_arduino.h. */
const UNO_PINS = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(b => ['D', b]),
  ...[0, 1, 2, 3, 4, 5].map(b => ['B', b]),
  ...[0, 1, 2, 3, 4, 5].map(b => ['C', b]),
]
const MEGA_PINS = [
  ['E', 0], ['E', 1], ['E', 4], ['E', 5], ['G', 5], ['E', 3], ['H', 3], ['H', 4], ['H', 5], ['H', 6],
  ['B', 4], ['B', 5], ['B', 6], ['B', 7], ['J', 1], ['J', 0], ['H', 1], ['H', 0], ['D', 3], ['D', 2],
  ['D', 1], ['D', 0], ...[0, 1, 2, 3, 4, 5, 6, 7].map(b => ['A', b]), ...[7, 6, 5, 4, 3, 2, 1, 0].map(b => ['C', b]),
  ['D', 7], ['G', 2], ['G', 1], ['G', 0], ...[7, 6, 5, 4, 3, 2, 1, 0].map(b => ['L', b]),
  ['B', 3], ['B', 2], ['B', 1], ['B', 0],
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(b => ['F', b]), ...[0, 1, 2, 3, 4, 5, 6, 7].map(b => ['K', b]),
]

/** analogWrite() outputs: [pin, TCCRnA, COMnx1 bit, OCRnx (low byte; 8-bit PWM in the core)]. */
const UNO_PWM = [[6, 0x44, 7, 0x47], [5, 0x44, 5, 0x48], [9, 0x80, 7, 0x88], [10, 0x80, 5, 0x8a], [11, 0xb0, 7, 0xb3], [3, 0xb0, 5, 0xb4]]
const MEGA_PWM = [
  [13, 0x44, 7, 0x47], [4, 0x44, 5, 0x48], [11, 0x80, 7, 0x88], [12, 0x80, 5, 0x8a], [10, 0xb0, 7, 0xb3], [9, 0xb0, 5, 0xb4],
  [5, 0x90, 7, 0x98], [2, 0x90, 5, 0x9a], [3, 0x90, 3, 0x9c], [6, 0xa0, 7, 0xa8], [7, 0xa0, 5, 0xaa], [8, 0xa0, 3, 0xac],
  [46, 0x120, 7, 0x128], [45, 0x120, 5, 0x12a], [44, 0x120, 3, 0x12c],
]

function megaTimer16(base, timsk, tifr, vector, a, b, c, clock) {
  return {
    bits: 16, captureInterrupt: vector, compAInterrupt: vector + 2, compBInterrupt: vector + 4, compCInterrupt: vector + 6, ovfInterrupt: vector + 8,
    TIFR: tifr, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12, ICR: base + 6, TCNT: base + 4, TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TIMSK: timsk,
    dividers: { 0: 0, 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024, 6: 0, 7: 0 },
    compPortA: PORT_ADDR[a[0]], compPinA: a[1], compPortB: PORT_ADDR[b[0]], compPinB: b[1], compPortC: PORT_ADDR[c[0]], compPinC: c[1],
    externalClockPort: PORT_ADDR[clock[0]], externalClockPin: clock[1],
    TOV: 1, OCFA: 2, OCFB: 4, OCFC: 8, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 8,
  }
}

function megaProfile(avr) {
  const ext = (EICR, index, interrupt) => ({ EICR, EIMSK: 0x3d, EIFR: 0x3c, index, iscOffset: (index % 4) * 2, interrupt })
  const bare = config => ({ ...config, pinChange: undefined, externalInterrupts: [] })
  const ports = {
    A: bare(avr.portAConfig), C: bare(avr.portCConfig), F: bare(avr.portFConfig), G: bare(avr.portGConfig),
    H: bare(avr.portHConfig), L: bare(avr.portLConfig),
    B: { ...avr.portBConfig, pinChange: { PCIE: 0, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6b, pinChangeInterrupt: 0x12, mask: 0xff, offset: 0 }, externalInterrupts: [] },
    D: { ...avr.portDConfig, pinChange: undefined, externalInterrupts: [0, 1, 2, 3].map(i => ext(0x69, i, 0x02 + i * 2)) },
    E: { ...avr.portEConfig, pinChange: undefined, externalInterrupts: [null, null, null, null, ext(0x6a, 4, 0x0a), ext(0x6a, 5, 0x0c), ext(0x6a, 6, 0x0e), ext(0x6a, 7, 0x10)] },
    J: { ...avr.portJConfig, pinChange: { PCIE: 1, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6c, pinChangeInterrupt: 0x14, mask: 0x7f, offset: 1 }, externalInterrupts: [] },
    K: { ...avr.portKConfig, pinChange: { PCIE: 2, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6d, pinChangeInterrupt: 0x16, mask: 0xff, offset: 0 }, externalInterrupts: [] },
  }
  return {
    id: 'mega', flashBytes: 262144,
    // avr8js allots sramBytes after 0x100 bytes of registers; the 2560's SRAM
    // starts at 0x200 (extended I/O first) and ends at 0x21FF.
    sramBytes: 8192 + 0x100, eepromBytes: 4096, pins: MEGA_PINS, analogBase: 54, analogChannels: 16, ports,
    pwm: MEGA_PWM, spi: { mosi: 51, miso: 50, sck: 52, ss: 53 }, twi: { sda: 20, scl: 21 },
    timers: [
      { ...avr.timer0Config, compAInterrupt: 0x2a, compBInterrupt: 0x2c, ovfInterrupt: 0x2e, compPortA: PORT_ADDR.B, compPinA: 7, compPortB: PORT_ADDR.G, compPinB: 5, externalClockPort: PORT_ADDR.D, externalClockPin: 7 },
      megaTimer16(0x80, 0x6f, 0x36, 0x20, ['B', 5], ['B', 6], ['B', 7], ['D', 6]),
      { ...avr.timer2Config, compAInterrupt: 0x1a, compBInterrupt: 0x1c, ovfInterrupt: 0x1e, compPortA: PORT_ADDR.B, compPinA: 4, compPortB: PORT_ADDR.H, compPinB: 6 },
      megaTimer16(0x90, 0x71, 0x38, 0x3e, ['E', 3], ['E', 4], ['E', 5], ['E', 6]),
      megaTimer16(0xa0, 0x72, 0x39, 0x52, ['H', 3], ['H', 4], ['H', 5], ['H', 7]),
      megaTimer16(0x120, 0x73, 0x3a, 0x5c, ['L', 3], ['L', 4], ['L', 5], ['L', 2]),
    ],
    usart: { ...avr.usart0Config, rxCompleteInterrupt: 0x32, dataRegisterEmptyInterrupt: 0x34, txCompleteInterrupt: 0x36 },
    spiConfig: { ...avr.spiConfig, spiInterrupt: 0x30 },
    twiConfig: { ...avr.twiConfig, twiInterrupt: 0x4e },
    adcConfig: { ...avr.adcConfig, adcInterrupt: 0x3a },
    eepromConfig: { ...avr.eepromConfig, eepromReadyInterrupt: 0x3c },
    watchdogConfig: { ...avr.watchdogConfig, watchdogInterrupt: 0x18 },
    /** MUX5 (ADCSRB bit 3) selects channels 8–15. */
    adcChannel: (data, channel) => channel + (data[0x7b] & 0x08 ? 8 : 0),
  }
}

function unoProfile(avr, id) {
  return {
    id, flashBytes: 32768, sramBytes: 2048, eepromBytes: 1024, pins: UNO_PINS, analogBase: 14, analogChannels: id === 'nano' ? 8 : 6,
    ports: { B: avr.portBConfig, C: avr.portCConfig, D: avr.portDConfig },
    pwm: UNO_PWM, spi: { mosi: 11, miso: 12, sck: 13, ss: 10 }, twi: { sda: 18, scl: 19 },
    timers: [avr.timer0Config, avr.timer1Config, avr.timer2Config],
    usart: avr.usart0Config, spiConfig: avr.spiConfig, twiConfig: avr.twiConfig, adcConfig: avr.adcConfig,
    eepromConfig: avr.eepromConfig, watchdogConfig: avr.watchdogConfig,
    adcChannel: (_data, channel) => channel,
  }
}

export function avrProfile(avr, boardId) {
  if (boardId === 'uno' || boardId === 'nano') return unoProfile(avr, boardId)
  if (boardId === 'mega') return megaProfile(avr)
  return null
}

export function parseIntelHex(text, flashBytes) {
  const bytes = new Uint8Array(flashBytes).fill(0xff)
  const seen = new Uint8Array(bytes.length)
  let base = 0, eof = false, count = 0
  for (const line of text.trim().split(/\r?\n/)) {
    if (eof || !/^:[0-9a-f]+$/i.test(line) || line.length % 2 !== 1) throw new Error('Invalid HEX record')
    const r = Uint8Array.from(line.slice(1).match(/../g), x => parseInt(x, 16))
    if (r.length !== r[0] + 5 || r.reduce((a, b) => a + b, 0) % 256) throw new Error('Invalid HEX checksum/length')
    const address = r[1] * 256 + r[2]
    if (r[3] === 0) {
      for (let i = 0; i < r[0]; i++) {
        const at = base + address + i
        if (at >= bytes.length || seen[at]) throw new Error('HEX address outside flash or overlapping')
        bytes[at] = r[4 + i]; seen[at] = 1; count++
      }
    } else if (r[3] === 1 && r[0] === 0 && address === 0) eof = true
    else if ((r[3] === 2 || r[3] === 4) && r[0] === 2 && address === 0) base = (r[4] * 256 + r[5]) * (r[3] === 2 ? 16 : 65536)
    else if (r[3] === 3 || r[3] === 5) { /* start address records: ignored, reset vector rules */ }
    else throw new Error('Unsupported HEX record')
  }
  if (!eof || !count || !seen[0] || !seen[1]) throw new Error('HEX missing EOF/program/reset vector')
  const words = new Uint16Array(flashBytes / 2)
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
  return words
}

/**
 * One AVR board. `eeprom` (optional) is the persistent EEPROM contents; it is
 * used in place, so writes by the sketch survive into the next run.
 */
export function createAvrBoard(avr, hex, profile, { onUart = () => {}, onGpio = () => {}, readAnalogVoltage, eeprom } = {}) {
  const cpu = new avr.CPU(parseIntelHex(hex, profile.flashBytes), profile.sramBytes)
  const ports = Object.fromEntries(Object.entries(profile.ports).map(([letter, config]) => [letter, new avr.AVRIOPort(cpu, config)]))
  const timers = profile.timers.map(config => new avr.AVRTimer(cpu, config))
  const uart = new avr.AVRUSART(cpu, profile.usart, 16000000)
  const adc = new avr.AVRADC(cpu, profile.adcConfig)
  const clock = new avr.AVRClock(cpu, 16000000, avr.clockConfig)
  const watchdog = new avr.AVRWatchdog(cpu, profile.watchdogConfig, clock)
  const backend = new avr.EEPROMMemoryBackend(profile.eepromBytes)
  if (eeprom && eeprom.length === profile.eepromBytes) backend.memory = eeprom
  const eepromUnit = new avr.AVREEPROM(cpu, backend, profile.eepromConfig)
  const convert = adc.onADCRead
  adc.onADCRead = input => {
    if (readAnalogVoltage && input.type === avr.ADCMuxInputType.SingleEnded) {
      const channel = profile.adcChannel(cpu.data, input.channel)
      if (channel < profile.analogChannels) {
        const volts = readAnalogVoltage(channel)
        if (!Number.isFinite(volts) || volts < 0 || volts > 5) throw new RangeError('ADC voltage must be 0..5V')
        adc.channelValues[input.channel] = volts
      }
    }
    convert(input)
  }
  uart.onByteTransmit = byte => onUart({ byte, cycle: cpu.cycles })
  for (const [port, io] of Object.entries(ports)) {
    io.addListener((value, previous) => onGpio({ port, value, previous, cycle: cpu.cycles }))
  }
  /** Arduino pins on each port, indexed by bit (-1: not an Arduino pin). */
  const portPins = Object.fromEntries(Object.keys(ports).map(letter => [letter, new Array(8).fill(-1)]))
  profile.pins.forEach(([letter, bit], pin) => { portPins[letter][bit] = pin })
  const checkPin = pin => { if (!Number.isInteger(pin) || pin < 0 || pin >= profile.pins.length) throw new RangeError(`Pin must be 0..${profile.pins.length - 1}`) }
  let stopped = false
  /** Set while the CPU sleeps: { deep, from, frozen timers }. */
  let sleep = null
  const wake = () => {
    if (sleep.deep) {
      // Timers did not count while their clock was off: shift their origin
      // by the slept time and let them reschedule from the current count.
      const slept = cpu.cycles - sleep.from
      for (const timer of timers) timer.lastCycle += slept
      for (const timer of sleep.frozen) timer.count()
    }
    sleep = null
  }
  // Nothing executes while asleep: jump straight to the next peripheral event
  // (or the end of this slice, so pin changes from the UI are still seen).
  const sleepStep = end => {
    const next = cpu.nextClockEvent ? cpu.nextClockEvent.cycles : end
    const target = Math.max(cpu.cycles + 1, Math.min(next, end))
    const pc = cpu.pc
    if (sleep.deep) {
      cpu.cycles = target
      // Wake-up needs the ISR to run, which only happens with I set.
      if (cpu.interruptsEnabled && cpu.nextInterrupt >= 0) { wake(); cpu.tick(); return }
      cpu.tick()
      if (cpu.pc !== pc) wake()
      return
    }
    cpu.cycles = target
    cpu.tick()
    if (cpu.pc !== pc) wake()
  }
  return {
    cpu, ports, timers, uart, adc, watchdog, eeprom: eepromUnit, eepromMemory: backend.memory, frequency: 16000000, profile, portPins,
    pinCount: profile.pins.length,
    pinId: pin => pin < profile.analogBase ? pin : `A${pin - profile.analogBase}`,
    portOf: pin => profile.pins[pin],
    /** Pin state as avr8js reports it (driven level or input mode). */
    pinState(pin) { checkPin(pin); const [letter, bit] = profile.pins[pin]; return ports[letter].pinState(bit) },
    /** PORT register bit (output latch or pull-up enable). */
    portLatch(pin) { const [letter, bit] = profile.pins[pin]; return (cpu.data[PORT_ADDR[letter]] >> bit) & 1 },
    isOutput(pin) { const [letter, bit] = profile.pins[pin]; return (cpu.data[PORT_ADDR[letter] - 1] >> bit) & 1 },
    /** PINx bit: the level the chip sees on the pin. */
    inputLevel(pin) { const [letter, bit] = profile.pins[pin]; return (cpu.data[PORT_ADDR[letter] - 2] >> bit) & 1 },
    /** Duty (0–255) of every pin a timer compare output drives. */
    readPwm() {
      const duties = new Map()
      for (const [pin, tccr, bit, ocr] of profile.pwm) if (cpu.data[tccr] & (1 << bit)) duties.set(pin, cpu.data[ocr])
      return duties
    },
    setDigitalInput(pin, high) { checkPin(pin); const [letter, bit] = profile.pins[pin]; ports[letter].setPin(bit, Boolean(high)) },
    runCycles(budget) {
      if (!Number.isSafeInteger(budget) || budget < 0 || budget > 16000000) throw new RangeError('Cycle budget must be 0..16000000')
      const end = cpu.cycles + budget
      while (!stopped && cpu.cycles < end) {
        if (sleep) { sleepStep(end); continue }
        // SLEEP with SMCR.SE set: avr8js treats it as a no-op, a real chip halts
        // until an enabled interrupt fires (then runs the ISR and continues
        // after the SLEEP). Anything but idle also stops the timer clocks.
        if (cpu.progMem[cpu.pc] === 0x9588 && (cpu.data[SMCR] & 1)) {
          cpu.pc += 1
          cpu.cycles += 1
          const mode = (cpu.data[SMCR] >> 1) & 7
          sleep = { deep: mode !== 0, from: cpu.cycles, frozen: [] }
          if (sleep.deep) {
            for (const timer of timers) if (cpu.clearClockEvent(timer.count)) sleep.frozen.push(timer)
          }
          cpu.tick()
          continue
        }
        avr.avrInstruction(cpu)
        cpu.tick()
      }
      return cpu.cycles
    },
    stop() { stopped = true },
  }
}
