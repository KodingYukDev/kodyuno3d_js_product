// Register-level SPI chips for compiled firmware, driven byte by byte from the
// AVR SPI peripheral. The real Arduino libraries (MFRC522, Adafruit_ILI9341)
// talk to these exactly as they talk to hardware, so what a sketch sees here
// (timeouts, CRC checks, ACK nibbles, MADCTL rotation) matches a real module.

/** ISO 14443-3 CRC_A, low byte first (what the MFRC522 CalcCRC command returns). */
export function crcA(bytes: ArrayLike<number>): [number, number] {
  let crc = 0x6363
  for (let i = 0; i < bytes.length; i++) {
    let b = (bytes[i] ^ crc) & 0xff
    b = (b ^ (b << 4)) & 0xff
    crc = ((crc >> 8) ^ (b << 8) ^ (b << 3) ^ (b >> 4)) & 0xffff
  }
  return [crc & 0xff, crc >> 8]
}

const withCrc = (bytes: number[]) => [...bytes, ...crcA(bytes)]
const crcOk = (frame: number[]) => {
  if (frame.length < 3) return false
  const [lo, hi] = crcA(frame.slice(0, -2))
  return frame[frame.length - 2] === lo && frame[frame.length - 1] === hi
}

/** MIFARE Classic 1K ("S50" white card / blue key fob) with factory keys. */
export class MifareClassic {
  readonly blocks: Uint8Array[] = Array.from({ length: 64 }, () => new Uint8Array(16))
  state: 'idle' | 'ready' | 'active' | 'halt' = 'idle'
  /** Cascade level reached during anticollision (0-based). */
  level = 0
  /** Sector unlocked by MFAuthent, or -1. */
  authSector = -1
  /** Pending two-step command (WRITE / value ops) waiting for its data frame. */
  pending: { command: number; block: number } | null = null
  /** Value-block result register for INC/DEC/RESTORE → TRANSFER. */
  transferValue: number[] | null = null

  readonly uid: number[]

  constructor(uid: number[]) {
    this.uid = uid
    const block0 = this.blocks[0]
    const nuid = uid.slice(0, 4)
    block0.set(nuid)
    block0[4] = nuid.reduce((x, b) => x ^ b, 0)
    block0.set([0x08, 0x04, 0x00, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69], 5)
    for (let sector = 0; sector < 16; sector++) {
      this.blocks[sector * 4 + 3].set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x07, 0x80, 0x69, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    }
  }

  /** UID bytes for one cascade level, with the cascade tag when more follow. */
  private cascade(level: number): number[] {
    const u = this.uid
    if (u.length === 4) return u
    if (u.length === 7) return level === 0 ? [0x88, u[0], u[1], u[2]] : u.slice(3, 7)
    return level === 0 ? [0x88, u[0], u[1], u[2]] : level === 1 ? [0x88, u[3], u[4], u[5]] : u.slice(6, 10)
  }
  private get levels() { return this.uid.length === 4 ? 1 : this.uid.length === 7 ? 2 : 3 }

  /** Sector trailer check for MFAuthent (factory access bits: key A or B opens everything). */
  authenticate(keyType: number, block: number, key: number[], uid: number[]): boolean {
    if (this.state !== 'active' || block > 63) return false
    // The reader mixes the last four UID bytes into Crypto1; a wrong UID never authenticates.
    if (!this.uid.slice(-4).every((b, i) => b === uid[i])) return false
    const trailer = this.blocks[(block & ~3) + 3]
    const expected = keyType === 0x61 ? trailer.slice(10, 16) : trailer.slice(0, 6)
    if (!key.every((b, i) => b === expected[i])) return false
    this.authSector = block >> 2
    return true
  }

