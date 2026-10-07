// ============================================================
// 1-Wire bus with DS18B20 temperature sensors, device side.
//
// The firmware drives the DQ line (pinMode/digitalWrite from the OneWire
// library); every change of the master's pull reaches `OneWireBus.master`
// with its exact CPU cycle. The sensors answer on the same wire exactly as
// the datasheet times it: presence pulse after a reset, a 0 bit held low for
// 30 µs in a read slot, write slots decoded from how long the master held
// the line low. Several sensors on one pin share the wire (wired-AND), so
// SEARCH ROM enumerates them like on a real bus.
// ============================================================

const US = 16 // CPU cycles per microsecond at 16 MHz

/** Master low time that ends a write-1 slot (datasheet: release within 15 µs). */
const WRITE_ONE_MAX = 15 * US
/** Anything held low this long is a reset pulse (spec: 480 µs minimum). */
const RESET_MIN = 450 * US
/** DS18B20 waits 15–60 µs after a reset, then pulls low 60–240 µs. */
const PRESENCE_DELAY = 30 * US
const PRESENCE_LENGTH = 120 * US
/** How long a sensor holds the line for a 0 in a read slot (valid 15–60 µs). */
const READ_ZERO_LENGTH = 30 * US

export const DS18B20_FAMILY = 0x28
/** Scratchpad temperature at power-up, before the first conversion. */
export const DS18B20_POWER_ON_C = 85
/** Conversion time for 9/10/11/12-bit resolution. */
export const DS18B20_CONVERSION_MS: Record<number, number> = { 9: 93.75, 10: 187.5, 11: 375, 12: 750 }

/** Dallas/Maxim CRC-8 (x^8 + x^5 + x^4 + 1, LSB first). */
export function crc8(bytes: ArrayLike<number>, length = bytes.length): number {
  let crc = 0
  for (let i = 0; i < length; i++) {
    let byte = bytes[i] & 0xff
    for (let bit = 0; bit < 8; bit++) {
      const mix = (crc ^ byte) & 1
      crc >>= 1
      if (mix) crc ^= 0x8c
      byte >>= 1
    }
  }
  return crc
}

