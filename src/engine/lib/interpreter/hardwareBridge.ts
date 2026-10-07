// ============================================================
// KodyUno — store-backed hardware
//
// The only place where the C++ engine meets the simulator state. Pin
// writes flow into the zustand store (which re-renders the canvas), pin
// reads come back out of it, and analog reads are derived from whichever
// sensor the circuit solver says is wired to that pin.
// ============================================================
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { PART_SPECS } from '@kodyuno/lib/partSpecs'
import { Ds1307, Hd44780, Mpu6050, Ssd1306 } from '@kodyuno/lib/i2cDevices'
import { rtcEpoch } from '@kodyuno/lib/rtcClock'
import { getBoard } from '@kodyuno/lib/boards'
import { activeBoard } from '@kodyuno/lib/boardGeometry'
import type { Hardware, PinMode, SimComponentView } from '@kodyuno/lib/cpp/hardware'
import type { BoardComponent } from '@kodyuno/types'
import { DEFAULT_SPI_PINS } from '@kodyuno/lib/spiBus'
import { adcCounts, ANALOG_OUTPUT_ROLES, NOMINAL_ADC_FULL_SCALE, ntcDividerFraction, pulseWaveCounts } from './analogModel'

/** Component state keys that carry an analog level, in 10-bit units. */
const ANALOG_STATE_KEYS: Record<string, string> = {
  potentiometer: 'value',
  ldr: 'level',
  sound_sensor: 'level',
  gas_sensor: 'level',
  flame_sensor: 'level',
  water_sensor: 'level',
  heart_sensor: 'level',
}

function rolePinsOf(component: BoardComponent): Record<string, number | string> {
  // Once solved, disconnected terminals must not revive authored pin hints.
  if (component.circuit) {
    const roles = { ...component.circuit.rolePins }
    // Passive parts (buzzer) are solved as "driven from srcPin" without a
    // role map; without this, componentOn('buzzer', pin, 'signal') never
    // found a wired buzzer and tone() stayed silent.
    if (roles.signal === undefined && component.circuit.srcPin !== undefined && component.circuit.srcPin !== null
        && PART_SPECS[component.type]?.terminals.some(terminal => terminal.role === 'signal')) {
      roles.signal = component.circuit.srcPin
    }
    return roles
  }
  const roles: Record<string, number | string> = {}
  for (const entry of component.pins) {
    if (entry.pin !== '' && entry.pin !== undefined) roles[entry.role] = entry.pin
  }
  return roles
}

function toView(component: BoardComponent): SimComponentView {
  return {
    id: component.id,
    type: component.type,
    state: component.state,
    rolePins: rolePinsOf(component),
    powered: component.circuit?.powered ?? true,
  }
}

const numberOf = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function samePin(a: number | string | undefined, b: number | string): boolean {
  return a !== undefined && String(a) === String(b)
}

const I2C_DEFAULT_ADDRESS: Partial<Record<BoardComponent['type'], number>> = {
  ssd1306: 0x3c,
  lcd: 0x27,
  lcd2004: 0x27,
  mpu6050: 0x68,
  ds1307: 0x68,
}