  /**
   * One frame from the reader. Returns the card's answer and the number of
   * valid bits in its last byte (0 = 8), or null for no answer (reader times out).
   */
  frame(bytes: number[], txLastBits: number): { data: number[]; lastBits: number } | null {
    const ack = { data: [0x0a], lastBits: 4 }
    const nak = { data: [0x04], lastBits: 4 }
    const cmd = bytes[0]
    if (txLastBits === 7 && bytes.length === 1) {
      // REQA answers from IDLE only; WUPA also wakes a halted card.
      if (cmd === 0x26 ? this.state === 'idle' : cmd === 0x52 && this.state !== 'ready') {
        this.state = 'ready'; this.level = 0; this.authSector = -1; this.pending = null
        return { data: this.uid.length === 4 ? [0x04, 0x00] : this.uid.length === 7 ? [0x44, 0x00] : [0x84, 0x00], lastBits: 0 }
      }
      if (this.state === 'active') this.state = 'idle'
      return null
    }
    if (this.state === 'ready' && (cmd === 0x93 || cmd === 0x95 || cmd === 0x97)) {
      const level = (cmd - 0x93) / 2
      if (level !== this.level) { this.state = 'idle'; return null }
      const part = this.cascade(level)
      const bcc = part.reduce((x, b) => x ^ b, 0)
      if (bytes[1] === 0x20 && bytes.length === 2 && txLastBits === 0) return { data: [...part, bcc], lastBits: 0 }
      if (bytes[1] === 0x70 && bytes.length === 9 && crcOk(bytes)) {
        if (!part.every((b, i) => b === bytes[2 + i]) || bytes[6] !== bcc) return null
        const more = level + 1 < this.levels
        if (more) this.level++
        else this.state = 'active'
        return { data: withCrc([more ? 0x04 : 0x08]), lastBits: 0 }
      }
      return null
    }
    if (cmd === 0x50 && bytes[1] === 0x00 && bytes.length === 4 && this.state === 'active') {
      this.state = 'halt'; this.authSector = -1
      return null
    }
    if (this.state !== 'active') return null

    if (this.pending) {
      const { command, block } = this.pending
      this.pending = null
      if (command === 0xa0) {
        if (bytes.length !== 18 || !crcOk(bytes)) return nak
        this.blocks[block].set(bytes.slice(0, 16))
        return ack
      }
      // INC / DEC / RESTORE data frame: the card stays silent (library accepts the timeout).
      if (bytes.length !== 6 || !crcOk(bytes)) return null
      const current = this.readValue(block)
      if (current === null) return null
      const operand = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) | 0
      const result = command === 0xc1 ? current + operand : command === 0xc0 ? current - operand : current
      this.transferValue = [result & 0xff, (result >> 8) & 0xff, (result >> 16) & 0xff, (result >>> 24) & 0xff]
      return null
    }
    if (!crcOk(bytes)) { this.state = 'idle'; return null }
    const block = bytes[1]
    const unlocked = block < 64 && block >> 2 === this.authSector
    switch (cmd) {
      case 0x30: { // READ: 16 bytes; key A always reads back as zeros
        if (!unlocked) { this.state = 'idle'; return nak }
        const data = Array.from(this.blocks[block])
        if ((block & 3) === 3) data.fill(0, 0, 6)
        return { data: withCrc(data), lastBits: 0 }
      }
      case 0xa0: // WRITE step 1; block 0 (manufacturer) is read-only
        if (!unlocked || block === 0) return nak
        this.pending = { command: cmd, block }
        return ack
      case 0xc0: case 0xc1: case 0xc2:
        if (!unlocked || (block & 3) === 3 || this.readValue(block) === null) return nak
        this.pending = { command: cmd, block }
        return ack
      case 0xb0: // TRANSFER
        if (!unlocked || !this.transferValue || (block & 3) === 3 || block === 0) return nak
        this.writeValue(block, this.transferValue)
        return ack
    }
    this.state = 'idle'
    return null
  }

  /** Value-block format: value, ~value, value, addr, ~addr, addr, ~addr. */
  private readValue(block: number): number | null {
    const b = this.blocks[block]
    for (let i = 0; i < 4; i++) if (b[i] !== b[i + 8] || b[i] !== (~b[i + 4] & 0xff)) return null
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) | 0
  }
  private writeValue(block: number, value: number[]) {
    const b = this.blocks[block]
    for (let i = 0; i < 4; i++) { b[i] = value[i]; b[i + 4] = ~value[i] & 0xff; b[i + 8] = value[i] }
  }
}

// MFRC522 register numbers (datasheet 9.2; the library passes them shifted left by one).
const CommandReg = 0x01, ComIrqReg = 0x04, DivIrqReg = 0x05, ErrorReg = 0x06, Status2Reg = 0x08,
  FIFODataReg = 0x09, FIFOLevelReg = 0x0a, ControlReg = 0x0c, BitFramingReg = 0x0d, CollReg = 0x0e,
  TxControlReg = 0x14, CRCResultRegH = 0x21, CRCResultRegL = 0x22, VersionReg = 0x37

/** NXP MFRC522 (RC522 module) behind SPI: registers, FIFO, CRC coprocessor, card field. */
export class Mfrc522 {
  readonly regs = new Uint8Array(64)
  private fifo: number[] = []
  private address = -1
  private reading = false
  private first = true
  /** Card currently held on the antenna, if any. */
  card: MifareClassic | null = null

  constructor() { this.reset() }

