// Register-level I2C display controllers, as the real chips behave.
//
// Real firmware (and raw Wire code in the interpreter) talks to displays in
// bytes, not in "print this text" calls. These models turn those bytes into
// what the part shows, the way Wokwi's parts do:
//   - HD44780 character LCD behind a PCF8574 I2C backpack (LiquidCrystal_I2C)
//   - SSD1306 128×64 OLED (Adafruit_SSD1306 over I2C)

/** PCF8574 → HD44780 wiring used by every common LCD backpack. */
const RS = 0x01, EN = 0x04, BACKLIGHT = 0x08

/** DDRAM start address of each LCD row (16×2, 20×4). */
const ROW_OFFSETS = [0x00, 0x40, 0x14, 0x54]

export class Hd44780 {
  private readonly ddram = new Uint8Array(0x80).fill(0x20)
  private address = 0
  private increment = true
  private displayOn = true
  private fourBit = false
  private pendingNibble: number | null = null
  private cgram = false
  private lastPort = 0
  backlight = true

  readonly rows: number
  readonly cols: number
  constructor(rows: number, cols: number) { this.rows = rows; this.cols = cols }

  /** One byte written to the PCF8574 port. Returns true when the display changed. */
  expanderWrite(port: number): boolean {
    const falling = (this.lastPort & EN) && !(port & EN)
    this.lastPort = port
    const backlight = (port & BACKLIGHT) !== 0
    let changed = backlight !== this.backlight
    this.backlight = backlight
    // The controller latches D4–D7 on the falling edge of EN, reading them
    // from the port byte that was on the bus while EN was high.
    if (falling) changed = this.nibble((port >> 4) & 0x0f, (port & RS) !== 0) || changed
    return changed
  }

  private nibble(value: number, data: boolean): boolean {
    if (!this.fourBit) {
      // 8-bit mode during init: each strobe carries the high nibble of a command.
      return this.command(value << 4)
    }
    if (this.pendingNibble === null) { this.pendingNibble = value; return false }
    const byte = (this.pendingNibble << 4) | value
    this.pendingNibble = null
    return data ? this.write(byte) : this.command(byte)
  }

  private command(cmd: number): boolean {
    if (cmd & 0x80) { this.cgram = false; this.address = cmd & 0x7f; return false }
    if (cmd & 0x40) { this.cgram = true; return false }
    if (cmd & 0x20) { this.fourBit = (cmd & 0x10) === 0; this.pendingNibble = null; return false }
    if (cmd & 0x10) {
      // Cursor move (S/C = 0); display shift is rarely used by sketches.
      if (!(cmd & 0x08)) this.address = (this.address + ((cmd & 0x04) ? 1 : -1)) & 0x7f
      return false
    }
    if (cmd & 0x08) { const on = (cmd & 0x04) !== 0; const changed = on !== this.displayOn; this.displayOn = on; return changed }
    if (cmd & 0x04) { this.increment = (cmd & 0x02) !== 0; return false }
    if (cmd & 0x02) { this.address = 0; return false }
    if (cmd & 0x01) { this.ddram.fill(0x20); this.address = 0; this.increment = true; return true }
    return false
  }

  private write(byte: number): boolean {
    if (this.cgram) return false
    this.ddram[this.address & 0x7f] = byte
    this.address = (this.address + (this.increment ? 1 : -1)) & 0x7f
    return true
  }

  lines(): string[] {
    if (!this.displayOn) return Array.from({ length: this.rows }, () => '')
    return Array.from({ length: this.rows }, (_, row) => {
      let text = ''
      for (let col = 0; col < this.cols; col++) {
        const code = this.ddram[(ROW_OFFSETS[row] + col) & 0x7f]
        // 0–7 are custom CGRAM glyphs; show a block rather than nothing.
        text += code < 8 ? '█' : code < 0x20 || code > 0x7e ? ' ' : String.fromCharCode(code)
      }
      return text
    })
  }
}

/** Parameter bytes that follow each SSD1306 command. */
const SSD1306_ARGS: Record<number, number> = {
  0x81: 1, 0x8d: 1, 0xd5: 1, 0xa8: 1, 0xd3: 1, 0x20: 1, 0x21: 2, 0x22: 2, 0xda: 1, 0xd9: 1, 0xdb: 1,
  0xa3: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5,
}

