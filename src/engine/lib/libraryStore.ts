// ============================================================
// KodyUno — user library storage
//
// Libraries the user uploads live in IndexedDB on their own machine. A ZIP
// is unpacked in the tab, the headers and sources are kept as text, and the
// interpreter parses them exactly like the sketch — no server, no upload.
// ============================================================
import { readZipDirectory, readZipText } from './zip'
import type { UserLibrary } from './cpp/libs'

const DB_NAME = 'kodyuno-libraries'
const STORE_NAME = 'libraries'
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB tidak bisa dibuka'))
  })
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = run(tx.objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Operasi IndexedDB gagal'))
        tx.oncomplete = () => db.close()
      }),
  )
}

export async function listUserLibraries(): Promise<UserLibrary[]> {
  try {
    const all = await transact<UserLibrary[]>('readonly', (store) => store.getAll() as IDBRequest<UserLibrary[]>)
    return all.sort((a, b) => b.installedAt - a.installedAt)
  } catch {
    return []
  }
}

export async function saveUserLibrary(library: UserLibrary): Promise<void> {
  await transact('readwrite', (store) => store.put(library) as IDBRequest<IDBValidKey>)
}

export async function deleteUserLibrary(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id) as IDBRequest<undefined>)
}

// ------------------------------------------------------------
// ZIP import
// ------------------------------------------------------------

const SOURCE_EXTENSIONS = ['.h', '.hpp', '.hh', '.c', '.cpp', '.cc', '.inl', '.ino']

const isSource = (name: string) => SOURCE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
const isMetadata = (name: string) => /(?:^|\/)(library\.properties|library\.json|keywords\.txt)$/i.test(name)
/** Examples and tests bulk up the archive without helping the sketch run. */
const isNoise = (name: string) => /(^|\/)(examples?|tests?|extras|docs?|\.git)\//i.test(name)

function parseLibraryProperties(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_.]+)\s*=\s*(.*)$/)
    if (match) fields[match[1].toLowerCase()] = match[2].trim()
  }
  return fields
}

/** Class and struct names a header declares, so the parser knows the types. */
export function scanDeclaredTypes(source: string): string[] {
  const names = new Set<string>()
  const patterns = [
    /\b(?:class|struct)\s+([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^{;]*)?\{/g,
    /\btypedef\s+(?:struct|enum|union)?\s*\{[^}]*\}\s*([A-Za-z_]\w*)\s*;/g,
    /\btypedef\s+[A-Za-z_][\w:<>,\s*&]*?\s+([A-Za-z_]\w*)\s*;/g,
    /\busing\s+([A-Za-z_]\w*)\s*=/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1])
  }
  return [...names]
}

export interface ImportResult {
  library: UserLibrary
  /** Files that were kept, for the confirmation UI. */
  files: string[]
  /** Files skipped because they were examples, tests, or too large. */
  skipped: number
}

/**
 * Unpack an Arduino library ZIP.
 *
 * Headers keep their bare filename (`DHT.h`) because that is what a sketch
 * writes in `#include`; the folder they came from is irrelevant once the
 * interpreter has the text.
 */
export async function importLibraryZip(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer()
  const wanted = (name: string) => !isNoise(name) && (isSource(name) || isMetadata(name))
  const extracted = await readZipText(buffer, wanted)

  const properties = Object.entries(extracted).find(([name]) => /library\.properties$/i.test(name))
  const fields = properties ? parseLibraryProperties(properties[1]) : {}

  const sources: Record<string, string> = {}
  const files: string[] = []
  const types = new Set<string>()
  const headers: string[] = []

  for (const [path, text] of Object.entries(extracted)) {
    if (!isSource(path)) continue
    const base = path.split('/').pop() ?? path
    files.push(path)
    // Only headers can be #included; .cpp bodies are appended to their header
    // so out-of-line method definitions still reach the interpreter.
    if (/\.(h|hpp|hh)$/i.test(base)) {
      headers.push(base)
      sources[base] = (sources[base] ?? '') + text
    } else {
      const header = base.replace(/\.(c|cpp|cc|inl|ino)$/i, '.h')
      sources[header] = `${sources[header] ?? ''}\n${text}`
    }
    for (const name of scanDeclaredTypes(text)) types.add(name)
  }

  if (headers.length === 0) {
    throw new Error('ZIP ini tidak berisi file header (.h) — pastikan yang diunggah adalah library Arduino.')
  }

  const fallbackName = file.name.replace(/\.zip$/i, '').replace(/[-_]/g, ' ')
  const library: UserLibrary = {
    id: (fields.name || fallbackName).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: fields.name || fallbackName,
    author: fields.author || fields.maintainer || 'Tidak diketahui',
    version: fields.version || '0.0.0',
    description: fields.sentence || fields.paragraph || 'Library yang diunggah pengguna.',
    headers: [...new Set(headers)],
    sources,
    types: [...types],
    sizeBytes: file.size,
    installedAt: Date.now(),
  }

  return {
    library,
    files,
    skipped: Math.max(0, countZipFiles(buffer) - files.length),
  }
}

function countZipFiles(buffer: ArrayBuffer): number {
  try {
    return readZipDirectory(buffer).filter((entry) => !entry.name.endsWith('/')).length
  } catch {
    return 0
  }
}