  reset() {
    this.regs.fill(0)
    this.regs[CommandReg] = 0x20
    this.regs[ComIrqReg] = 0x14
    this.regs[0x0b] = 0x08 // WaterLevelReg
    this.regs[ControlReg] = 0x10
    this.regs[0x11] = 0x3f // ModeReg
    this.regs[TxControlReg] = 0x80
    this.regs[0x18] = 0x84 // RxThresholdReg
    this.regs[CRCResultRegH] = 0xff
    this.regs[CRCResultRegL] = 0xff
    this.regs[0x24] = 0x26 // ModWidthReg
    this.regs[0x26] = 0x48 // RFCfgReg
    this.regs[VersionReg] = 0x92 // v2.0, as on most RC522 boards
    this.fifo = []
    if (this.card) this.card.state = 'idle'
  }

  /** Put a card on the reader (or take it away with null). A new card starts IDLE. */
  setCard(card: MifareClassic | null) {
    if (card !== this.card) { this.card = card; if (card) { card.state = 'idle'; card.authSector = -1 } }
  }

  /** NSS went high: the next byte starts a new register access. */
  deselect() { this.first = true; this.address = -1; this.reading = false }

  /** One full-duplex SPI byte; returns what the chip shifts out on MISO. */
  transfer(value: number): number {
    if (this.first) {
      this.first = false
      this.reading = (value & 0x80) !== 0
      this.address = (value >> 1) & 0x3f
      return 0
    }
    if (this.reading) {
      // Each byte clocks out the previously addressed register and names the next one.
      const out = this.read(this.address)
      this.address = (value >> 1) & 0x3f
      return out
    }
    this.write(this.address, value & 0xff)
    return 0
  }

  private read(reg: number): number {
    switch (reg) {
      case FIFODataReg: return this.fifo.length ? this.fifo.shift()! : 0
      case FIFOLevelReg: return Math.min(64, this.fifo.length)
      case Status2Reg: return this.regs[Status2Reg]
      default: return this.regs[reg]
    }
  }

  private write(reg: number, value: number) {
    switch (reg) {
      case CommandReg: this.command(value); return
      case ComIrqReg: case DivIrqReg: {
        // Set1/Set2: bit 7 set → set the marked bits, else clear them.
        const mask = value & 0x7f
        this.regs[reg] = value & 0x80 ? this.regs[reg] | mask : this.regs[reg] & ~mask
        return
      }
      case FIFODataReg:
        if (this.fifo.length < 64) this.fifo.push(value)
        else this.regs[ErrorReg] |= 0x10
        return
      case FIFOLevelReg:
        if (value & 0x80) { this.fifo = []; this.regs[ErrorReg] &= ~0x10 }
        return
      case BitFramingReg:
        this.regs[reg] = value & 0x7f
        if (value & 0x80 && (this.regs[CommandReg] & 0x0f) === 0x0c) this.transceive()
        return
      case ErrorReg: case VersionReg: return
      case TxControlReg:
        // Field switched on again: a card on the antenna powers up fresh (IDLE).
        if (!(this.regs[reg] & 0x03) && value & 0x03 && this.card) { this.card.state = 'idle'; this.card.authSector = -1 }
        this.regs[reg] = value
        return
      default: this.regs[reg] = value
    }
  }

  private command(value: number) {
    const cmd = value & 0x0f
    this.regs[CommandReg] = value & 0x30 | cmd
    switch (cmd) {
      case 0x0f: this.reset(); this.regs[CommandReg] = 0x20; return // SoftReset
      case 0x03: { // CalcCRC over the FIFO
        const [lo, hi] = crcA(this.fifo)
        this.fifo = []
        this.regs[CRCResultRegL] = lo; this.regs[CRCResultRegH] = hi
        this.regs[DivIrqReg] |= 0x04
        return
      }
      case 0x0e: { // MFAuthent: auth cmd, block, 6-byte key, 4 UID bytes in the FIFO
        const [keyType, block, ...rest] = this.fifo
        this.fifo = []
        const ok = this.antennaOn && !!this.card && this.card.authenticate(keyType, block, rest.slice(0, 6), rest.slice(6, 10))
        this.regs[CommandReg] = 0x20
        if (ok) { this.regs[Status2Reg] |= 0x08; this.regs[ComIrqReg] |= 0x10 }
        else this.regs[ComIrqReg] |= 0x01 // card never answers: timer runs out
        return
      }
      case 0x00: case 0x0c: case 0x07: return // Idle, Transceive (waits for StartSend), NoCmdChange
      default: this.regs[CommandReg] = 0x20
    }
  }

  private get antennaOn() { return (this.regs[TxControlReg] & 0x03) !== 0 }

