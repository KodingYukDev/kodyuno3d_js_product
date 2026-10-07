// ============================================================
// KodyUno — minimal ZIP reader
//
// Enough of the ZIP format to unpack an Arduino library archive, built on
// the browser's own DecompressionStream so KodyUno ships no archive
// dependency and no upload ever leaves the machine.
// ============================================================

export interface ZipEntry {
  name: string
  /** Uncompressed size in bytes, as recorded in the central directory. */
  size: number
  compressedSize: number
  method: number
  offset: number
}

const SIG_END_OF_CENTRAL_DIR = 0x06054b50
const SIG_CENTRAL_FILE = 0x02014b50
const SIG_ZIP64_END_LOCATOR = 0x07064b50

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/** List the files in a ZIP archive without decompressing any of them. */
export function readZipDirectory(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // The end-of-central-directory record sits in the last 64KB + comment.
  let eocd = -1
  const scanStart = Math.max(0, bytes.length - 0xffff - 22)
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === SIG_END_OF_CENTRAL_DIR) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('Bukan file ZIP yang valid (EOCD tidak ditemukan)')

  const total = view.getUint16(eocd + 10, true)
  let directoryOffset = view.getUint32(eocd + 16, true)

  // ZIP64 archives park the real offset in a separate record
  if (directoryOffset === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (view.getUint32(i, true) === SIG_ZIP64_END_LOCATOR) {
        const zip64Offset = Number(view.getBigUint64(i + 8, true))
        directoryOffset = Number(view.getBigUint64(zip64Offset + 48, true))
        break
      }
    }
  }

  const entries: ZipEntry[] = []
  let cursor = directoryOffset
  for (let index = 0; index < total; index++) {
    if (view.getUint32(cursor, true) !== SIG_CENTRAL_FILE) break
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const offset = view.getUint32(cursor + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    entries.push({ name, size, compressedSize, method, offset })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/** Extract one entry to bytes. Supports stored (0) and deflate (8). */
export async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer)
  const nameLength = view.getUint16(entry.offset + 26, true)
  const extraLength = view.getUint16(entry.offset + 28, true)
  const dataStart = entry.offset + 30 + nameLength + extraLength
  const raw = new Uint8Array(buffer, dataStart, entry.compressedSize)

  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new ZipError(`Metode kompresi ${entry.method} belum didukung`)

  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('Browser ini belum mendukung DecompressionStream untuk membuka ZIP')
  }

  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const inflated = await new Response(stream).arrayBuffer()
  return new Uint8Array(inflated)
}

/** Extract every text entry whose name passes `accept`. */
export async function readZipText(
  buffer: ArrayBuffer,
  accept: (name: string) => boolean,
  maxBytesPerFile = 512 * 1024,
): Promise<Record<string, string>> {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const out: Record<string, string> = {}
  for (const entry of readZipDirectory(buffer)) {
    if (entry.name.endsWith('/')) continue
    if (!accept(entry.name)) continue
    if (entry.size > maxBytesPerFile) continue
    try {
      out[entry.name] = decoder.decode(await readZipEntry(buffer, entry))
    } catch {
      // a single unreadable file should not sink the whole import
    }
  }
  return out
}