export class Ssd1306 {
  readonly pixels = new Uint8Array(128 * 64)
  private mode = 2 // page addressing after reset
  private colStart = 0; private colEnd = 127
  private pageStart = 0; private pageEnd = 7
  private col = 0; private page = 0
  private pendingCommand: number[] = []
  inverted = false
  displayOn = false
  contrast = 0x7f

  /** One I2C transaction's bytes (control byte first). Returns true if the screen changed. */
  transaction(bytes: number[]): boolean {
    let changed = false
    let i = 0
    while (i < bytes.length) {
      const control = bytes[i++]
      const single = (control & 0x80) !== 0 // Co bit: one byte, then another control byte
      const isData = (control & 0x40) !== 0
      const end = single ? Math.min(i + 1, bytes.length) : bytes.length
      for (; i < end; i++) changed = (isData ? this.data(bytes[i]) : this.command(bytes[i])) || changed
    }
    return changed
  }

  private command(byte: number): boolean {
    if (this.pendingCommand.length) {
      this.pendingCommand.push(byte)
      const [cmd, ...args] = this.pendingCommand
      if (args.length < SSD1306_ARGS[cmd]) return false
      this.pendingCommand = []
      if (cmd === 0x20) this.mode = args[0] & 0x03
      else if (cmd === 0x21) { this.colStart = args[0] & 0x7f; this.colEnd = args[1] & 0x7f; this.col = this.colStart }
      else if (cmd === 0x22) { this.pageStart = args[0] & 0x07; this.pageEnd = args[1] & 0x07; this.page = this.pageStart }
      else if (cmd === 0x81) { const changed = (args[0] === 0) !== (this.contrast === 0); this.contrast = args[0]; return changed }
      return false
    }
    if (SSD1306_ARGS[byte] !== undefined) { this.pendingCommand = [byte]; return false }
    if (byte === 0xae || byte === 0xaf) { const on = byte === 0xaf; const changed = on !== this.displayOn; this.displayOn = on; return changed }
    if (byte === 0xa6 || byte === 0xa7) { const inv = byte === 0xa7; const changed = inv !== this.inverted; this.inverted = inv; return changed }
    if (byte >= 0xb0 && byte <= 0xb7) { this.page = byte & 0x07; return false }
    if (byte <= 0x0f) { this.col = (this.col & 0xf0) | byte; return false }
    if (byte >= 0x10 && byte <= 0x1f) { this.col = ((byte & 0x0f) << 4) | (this.col & 0x0f); return false }
    return false
  }

  private data(byte: number): boolean {
    const x = this.col & 0x7f, top = (this.page & 0x07) * 8
    let changed = false
    for (let bit = 0; bit < 8; bit++) {
      const index = (top + bit) * 128 + x
      const value = (byte >> bit) & 1
      if (this.pixels[index] !== value) { this.pixels[index] = value; changed = true }
    }
    if (this.mode === 0) { // horizontal
      if (++this.col > this.colEnd) { this.col = this.colStart; if (++this.page > this.pageEnd) this.page = this.pageStart }
    } else if (this.mode === 1) { // vertical
      if (++this.page > this.pageEnd) { this.page = this.pageStart; if (++this.col > this.colEnd) this.col = this.colStart }
    } else if (this.col < 127) this.col++
    return changed
  }

  /** What the part shows: a blank panel while the display is off. */
  framebuffer(): number[] {
    return this.displayOn ? Array.from(this.pixels) : new Array(128 * 64).fill(0)
  }
}

const clamp16 = (value: number) => {
  const signed = Math.max(-32768, Math.min(32767, Math.round(value)))
  return signed < 0 ? 0x10000 + signed : signed
}

/** Physical readings an MPU6050 samples (g, °/s, °C). */
export interface MotionSample { ax: number; ay: number; az: number; gx: number; gy: number; gz: number; temperature: number }

/**
 * InvenSense MPU-6050 register file: powers up asleep (PWR_MGMT_1 = 0x40),
 * DEVICE_RESET restores defaults, ACCEL_CONFIG/GYRO_CONFIG full-scale select
 * the LSB weight of the data registers, WHO_AM_I = 0x68.
 */