  private transceive() {
    const frame = this.fifo
    this.fifo = []
    const txLastBits = this.regs[BitFramingReg] & 0x07
    this.regs[ErrorReg] = 0
    this.regs[ComIrqReg] |= 0x40 // TxIRq
    const crypto = (this.regs[Status2Reg] & 0x08) !== 0
    const card = this.antennaOn ? this.card : null
    // MFCrypto1On only makes sense while that card stays selected.
    if (crypto && (!card || card.authSector < 0)) this.regs[Status2Reg] &= ~0x08
    const answer = card ? card.frame(frame, txLastBits) : null
    if (!answer) { this.regs[ComIrqReg] |= 0x01; return } // TimerIRq: 25 ms without an answer
    this.fifo = answer.data.slice(0, 64)
    this.regs[ControlReg] = (this.regs[ControlReg] & ~0x07) | (answer.lastBits & 0x07)
    this.regs[CollReg] = 0x20 // no collision, position not valid
    this.regs[ComIrqReg] |= 0x30 // RxIRq + IdleIRq
  }
}

const ILI_W = 240, ILI_H = 320

/**
 * ILI9341 controller: command/data framing by the D/C pin, column/page
 * windows, MADCTL scan direction and RGB565 RAM writes into the 240×320 panel.
 */
export class Ili9341 {
  readonly pixels = new Uint16Array(ILI_W * ILI_H)
  madctl = 0
  inverted = false
  displayOn = false
  sleeping = true
  /** Bumped on every visible change, so the view can redraw lazily. */
  version = 0
  private cmd = -1
  private params: number[] = []
  private xs = 0; private xe = ILI_W - 1; private ys = 0; private ye = ILI_H - 1
  private cx = 0; private cy = 0
  private hi = -1

  reset() {
    this.madctl = 0; this.inverted = false; this.displayOn = false; this.sleeping = true
    this.xs = 0; this.xe = ILI_W - 1; this.ys = 0; this.ye = ILI_H - 1
    this.cmd = -1; this.params = []; this.hi = -1
    this.version++
  }

  /** CS released: an unfinished pixel byte pair is dropped, the command stays. */
  deselect() { this.hi = -1 }

  /** One byte; `data` is the D/C pin level (HIGH = parameter/pixel data). */
  transfer(value: number, data: boolean): number {
    value &= 0xff
    if (!data) { this.command(value); return 0 }
    if (this.cmd === 0x2c || this.cmd === 0x3c) {
      if (this.hi < 0) { this.hi = value; return 0 }
      this.pixel((this.hi << 8) | value)
      this.hi = -1
      return 0
    }
    this.params.push(value)
    this.parameter()
    return 0
  }

  private command(value: number) {
    this.cmd = value; this.params = []; this.hi = -1
    switch (value) {
      case 0x01: this.reset(); this.cmd = -1; break // SWRESET
      case 0x10: this.sleeping = true; this.version++; break
      case 0x11: this.sleeping = false; this.version++; break
      case 0x20: this.inverted = false; this.version++; break
      case 0x21: this.inverted = true; this.version++; break
      case 0x28: this.displayOn = false; this.version++; break
      case 0x29: this.displayOn = true; this.version++; break
      case 0x2c: this.cx = this.xs; this.cy = this.ys; break // RAMWR starts at the window corner
    }
  }

  private parameter() {
    const p = this.params
    switch (this.cmd) {
      case 0x2a: if (p.length === 4) { this.xs = (p[0] << 8) | p[1]; this.xe = (p[2] << 8) | p[3] } break
      case 0x2b: if (p.length === 4) { this.ys = (p[0] << 8) | p[1]; this.ye = (p[2] << 8) | p[3] } break
      case 0x36: if (p.length === 1) { this.madctl = p[0]; this.version++ } break
    }
  }

  private pixel(color: number) {
    const mv = this.madctl & 0x20
    const cols = mv ? ILI_H : ILI_W, rows = mv ? ILI_W : ILI_H
    const c = this.cx, r = this.cy
    if (c < cols && r < rows) {
      let x = mv ? r : c, y = mv ? c : r
      // Panel wiring on the common 2.4"/2.8" modules: MX=1 is the unmirrored
      // portrait (Adafruit rotation 0 = MX|BGR).
      if (!(this.madctl & 0x40)) x = ILI_W - 1 - x
      if (this.madctl & 0x80) y = ILI_H - 1 - y
      if (!(this.madctl & 0x08)) color = (color & 0x07e0) | ((color & 0x1f) << 11) | (color >> 11)
      this.pixels[y * ILI_W + x] = color
      this.version++
    }
    if (++this.cx > this.xe) {
      this.cx = this.xs
      if (++this.cy > this.ye) this.cy = this.ys
    }
  }

  /** What the glass shows: black while asleep or off, inverted when INVON. */
  frame(): number[] {
    if (!this.displayOn || this.sleeping) return new Array(ILI_W * ILI_H).fill(0)
    return this.inverted ? Array.from(this.pixels, p => p ^ 0xffff) : Array.from(this.pixels)
  }
}
