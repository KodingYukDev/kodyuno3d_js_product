// microSD card in SPI mode with a real FAT16 volume, for compiled firmware.
// The Arduino SD library initialises it (CMD0/8/55+41/58), reads the CSD, MBR
// and boot sector, then reads and writes 512-byte blocks exactly as on a real
// card. Files come from and go back to the part's `files` state, the same list
// the interpreter's SD shim uses, so both engines see the same card.

export interface SdFile { name: string; content: string }

const SECTOR = 512
/** 64 MiB card: one FAT16 partition starting at 1 MiB, 2 KiB clusters. */
const TOTAL_SECTORS = 131_072
const PART_START = 2048
const PART_SECTORS = TOTAL_SECTORS - PART_START
const RESERVED = 1
const SECTORS_PER_CLUSTER = 4
const ROOT_ENTRIES = 512
const ROOT_SECTORS = (ROOT_ENTRIES * 32) / SECTOR
const FAT_SECTORS = Math.ceil(((Math.floor((PART_SECTORS - RESERVED - ROOT_SECTORS) / SECTORS_PER_CLUSTER) + 2) * 2) / SECTOR)
const FAT_START = PART_START + RESERVED
const ROOT_START = FAT_START + 2 * FAT_SECTORS
const DATA_START = ROOT_START + ROOT_SECTORS
const CLUSTERS = Math.floor((TOTAL_SECTORS - DATA_START) / SECTORS_PER_CLUSTER)
const CLUSTER_BYTES = SECTOR * SECTORS_PER_CLUSTER
/** Files bigger than this stay on the card but are not copied into the project. */
const MAX_PUBLISHED_BYTES = 256 * 1024

const le16 = (b: Uint8Array, at: number, v: number) => { b[at] = v & 0xff; b[at + 1] = (v >> 8) & 0xff }
const le32 = (b: Uint8Array, at: number, v: number) => { le16(b, at, v & 0xffff); le16(b, at + 2, v >>> 16) }
const rd16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const rd32 = (b: Uint8Array, at: number) => (rd16(b, at) | (rd16(b, at + 2) << 16)) >>> 0