function defaultI2CPins(boardId: string): [number | string, number | string] {
  if (boardId === 'uno' || boardId === 'nano') return ['A4', 'A5']
  if (boardId === 'mega') return [20, 21]
  if (boardId === 'esp8266') return [4, 5]
  if (boardId === 'esp32-s2' || boardId === 'esp32-s3' || boardId === 'esp32-c3') return [8, 9]
  if (boardId === 'esp32-c6') return [6, 7]
  return [21, 22]
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

/**
 * A Hardware implementation wired to the live simulator store.
 * `boardId` is read fresh on every call so switching boards mid-session
 * cannot leave the engine pointed at a stale pin table.
 */
export function createSimulatorHardware(): Hardware {
  const store = useKodyUnoStore
  /** tone(pin, f, ms) end-of-note timers, one per pin. */
  const toneTimers = new Map<string, number>()
  const clearToneTimer = (pin: number | string) => {
    const key = String(pin)
    const timer = toneTimers.get(key)
    if (timer !== undefined) { window.clearTimeout(timer); toneTimers.delete(key) }
  }
  const i2cPointers = new Map<string, number>()
  // Display controllers fed with raw I2C bytes (real firmware, or Wire code).
  const lcdControllers = new Map<string, Hd44780>()
  const oledControllers = new Map<string, Ssd1306>()
  const motionChips = new Map<string, Mpu6050>()
  const clockChips = new Map<string, Ds1307>()
  /** Bus address; the MPU-6050 answers at 0x69 while its AD0 pin is held HIGH. */
  const i2cAddressOf = (component: BoardComponent) => {
    const fixed = numberOf(component.state.address, NaN)
    if (Number.isFinite(fixed)) return fixed
    const base = I2C_DEFAULT_ADDRESS[component.type] ?? -1
    if (component.type !== 'mpu6050') return base
    const ad0 = rolePinsOf(component).ad0
    if (ad0 === undefined) return base
    const board = getBoard(store.getState().boardType)
    const rail = board.pins.find(entry => samePin(entry.id, ad0))
    if (rail?.kind === 'power') return (rail.volts ?? 0) > 0 ? base | 1 : base
    const level = store.getState().pins.find(entry => samePin(entry.pin, ad0))
    return level?.mode === 'OUTPUT' && level.value === 1 ? base | 1 : base
  }
  const motionChip = (id: string) => { let chip = motionChips.get(id); if (!chip) { chip = new Mpu6050(); motionChips.set(id, chip) } return chip }
  const clockChip = (id: string) => { let chip = clockChips.get(id); if (!chip) { chip = new Ds1307(); clockChips.set(id, chip) } return chip }
  const motionSample = (state: Record<string, unknown>) => ({
    ax: numberOf(state.ax, 0), ay: numberOf(state.ay, 0), az: numberOf(state.az, 1),
    gx: numberOf(state.gx, 0), gy: numberOf(state.gy, 0), gz: numberOf(state.gz, 0), temperature: numberOf(state.temperature, 27),
  })

  const views = (): SimComponentView[] => store.getState().components.map(toView)

  const analogScale = () => 2 ** getBoard(store.getState().boardType).adcBits - 1

  const hardware: Hardware = {
    get board() {
      return getBoard(store.getState().boardType)
    },

    pinMode(pin, mode: PinMode) {
      const definition = getBoard(store.getState().boardType).pins.find((entry) => samePin(entry.id, pin))
      if (!definition || (definition.kind !== 'gpio' && definition.kind !== 'analog')) {
        hardware.warn(`Pin ${pin} tidak tersedia sebagai GPIO pada board ini`)
        return
      }
      if (definition.inputOnly && (mode === 'OUTPUT' || mode === 'OUTPUT_OPEN_DRAIN')) {
        hardware.warn(`GPIO ${pin} hanya mendukung input`)
        return
      }
      const normalised = mode === 'OUTPUT_OPEN_DRAIN' ? 'OUTPUT' : mode
      store.getState().setPinMode(pin, normalised)
      // INPUT_PULLUP idles high, exactly like the real chip
      if (normalised === 'INPUT_PULLUP') store.getState().updatePin(pin, 1, 0)
    },

    digitalWrite(pin, value) {
      const definition = activeBoard().pins.find((entry) => samePin(entry.id, pin))
      if (!definition || (definition.kind !== 'gpio' && definition.kind !== 'analog')) {
        hardware.warn(`digitalWrite(): pin ${pin} tidak valid`)
        return
      }
      if (definition?.inputOnly) {
        hardware.warn(`GPIO ${pin} pada ${activeBoard().shortName} hanya bisa dibaca, bukan ditulis`)
        return
      }
      const current = store.getState().pins.find((entry) => samePin(entry.pin, pin))
      if (current?.mode !== 'OUTPUT') {
        // AVR/Arduino semantics: writing HIGH to an input enables its pull-up,
        // writing LOW disables it. It does not actively drive the net.
        store.getState().setPinMode(pin, value ? 'INPUT_PULLUP' : 'INPUT')
        store.getState().updatePin(pin, value, 0)
        return
      }
      store.getState().updatePin(pin, value, 0)
    },

    pinWired(pin) {
      const snapshot = store.getState()
      const root = snapshot.circuitIndex.netOf[`P:${pin}`]
      return !!root && (snapshot.circuitIndex.members[root]?.length ?? 0) > 1
    },

    digitalRead(pin) {
      const state = store.getState().pins.find((entry) => samePin(entry.pin, pin))
      if (!state) return 0

      // Resolve the electrical net before consulting device shims. In particular,
      // a switch position is not itself HIGH: its selected contact needs a source.
      const snapshot = store.getState()
      const root = snapshot.circuitIndex.netOf[`P:${pin}`]
      const members = root ? snapshot.circuitIndex.members[root] ?? [] : []
      const board = hardware.board
      const levels = new Set<number>()
      for (const key of members) {
        if (!key.startsWith('P:')) continue
        const id = key.slice(2)
        const definition = board.pins.find(entry => String(entry.id) === id)
        if (definition?.kind === 'gnd') levels.add(0)
        if (definition?.kind === 'power' && definition.volts !== undefined) levels.add(definition.volts > 0 ? 1 : 0)
        const driver = snapshot.pins.find(entry => String(entry.pin) === id && entry.mode === 'OUTPUT')
        if (driver) levels.add(driver.value > 0 || driver.pwm > 0 ? 1 : 0)
      }
      if (levels.size > 1) {
        hardware.warn(`digitalRead(${pin}): jalur memiliki konflik output`)
        return 0
      }
      if (levels.size === 1) return [...levels][0]

      // 4×4 membrane keypad: a pressed key shorts its row line to its column
      // line. A scanning library drives one side and reads the other, so a
      // pin on that key reads whatever the pin across the contact drives.
      // (Kept out of the net solver so the row/column pin map stays stable.)
      for (const component of snapshot.components) {
        if (component.type !== 'keypad' || typeof component.state.key !== 'string' || !component.state.key) continue
        const index = '123A456B789C*0#D'.indexOf(component.state.key)
        if (index < 0) continue
        const roles = rolePinsOf(component)
        const row = roles[`r${Math.floor(index / 4) + 1}`], col = roles[`c${(index % 4) + 1}`]
        const across = samePin(row, pin) ? col : samePin(col, pin) ? row : undefined
        if (across === undefined || across === '') continue
        const driver = snapshot.pins.find(entry => samePin(entry.pin, across) && entry.mode === 'OUTPUT')
        if (driver) return driver.value > 0 || driver.pwm > 0 ? 1 : 0
      }

      // Interactive inputs are evaluated at read time, like Wokwi. This keeps
      // reads correct even when a control changes between interpreter ticks.
      for (const component of store.getState().components) {
        const roles = rolePinsOf(component)
        const powered = component.circuit?.powered ?? true
        if (!powered) continue
        if (component.type === 'pushbutton' && samePin(roles.signal, pin)) {
          return component.state.pressed ? 0 : state.mode === 'INPUT_PULLUP' ? 1 : 0
        }
        if (component.type === 'pir' && samePin(roles.out, pin)) return component.state.detected ? 1 : 0
        if (component.type === 'tilt_switch' && samePin(roles.signal, pin)) return component.state.tilted ? 1 : 0
        if ((component.type === 'joystick' || component.type === 'rotary_encoder') && samePin(roles.sw, pin)) {
          return component.state.pressed ? 0 : 1
        }
        if (component.type === 'rotary_encoder') {
          const phase = ((Math.round(numberOf(component.state.value, 0)) % 4) + 4) % 4
          const quadrature = [[0, 0], [1, 0], [1, 1], [0, 1]][phase]
          if (samePin(roles.clk, pin)) return quadrature[0]
          if (samePin(roles.dt, pin)) return quadrature[1]
        }
        // VS1838B-style receivers are active LOW: the output idles HIGH.
        if (component.type === 'ir_receiver' && samePin(roles.out, pin)) return component.state.active ? 0 : 1
        if (['ldr', 'sound_sensor', 'gas_sensor', 'flame_sensor'].includes(component.type) && samePin(roles.do, pin)) {
          return numberOf(component.state.level, 0) >= numberOf(component.state.threshold, 600) ? 1 : 0
        }
      }
      if (members.some(key => key.startsWith('P:') && snapshot.pins.some(entry => String(entry.pin) === key.slice(2) && entry.mode === 'INPUT_PULLUP'))) return 1
      if (state.pwm > 0) return 1
      if (state.value <= 1) return state.value === 0 ? 0 : 1
      // an analog channel read digitally trips at half scale
      return state.value > analogScale() / 2 ? 1 : 0
    },

    analogRead(requested) {
      const max = analogScale()
      const activeBoard = getBoard(store.getState().boardType)
      // Arduino AVR core: analogRead() takes a channel (0-5) or the pin number
      // of an analog pin (A0 = 14 on Uno), `if (pin >= 14) pin -= 14`.
      // `const int knobPin = A0` stores that number, so honour it here.
      let pin = requested
      if (activeBoard.arch === 'avr' && typeof pin === 'number' && Number.isInteger(pin)) {
        const channel = pin >= 14 ? pin - 14 : pin
        if (activeBoard.pins.some(entry => samePin(entry.id, `A${channel}`))) pin = `A${channel}`
      }
      const definition = activeBoard.pins.find((entry) => samePin(entry.id, pin))
      if (!definition?.adc) {
        hardware.warn(`analogRead(): pin ${pin} tidak memiliki ADC`)
        return 0
      }
      const sources = store.getState().components.flatMap((entry) => {
        if (entry.circuit && !entry.circuit.powered) return []
        const roles = rolePinsOf(entry)
        return (ANALOG_OUTPUT_ROLES[entry.type] ?? [])
          .filter(role => samePin(roles[role], pin))
          .map(role => ({ component: entry, role }))
      })
      if (sources.length > 1) {
        hardware.warn(`analogRead(${pin}): beberapa keluaran analog tersambung pada jalur yang sama`)
        return 0
      }
      const component = sources[0]?.component

      if (component) {
        if (component.type === 'lm35' || component.type === 'ntc_temp') {
          const reference = NOMINAL_ADC_FULL_SCALE[hardware.board.id]
          const celsius = numberOf(component.state.temperature, 25)
          if (component.type === 'lm35') return adcCounts(celsius * 0.01 / reference, max)
          // Use a directly connected nominal supply rail when available. Legacy
          // unsolved fixtures assume ratiometric supply; loaded rails are unmodeled.
          const snapshot = store.getState()
          const root = snapshot.circuitIndex.netOf[`T:${component.id}:vcc`]
          const members = root ? snapshot.circuitIndex.members[root] ?? [] : []
          const rail = hardware.board.pins.find(p => p.kind === 'power' && members.includes(`P:${p.id}`))
          const supply = rail?.volts ?? reference
          return adcCounts(ntcDividerFraction(celsius) * supply / reference, max)
        }
        // A pulse sensor outputs its PPG waveform, sampled now.
        if (component.type === 'heart_sensor') return adcCounts(pulseWaveCounts(performance.now() / 1000, numberOf(component.state.bpm, 72)) / 1023, max)
        const key = ANALOG_STATE_KEYS[component.type]
        if (key) {
          const raw = numberOf(component.state[key], 0)
          return adcCounts(raw / 1023, max)
        }
        if (component.type === 'joystick') {
          const axis = sources[0].role === 'vry' ? 'y' : 'x'
          return adcCounts(numberOf(component.state[axis], 512) / 1023, max)
        }
      }

      const state = store.getState().pins.find((entry) => samePin(entry.pin, pin))
      if (!state) return 0
      if (state.pwm > 0) return adcCounts(numberOf(state.pwm, 0) / 255, max)
      if (state.value === 1) return max
      return adcCounts(numberOf(state.value, 0) / 1023, max)
    },

    analogWrite(pin, value) {
      const clamped = Math.max(0, Math.min(255, Math.round(value)))
      const board = getBoard(store.getState().boardType)
      const definition = board.pins.find((entry) => samePin(entry.id, pin))
      if (!definition || (definition.kind !== 'gpio' && definition.kind !== 'analog')) {
        hardware.warn(`analogWrite(): pin ${pin} tidak valid`)
        return
      }
      if (definition.inputOnly) {
        hardware.warn(`analogWrite(): GPIO ${pin} hanya mendukung input`)
        return
      }
      store.getState().setPinMode(pin, 'OUTPUT')
      // On classic AVR boards analogWrite on a non-timer pin degrades to a
      // digital threshold rather than producing PWM.
      if (board.arch === 'avr' && !definition.pwm) {
        store.getState().updatePin(pin, clamped < 128 ? 0 : 1, 0)
        return
      }
      store.getState().updatePin(pin, clamped > 0 ? 1 : 0, clamped)
    },

    dacWrite(pin, value) {
      hardware.analogWrite(pin, value)
    },

    touchRead(pin) {
      const state = store.getState().pins.find((entry) => samePin(entry.pin, pin))
      // untouched pads read high; a pressed button on that pin reads low
      return state && state.value === 0 ? 12 : 78
    },

    i2cWrite(address, bytes, sda, scl) {
      const board = getBoard(store.getState().boardType)
      const [defaultSda, defaultScl] = defaultI2CPins(board.id)
      const busSda = hardware.resolvePin(sda ?? defaultSda)
      const busScl = hardware.resolvePin(scl ?? defaultScl)
      const devices = store.getState().components.filter((component) => {
        const expected = i2cAddressOf(component)
        if (expected !== address || (component.circuit && !component.circuit.powered)) return false
        const roles = rolePinsOf(component)
        return samePin(roles.sda, busSda) && samePin(roles.scl ?? roles.sck, busScl)
      })
      if (devices.length === 0) return 2
      if (devices.length > 1) return 4
      const device = devices[0]
      if (bytes.length > 0) i2cPointers.set(device.id, clampByte(bytes[0]))
      if (device.type === 'mpu6050' && bytes.length > 1) motionChip(device.id).write(clampByte(bytes[0]), bytes.slice(1).map(clampByte))
      if (device.type === 'ds1307' && bytes.length > 1) {
        const halted = device.state.clockHalted === true
        const set = clockChip(device.id).write(clampByte(bytes[0]), bytes.slice(1).map(clampByte), rtcEpoch(device.state), halted)
        // A halted oscillator keeps a fixed time (no anchor); a running one ticks from now.
        if (set) store.getState().updateComponentState(device.id, { epoch: set.epoch, epochSetAt: set.halted ? 0 : Date.now(), clockHalted: set.halted })
        i2cPointers.set(device.id, (clampByte(bytes[0]) + bytes.length - 1) & 0x3f)
      } else if (device.type === 'mpu6050' && bytes.length > 1) i2cPointers.set(device.id, (clampByte(bytes[0]) + bytes.length - 1) & 0x7f)
      if ((device.type === 'lcd' || device.type === 'lcd2004') && bytes.length > 0) {
        let lcd = lcdControllers.get(device.id)
        if (!lcd) { lcd = device.type === 'lcd2004' ? new Hd44780(4, 20) : new Hd44780(2, 16); lcdControllers.set(device.id, lcd) }
        let changed = false
        for (const byte of bytes) changed = lcd.expanderWrite(clampByte(byte)) || changed
        if (changed) store.getState().updateComponentState(device.id, { lines: lcd.lines(), backlight: lcd.backlight })
      } else if (device.type === 'ssd1306' && bytes.length > 1) {
        let oled = oledControllers.get(device.id)
        if (!oled) { oled = new Ssd1306(); oledControllers.set(device.id, oled) }
        if (oled.transaction(bytes.map(clampByte))) {
          store.getState().updateComponentState(device.id, {
            framebuffer: oled.framebuffer(), lines: [], inverted: oled.inverted, dimmed: oled.contrast === 0,
          })
        }
      }
      return 0
    },

    i2cRead(address, count, sda, scl) {
      count = Number.isFinite(count) ? Math.max(0, Math.min(256, Math.trunc(count))) : 0
      const board = getBoard(store.getState().boardType)
      const [defaultSda, defaultScl] = defaultI2CPins(board.id)
      const busSda = hardware.resolvePin(sda ?? defaultSda)
      const busScl = hardware.resolvePin(scl ?? defaultScl)
      const devices = store.getState().components.filter((component) => {
        const expected = i2cAddressOf(component)
        if (expected !== address || (component.circuit && !component.circuit.powered)) return false
        const roles = rolePinsOf(component)
        return samePin(roles.sda, busSda) && samePin(roles.scl ?? roles.sck, busScl)
      })
      if (devices.length !== 1) return []
      const device = devices[0]

      const register = i2cPointers.get(device.id) ?? 0
      let data: number[] = []
      if (device.type === 'mpu6050') data = motionChip(device.id).read(register, count, motionSample(device.state))
      else if (device.type === 'ds1307') data = clockChip(device.id).read(register, count, rtcEpoch(device.state), device.state.clockHalted === true)
      const result = data.slice(0, Math.max(0, count))
      while (result.length < count) result.push(0)
      i2cPointers.set(device.id, (register + result.length) & (device.type === 'ds1307' ? 0x3f : device.type === 'mpu6050' ? 0x7f : 0xff))
      return result
    },

    spiTransfer(value, pins) {
      const bus = pins ?? DEFAULT_SPI_PINS[hardware.board.id]
      if (!bus) return 0xff
      const selected = store.getState().components.filter((component) => {
        if (!['rfid', 'microsd', 'tft_ili9341', 'led_matrix'].includes(component.type)) return false
        if (component.circuit && !component.circuit.powered) return false
        const roles = rolePinsOf(component)
        if (!samePin(roles.mosi ?? roles.din, bus.mosi) || !samePin(roles.sck ?? roles.clk, bus.sck)) return false
        if (['rfid', 'microsd'].includes(component.type) && !samePin(roles.miso, bus.miso)) return false
        const cs = roles.cs ?? roles.sda
        if (cs === undefined) return false
        const pinState = store.getState().pins.find((entry) => samePin(entry.pin, cs))
        return pinState?.mode === 'OUTPUT' && pinState.value === 0
      })
      if (selected.length !== 1) return 0xff
      const device = selected[0]
      const byte = clampByte(value)
      store.getState().updateComponentState(device.id, { lastSpiByte: byte })
      if (device.type === 'microsd' && device.state.mounted !== true) return 0xff
      if (device.type === 'rfid') return device.state.cardPresent ? 0x92 : 0x00
      return 0x00
    },

    tone(pin, frequency, durationMs) {
      store.getState().updatePin(pin, frequency > 0 ? 1 : 0, frequency > 0 ? 255 : 0)
      const buzzer = hardware.componentOn('buzzer', pin, 'signal')
      if (buzzer) store.getState().updateComponentState(buzzer.id, { active: frequency > 0, frequency })
      clearToneTimer(pin)
      if (durationMs) {
        toneTimers.set(String(pin), window.setTimeout(() => { toneTimers.delete(String(pin)); hardware.noTone(pin) }, durationMs))
      }
    },

    dispose() {
      for (const timer of toneTimers.values()) window.clearTimeout(timer)
      toneTimers.clear()
    },

    noTone(pin) {
      clearToneTimer(pin)
      store.getState().updatePin(pin, 0, 0)
      const buzzer = hardware.componentOn('buzzer', pin, 'signal')
      if (buzzer) store.getState().updateComponentState(buzzer.id, { active: false, frequency: 0 })
    },

    pulseIn(pin, value, timeoutUs) {
      // HC-SR04 echo: 58µs of pulse per centimetre
      const ultrasonic = hardware.componentOn('ultrasonic', pin, 'echo')
      if (!ultrasonic?.powered || value !== 1 || !Number.isFinite(timeoutUs) || timeoutUs <= 0) return 0
      const duration = Math.round(numberOf(ultrasonic.state.distanceCm, 0) * 58)
      return duration > 0 && duration <= timeoutUs ? duration : 0
    },

    serialWrite(text) {
      store.getState().appendSerial(text)
    },

    serialBaud(baud) {
      if (store.getState().sketchBaud !== baud) store.setState({ sketchBaud: baud })
    },

    serialAvailable() {
      return store.getState().serialInput.length
    },

    serialRead() {
      const { serialInput } = store.getState()
      if (serialInput.length === 0) return -1
      const [first, ...rest] = serialInput
      useKodyUnoStore.setState({ serialInput: rest })
      return first
    },

    serialPeek() {
      return store.getState().serialInput[0] ?? -1
    },

    serialReadAll() {
      const { serialInput } = store.getState()
      useKodyUnoStore.setState({ serialInput: [] })
      return serialInput.map((code) => String.fromCharCode(code)).join('')
    },

    components: views,

    componentsOfType(type) {
      return views().filter((entry) => entry.type === type)
    },

    componentOn(type, pin, role) {
      return views().find((entry) => {
        if (entry.type !== type) return false
        if (role) return samePin(entry.rolePins[role], pin)
        return Object.values(entry.rolePins).some(value => samePin(value, pin))
      })
    },

    patchComponent(id, patch) {
      store.getState().updateComponentState(id, patch)
    },

    warn(message) {
      store.getState().appendSerial(`[KodyUno] ${message}\n`)
    },

    resolvePin(pin) {
      const board = getBoard(store.getState().boardType)
      if (typeof pin === 'string') {
        const alias = board.aliases[pin]
        if (alias !== undefined) return alias
        return pin
      }
      return pin
    },
  }

  return hardware
}