export class Mpu6050 {
  readonly regs = new Uint8Array(128)
  constructor() { this.reset() }
  reset() {
    this.regs.fill(0)
    this.regs[0x6b] = 0x40
    this.regs[0x75] = 0x68
  }
  get sleeping() { return (this.regs[0x6b] & 0x40) !== 0 }
  write(pointer: number, data: number[]) {
    for (const byte of data) {
      const reg = pointer & 0x7f
      if (reg === 0x6b && byte & 0x80) this.reset()
      else if (reg !== 0x75 && (reg < 0x3b || reg > 0x60)) this.regs[reg] = byte & 0xff
      pointer++
    }
  }
  read(pointer: number, count: number, sample: MotionSample): number[] {
    if (!this.sleeping) {
      const accelLsb = 16384 / (1 << ((this.regs[0x1c] >> 3) & 3))
      const gyroLsb = 131 / (1 << ((this.regs[0x1b] >> 3) & 3))
      const words = [sample.ax * accelLsb, sample.ay * accelLsb, sample.az * accelLsb, (sample.temperature - 36.53) * 340,
        sample.gx * gyroLsb, sample.gy * gyroLsb, sample.gz * gyroLsb]
      words.forEach((value, i) => { const w = clamp16(value); this.regs[0x3b + i * 2] = w >> 8; this.regs[0x3c + i * 2] = w & 0xff })
    }
    return Array.from({ length: count }, (_, i) => this.regs[(pointer + i) & 0x7f])
  }
}

const toBcd = (value: number) => ((Math.floor(value / 10) << 4) | (value % 10)) & 0xff
const fromBcd = (value: number) => (value >> 4) * 10 + (value & 0x0f)

/**
 * Maxim DS1307: seven BCD time registers (CH = seconds bit 7 halts the
 * oscillator, 12/24-hour mode in the hours register), control register 0x07
 * and 56 bytes of battery-backed RAM; the register pointer wraps at 0x3F.
 */
export class Ds1307 {
  readonly ram = new Uint8Array(64)
  hour12 = false
  /** Time as Unix seconds (UTC calendar) — supplied by the part state. */
  read(pointer: number, count: number, epoch: number, halted: boolean): number[] {
    const date = new Date(epoch * 1000)
    const hours = date.getUTCHours()
    const hourReg = this.hour12
      ? 0x40 | (hours >= 12 ? 0x20 : 0) | toBcd(((hours + 11) % 12) + 1)
      : toBcd(hours)
    const time = [toBcd(date.getUTCSeconds()) | (halted ? 0x80 : 0), toBcd(date.getUTCMinutes()), hourReg,
      date.getUTCDay() + 1, toBcd(date.getUTCDate()), toBcd(date.getUTCMonth() + 1), toBcd(date.getUTCFullYear() % 100)]
    return Array.from({ length: count }, (_, i) => {
      const reg = (pointer + i) & 0x3f
      return reg < 7 ? time[reg] : this.ram[reg]
    })
  }
  /**
   * Register write starting at `pointer`. Returns the new clock setting when
   * any time register was written: the epoch it now shows and whether CH is set.
   */
  write(pointer: number, data: number[], epoch: number, halted: boolean): { epoch: number; halted: boolean } | null {
    const time = this.read(0, 7, epoch, halted)
    let touched = false
    for (const byte of data) {
      const reg = pointer & 0x3f
      if (reg < 7) { time[reg] = byte & 0xff; touched = true } else this.ram[reg] = byte & 0xff
      pointer++
    }
    if (!touched) return null
    this.hour12 = (time[2] & 0x40) !== 0
    const hours = this.hour12 ? (fromBcd(time[2] & 0x1f) % 12) + (time[2] & 0x20 ? 12 : 0) : fromBcd(time[2] & 0x3f)
    const next = Date.UTC(2000 + fromBcd(time[6]), fromBcd(time[5] & 0x1f) - 1, fromBcd(time[4] & 0x3f), hours, fromBcd(time[1] & 0x7f), fromBcd(time[0] & 0x7f)) / 1000
    return { epoch: Number.isFinite(next) ? next : epoch, halted: (time[0] & 0x80) !== 0 }
  }
}