/** "data log.txt" → "DATALOG TXT" (8.3, upper case, as SD.open() stores it). */
export function shortName(name: string): string | null {
  const [base, ext = '', ...rest] = name.toUpperCase().split('.')
  const clean = (text: string) => text.replace(/[^A-Z0-9_$~!#%&\-{}()@'`^]/g, '')
  const b = clean(base), e = clean(ext)
  if (rest.length || !b || b.length > 8 || e.length > 3) return null
  return b.padEnd(8) + e.padEnd(3)
}

/** Sparse 64 MiB block device holding an MBR + FAT16 volume. */
export class FatImage {
  private blocks = new Map<number, Uint8Array>()
  /** Bumped on every block write so the owner knows to re-read the files. */
  version = 0

  static format(files: SdFile[]): FatImage {
    const image = new FatImage()
    const mbr = new Uint8Array(SECTOR)
    const entry = 446
    mbr[entry + 4] = 0x06 // FAT16 (≥ 32 MiB)
    mbr.set([0x01, 0x01, 0x00], entry + 1); mbr.set([0xfe, 0xff, 0xff], entry + 5)
    le32(mbr, entry + 8, PART_START); le32(mbr, entry + 12, PART_SECTORS)
    mbr[510] = 0x55; mbr[511] = 0xaa
    image.blocks.set(0, mbr)

    const boot = new Uint8Array(SECTOR)
    boot.set([0xeb, 0x3c, 0x90]); boot.set(new TextEncoder().encode('KODYUNO '), 3)
    le16(boot, 11, SECTOR); boot[13] = SECTORS_PER_CLUSTER; le16(boot, 14, RESERVED); boot[16] = 2
    le16(boot, 17, ROOT_ENTRIES); le16(boot, 19, 0); boot[21] = 0xf8; le16(boot, 22, FAT_SECTORS)
    le16(boot, 24, 63); le16(boot, 26, 255); le32(boot, 28, PART_START); le32(boot, 32, PART_SECTORS)
    boot[36] = 0x80; boot[38] = 0x29; le32(boot, 39, 0x4b595544)
    boot.set(new TextEncoder().encode('KODYUNO    FAT16   '), 43)
    boot[510] = 0x55; boot[511] = 0xaa
    image.blocks.set(PART_START, boot)

    const fat = new Uint16Array(CLUSTERS + 2)
    fat[0] = 0xfff8; fat[1] = 0xffff
    let next = 2, slot = 0
    const root = new Uint8Array(ROOT_SECTORS * SECTOR)
    const used = new Set<string>()
    for (const file of files) {
      const name = shortName(file.name)
      if (!name || used.has(name) || slot >= ROOT_ENTRIES) continue
      used.add(name)
      const bytes = Uint8Array.from(file.content, c => c.charCodeAt(0) & 0xff)
      const count = Math.ceil(bytes.length / CLUSTER_BYTES)
      if (next + count > CLUSTERS + 2) break
      const first = count ? next : 0
      for (let i = 0; i < count; i++) {
        const cluster = next++
        fat[cluster] = i === count - 1 ? 0xffff : cluster + 1
        const chunk = bytes.subarray(i * CLUSTER_BYTES, (i + 1) * CLUSTER_BYTES)
        for (let s = 0; s * SECTOR < chunk.length; s++) {
          const block = new Uint8Array(SECTOR)
          block.set(chunk.subarray(s * SECTOR, (s + 1) * SECTOR))
          image.blocks.set(DATA_START + (cluster - 2) * SECTORS_PER_CLUSTER + s, block)
        }
      }
      const at = slot++ * 32
      root.set(new TextEncoder().encode(name), at)
      root[at + 11] = 0x20
      le16(root, at + 26, first); le32(root, at + 28, bytes.length)
    }
    for (let s = 0; s < ROOT_SECTORS; s++) if (s * SECTOR < slot * 32) image.blocks.set(ROOT_START + s, root.slice(s * SECTOR, (s + 1) * SECTOR))
    const fatBytes = new Uint8Array(fat.buffer)
    for (let copy = 0; copy < 2; copy++) {
      for (let s = 0; s * SECTOR < fatBytes.length; s++) {
        const chunk = fatBytes.subarray(s * SECTOR, (s + 1) * SECTOR)
        if (chunk.some(b => b)) { const block = new Uint8Array(SECTOR); block.set(chunk); image.blocks.set(FAT_START + copy * FAT_SECTORS + s, block) }
      }
    }
    return image
  }

  get sectors() { return TOTAL_SECTORS }
  read(lba: number): Uint8Array { return this.blocks.get(lba) ?? new Uint8Array(SECTOR) }
  write(lba: number, data: Uint8Array) {
    if (lba < 0 || lba >= TOTAL_SECTORS) return
    this.blocks.set(lba, data.slice(0, SECTOR)); this.version++
  }

  /** Regular files in the root directory, read through the FAT chain. */
  files(): SdFile[] {
    const out: SdFile[] = []
    const fatEntry = (cluster: number) => rd16(this.read(FAT_START + Math.floor((cluster * 2) / SECTOR)), (cluster * 2) % SECTOR)
    for (let s = 0; s < ROOT_SECTORS; s++) {
      const block = this.read(ROOT_START + s)
      for (let at = 0; at < SECTOR; at += 32) {
        if (block[at] === 0) return out
        if (block[at] === 0xe5 || block[at + 11] === 0x0f || block[at + 11] & 0x18) continue
        const raw = String.fromCharCode(...block.subarray(at, at + 11))
        const base = raw.slice(0, 8).trimEnd(), ext = raw.slice(8).trimEnd()
        const size = rd32(block, at + 28)
        if (size > MAX_PUBLISHED_BYTES) continue
        const bytes: number[] = []
        let cluster = rd16(block, at + 26), guard = 0
        while (cluster >= 2 && cluster < 0xfff8 && bytes.length < size && guard++ < CLUSTERS) {
          for (let i = 0; i < SECTORS_PER_CLUSTER && bytes.length < size; i++) {
            const data = this.read(DATA_START + (cluster - 2) * SECTORS_PER_CLUSTER + i)
            for (let b = 0; b < SECTOR && bytes.length < size; b++) bytes.push(data[b])
          }
          cluster = fatEntry(cluster)
        }
        let content = ''
        for (let i = 0; i < bytes.length; i += 8192) content += String.fromCharCode(...bytes.slice(i, i + 8192))
        out.push({ name: ext ? `${base}.${ext}` : base, content })
      }
    }
    return out
  }
}

/** CRC16-CCITT of a data block (SD cards append it; the library ignores it). */
function crc16(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

/** SDHC card speaking the SPI-mode protocol (block addressing). */
export class SdCard {
  private out: number[] = []
  private cmd: number[] = []
  private idle = true
  private app = false
  private mode: 'command' | 'write-token' | 'write-data' = 'command'
  private multiWrite = false
  private writeBlock = 0
  private data: number[] = []
  private readNext = -1 // CMD18: next block to stream
  inserted = true
  readonly image: FatImage

  constructor(image: FatImage) { this.image = image }

  reset() { this.out = []; this.cmd = []; this.idle = true; this.app = false; this.mode = 'command'; this.readNext = -1 }
  /** CS high: a command in flight is abandoned, data already queued is not clocked out. */
  deselect() { this.cmd = []; if (this.mode === 'command' && this.readNext < 0) this.out = [] }

  private block(lba: number): number[] {
    const data = this.image.read(lba)
    const crc = crc16(data)
    return [0xff, 0xfe, ...data, crc >> 8, crc & 0xff]
  }

  transfer(value: number): number {
    if (!this.inserted) return 0xff
    value &= 0xff
    const response = this.out.length ? this.out.shift()! : 0xff
    if (this.readNext >= 0 && this.out.length === 0 && this.mode === 'command' && this.cmd.length === 0) {
      this.out.push(...this.block(this.readNext++)) // keep streaming until CMD12
    }
    if (this.mode === 'write-token') {
      if (value === 0xfe || (this.multiWrite && value === 0xfc)) { this.mode = 'write-data'; this.data = [] }
      else if (this.multiWrite && value === 0xfd) { this.mode = 'command'; this.multiWrite = false; this.out.push(0xff, 0x00, 0xff) }
      return response
    }
    if (this.mode === 'write-data') {
      this.data.push(value)
      if (this.data.length === SECTOR + 2) {
        this.image.write(this.writeBlock++, Uint8Array.from(this.data.slice(0, SECTOR)))
        this.out.push(0x05, 0x00, 0x00, 0xff) // accepted, then busy while programming
        this.mode = this.multiWrite ? 'write-token' : 'command'
      }
      return response
    }
    if (this.cmd.length === 0 && (value & 0xc0) !== 0x40) return response
    this.cmd.push(value)
    if (this.cmd.length < 6) return response
    const [first, a3, a2, a1, a0] = this.cmd
    this.cmd = []
    const index = first & 0x3f, arg = ((a3 << 24) | (a2 << 16) | (a1 << 8) | a0) >>> 0
    const app = this.app
    this.app = false
    const r1 = () => (this.idle ? 0x01 : 0x00)
    if (this.readNext >= 0 && index === 12) {
      this.readNext = -1
      this.out = [0xff, 0x00, 0xff] // stuff byte, R1, then not busy
      return response
    }
    this.out = [0xff] // NCR: one byte before the response
    switch (app ? 100 + index : index) {
      case 0: this.reset(); this.out = [0xff, 0x01]; break
      case 8: this.out.push(r1(), 0x00, 0x00, (arg >> 8) & 0x0f, arg & 0xff); break
      case 55: this.app = true; this.out.push(r1()); break
      case 141: this.idle = false; this.out.push(0x00); break // ACMD41: ready at once
      case 58: this.out.push(r1(), 0xc0, 0xff, 0x80, 0x00); break // OCR: powered up, CCS=1 (SDHC)
      case 9: { // CSD v2.0: capacity (C_SIZE+1) × 512 KiB
        const size = this.image.sectors / 1024 - 1
        const csd = Uint8Array.from([0x40, 0x0e, 0x00, 0x32, 0x5b, 0x59, 0x00, (size >> 16) & 0x3f, (size >> 8) & 0xff, size & 0xff, 0x7f, 0x80, 0x0a, 0x40, 0x00, 0x01])
        this.out.push(0x00, 0xff, 0xfe, ...csd, 0x00, 0x00); break
      }
      case 10: {
        const cid = Uint8Array.from([0x03, 0x53, 0x44, 0x4b, 0x4f, 0x44, 0x59, 0x55, 0x10, 0x00, 0x00, 0x00, 0x01, 0x01, 0x9a, 0x01])
        this.out.push(0x00, 0xff, 0xfe, ...cid, 0x00, 0x00); break
      }
      case 13: this.out.push(r1(), 0x00); break
      case 16: case 59: case 123: this.out.push(r1()); break
      case 17: this.out.push(0x00, ...this.block(arg)); break
      case 18: this.out.push(0x00, ...this.block(arg)); this.readNext = arg + 1; break
      case 24: this.out.push(0x00); this.writeBlock = arg; this.multiWrite = false; this.mode = 'write-token'; break
      case 25: this.out.push(0x00); this.writeBlock = arg; this.multiWrite = true; this.mode = 'write-token'; break
      default: this.out.push(r1() | 0x04) // illegal command
    }
    return response
  }
}