/** 64-bit ROM code: family 0x28, a 48-bit serial derived from the part id, CRC. */
export function ds18b20Rom(partId: string): number[] {
  let hash = 0x811c9dc5
  const serial: number[] = []
  for (let i = 0; i < 6; i++) {
    for (const char of `${partId}#${i}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
    serial.push(hash & 0xff)
  }
  const rom = [DS18B20_FAMILY, ...serial]
  return [...rom, crc8(rom)]
}

export function resolutionFromConfig(config: number): number {
  return 9 + ((config >> 5) & 3)
}

/** Temperature register (1/16 °C, two's complement) at a given resolution. */
export function ds18b20Raw(celsius: number, resolution: number): number {
  const clamped = Math.max(-55, Math.min(125, Number.isFinite(celsius) ? celsius : DS18B20_POWER_ON_C))
  const raw = Math.round(clamped * 16)
  const drop = 12 - Math.max(9, Math.min(12, resolution))
  return ((raw >> drop) << drop) & 0xffff
}

/** The value DallasTemperature::getTempC prints for a raw register. */
export function ds18b20Celsius(raw: number): number {
  return ((raw & 0x8000 ? raw - 0x10000 : raw) / 16)
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'rom' | 'func' | 'matchRom' | 'writeScratch'; bits: number[] }
  | { kind: 'send'; bits: number[]; then: 'func' | 'idle' | 'ones' }
  | { kind: 'search'; bit: number; step: 0 | 1 | 2 }
  | { kind: 'busy'; until: number }
  | { kind: 'ones' }

export class Ds18b20 {
  readonly rom: number[]
  /** TH, TL and configuration as last written (scratchpad bytes 2–4). */
  th = 0x4b
  tl = 0x46
  config = 0x7f
  /** Copies in the chip's EEPROM (COPY SCRATCHPAD / RECALL E²). */
  private eeprom = { th: 0x4b, tl: 0x46, config: 0x7f }
  raw = ds18b20Raw(DS18B20_POWER_ON_C, 12)
  private conversionEnds = -1
  private phase: Phase = { kind: 'idle' }

  private readonly temperature: () => number

  constructor(partId: string, temperature: () => number) {
    this.rom = ds18b20Rom(partId)
    this.temperature = temperature
  }

  get resolution() { return resolutionFromConfig(this.config) }

  scratchpad(cycle: number): number[] {
    this.finishConversion(cycle)
    const bytes = [this.raw & 0xff, this.raw >> 8, this.th, this.tl, this.config, 0xff, 0x0c, 0x10]
    return [...bytes, crc8(bytes)]
  }

  /** Alarm flag for ALARM SEARCH: integer part of T at or beyond TH / TL. */
  alarm(cycle: number): boolean {
    this.finishConversion(cycle)
    const whole = Math.trunc(ds18b20Celsius(this.raw))
    const signed = (value: number) => (value & 0x80 ? value - 0x100 : value)
    return whole >= signed(this.th) || whole <= signed(this.tl)
  }

  private finishConversion(cycle: number) {
    if (this.conversionEnds >= 0 && cycle >= this.conversionEnds) {
      this.raw = ds18b20Raw(this.temperature(), this.resolution)
      this.conversionEnds = -1
    }
  }

  reset() { this.phase = { kind: 'rom', bits: [] } }

  /**
   * A time slot starts. Returns the bit this sensor sends (1 = leave the wire
   * high), or null when it is listening, so the slot is a write slot for it.
   */
  readSlot(cycle: number): number | null {
    const phase = this.phase
    switch (phase.kind) {
      case 'send': {
        const bit = phase.bits.shift() ?? 1
        if (!phase.bits.length) this.phase = phase.then === 'func' ? { kind: 'func', bits: [] } : phase.then === 'ones' ? { kind: 'ones' } : { kind: 'idle' }
        return bit
      }
      case 'search': {
        if (phase.step === 2) return null
        const bit = (this.rom[phase.bit >> 3] >> (phase.bit & 7)) & 1
        const out = phase.step === 0 ? bit : bit ^ 1
        phase.step = phase.step === 0 ? 1 : 2
        return out
      }
      case 'busy': return cycle >= phase.until ? 1 : 0
      case 'ones': return 1
      default: return null
    }
  }

  /** A write slot from the master. */
  writeSlot(bit: number, cycle: number) {
    const phase = this.phase
    switch (phase.kind) {
      case 'rom':
      case 'func':
      case 'matchRom':
      case 'writeScratch': {
        phase.bits.push(bit)
        const needed = phase.kind === 'matchRom' ? 64 : phase.kind === 'writeScratch' ? 24 : 8
        if (phase.bits.length === needed) this.completeBits(phase.kind, phase.bits, cycle)
        return
      }
      case 'search': {
        if (phase.step !== 2) return // master wrote where it should read: ignore
        const own = (this.rom[phase.bit >> 3] >> (phase.bit & 7)) & 1
        if (bit !== own) { this.phase = { kind: 'idle' }; return }
        if (phase.bit === 63) { this.phase = { kind: 'func', bits: [] }; return }
        this.phase = { kind: 'search', bit: phase.bit + 1, step: 0 }
        return
      }
      default:
        return
    }
  }

  private completeBits(kind: 'rom' | 'func' | 'matchRom' | 'writeScratch', bits: number[], cycle: number) {
    const bytes: number[] = []
    for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((acc, b, j) => acc | (b << j), 0))
    if (kind === 'matchRom') {
      this.phase = bytes.every((byte, i) => byte === this.rom[i]) ? { kind: 'func', bits: [] } : { kind: 'idle' }
      return
    }
    if (kind === 'writeScratch') {
      this.th = bytes[0]
      this.tl = bytes[1]
      this.config = (bytes[2] & 0x60) | 0x1f
      this.phase = { kind: 'idle' }
      return
    }
    const command = bytes[0]
    if (kind === 'rom') {
      switch (command) {
        case 0x33: this.phase = { kind: 'send', bits: bitsOf(this.rom), then: 'func' }; return // READ ROM
        case 0x55: this.phase = { kind: 'matchRom', bits: [] }; return // MATCH ROM
        case 0xcc: this.phase = { kind: 'func', bits: [] }; return // SKIP ROM
        case 0xf0: this.phase = { kind: 'search', bit: 0, step: 0 }; return // SEARCH ROM
        case 0xec: this.phase = this.alarm(cycle) ? { kind: 'search', bit: 0, step: 0 } : { kind: 'idle' }; return // ALARM SEARCH
        default: this.phase = { kind: 'idle' }; return
      }
    }
    switch (command) {
      case 0x44: { // CONVERT T
        this.finishConversion(cycle)
        const until = cycle + Math.round(DS18B20_CONVERSION_MS[this.resolution] * 1000 * US)
        this.conversionEnds = until
        this.phase = { kind: 'busy', until }
        return
      }
      case 0xbe: this.phase = { kind: 'send', bits: bitsOf(this.scratchpad(cycle)), then: 'ones' }; return // READ SCRATCHPAD
      case 0x4e: this.phase = { kind: 'writeScratch', bits: [] }; return // WRITE SCRATCHPAD
      case 0x48: // COPY SCRATCHPAD (10 ms EEPROM write)
        this.eeprom = { th: this.th, tl: this.tl, config: this.config }
        this.phase = { kind: 'busy', until: cycle + 10_000 * US }
        return
      case 0xb8: // RECALL E²
        this.th = this.eeprom.th
        this.tl = this.eeprom.tl
        this.config = this.eeprom.config
        this.phase = { kind: 'ones' }
        return
      case 0xb4: this.phase = { kind: 'ones' }; return // READ POWER SUPPLY: 1 = VDD powered
      default: this.phase = { kind: 'idle' }
    }
  }
}

function bitsOf(bytes: number[]): number[] {
  const bits: number[] = []
  for (const byte of bytes) for (let bit = 0; bit < 8; bit++) bits.push((byte >> bit) & 1)
  return bits
}

export interface OneWireHooks {
  /** Run `task` this many CPU cycles from now. */
  after(cycles: number, task: () => void): void
  /** The sensors' combined pull on the wire changed (true = held low). */
  line(low: boolean): void
}

/** One DQ wire with every sensor on it. */
export class OneWireBus {
  private masterLow = false
  private lowSince = 0
  /** Sensors pulling the wire low, by reason; the wire is low while any holds it. */
  private holds = 0
  /** Sensors that sent a bit in the current slot; the slot's end is not a write for them. */
  private sending: boolean[] = []

  readonly devices: Ds18b20[]
  private readonly hooks: OneWireHooks

  constructor(devices: Ds18b20[], hooks: OneWireHooks) {
    this.devices = devices
    this.hooks = hooks
  }

  get deviceLow() { return this.holds > 0 }

  private hold(cycles: number) {
    this.holds += 1
    if (this.holds === 1) this.hooks.line(true)
    this.hooks.after(cycles, () => {
      this.holds -= 1
      if (this.holds === 0) this.hooks.line(false)
    })
  }

  /** The master's own pull on the wire (OUTPUT + LOW) changed at `cycle`. */
  master(low: boolean, cycle: number) {
    if (low === this.masterLow) return
    this.masterLow = low
    if (low) {
      this.lowSince = cycle
      // Start of a time slot: a sensor sending a 0 holds the wire from here.
      let zero = false
      this.sending = this.devices.map(device => {
        const bit = device.readSlot(cycle)
        if (bit === 0) zero = true
        return bit !== null
      })
      if (zero) this.hold(READ_ZERO_LENGTH)
      return
    }
    const held = cycle - this.lowSince
    if (held >= RESET_MIN) {
      for (const device of this.devices) device.reset()
      if (this.devices.length) this.hooks.after(PRESENCE_DELAY, () => this.hold(PRESENCE_LENGTH))
      return
    }
    const bit = held < WRITE_ONE_MAX ? 1 : 0
    this.devices.forEach((device, i) => { if (!this.sending[i]) device.writeSlot(bit, cycle) })
  }
}

/**
 * The master side at bit level, for the interpreter: the same sensors and
 * commands as on firmware, timed by the sketch clock instead of CPU cycles.
 * `search` is OneWire::search, so devices enumerate in the library's order.
 */
export class OneWireMaster {
  private readonly devices: () => Ds18b20[]
  /** Sketch time in 16 MHz CPU cycles. */
  private readonly now: () => number
  private romNo = [0, 0, 0, 0, 0, 0, 0, 0]
  private lastDiscrepancy = 0
  private lastDeviceFlag = false

  constructor(devices: () => Ds18b20[], now: () => number) {
    this.devices = devices
    this.now = now
  }

  /** 1 when a presence pulse answered the reset. */
  reset(): number {
    const devices = this.devices()
    for (const device of devices) device.reset()
    return devices.length ? 1 : 0
  }

  writeBit(bit: number) {
    const cycle = this.now()
    for (const device of this.devices()) if (device.readSlot(cycle) === null) device.writeSlot(bit ? 1 : 0, cycle)
  }

  readBit(): number {
    const cycle = this.now()
    let level = 1
    for (const device of this.devices()) {
      const bit = device.readSlot(cycle)
      // A listening sensor sees the read slot as a write-1 slot.
      if (bit === null) device.writeSlot(1, cycle)
      else level &= bit
    }
    return level
  }

  write(byte: number) { for (let bit = 0; bit < 8; bit++) this.writeBit((byte >> bit) & 1) }

  read(): number {
    let byte = 0
    for (let bit = 0; bit < 8; bit++) byte |= this.readBit() << bit
    return byte
  }

  select(rom: ArrayLike<number>) {
    this.write(0x55)
    for (let i = 0; i < 8; i++) this.write(rom[i] ?? 0)
  }

  skip() { this.write(0xcc) }

  resetSearch() {
    this.lastDiscrepancy = 0
    this.lastDeviceFlag = false
    this.romNo = [0, 0, 0, 0, 0, 0, 0, 0]
  }

  /** Next ROM code on the bus, or null after the last one (then starts over). */
  search(alarmOnly = false): number[] | null {
    let idBitNumber = 1, lastZero = 0, romByte = 0, mask = 1, found = false
    if (!this.lastDeviceFlag) {
      if (!this.reset()) { this.resetSearch(); return null }
      this.write(alarmOnly ? 0xec : 0xf0)
      do {
        const idBit = this.readBit(), cmpBit = this.readBit()
        if (idBit && cmpBit) break
        let direction: number
        if (idBit !== cmpBit) direction = idBit
        else {
          direction = idBitNumber < this.lastDiscrepancy ? ((this.romNo[romByte] & mask) > 0 ? 1 : 0) : (idBitNumber === this.lastDiscrepancy ? 1 : 0)
          if (direction === 0) lastZero = idBitNumber
        }
        this.romNo[romByte] = direction ? this.romNo[romByte] | mask : this.romNo[romByte] & ~mask & 0xff
        this.writeBit(direction)
        idBitNumber += 1
        mask = (mask << 1) & 0xff
        if (mask === 0) { romByte += 1; mask = 1 }
      } while (romByte < 8)
      if (idBitNumber >= 65) {
        this.lastDiscrepancy = lastZero
        if (this.lastDiscrepancy === 0) this.lastDeviceFlag = true
        found = true
      }
    }
    if (!found || !this.romNo[0]) { this.resetSearch(); return null }
    return [...this.romNo]
  }
}
