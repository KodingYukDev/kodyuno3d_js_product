// ============================================================
// KodyUno — library resolution
//
// Three tiers, checked in order:
//   1. built-in shims — fully simulated, drive the parts on the canvas
//   2. libraries the user uploaded as a ZIP — their C++ is parsed and run
//      by the same interpreter as the sketch
//   3. the offline catalogue — known headers that get a quiet stub so the
//      sketch still runs, with a note in the serial monitor
//
// No tier talks to a server: everything a sketch needs is already on the
// user's device by the time it runs.
// ============================================================
import type { Interpreter } from '../runtime'
import { CObject, type NativeMethod } from '../values'
import { BUILTIN_BY_HEADER, BUILTIN_LIBRARIES } from './builtin'
import { CATALOG_LIBRARIES } from './catalog'
import type { SimLibrary } from './types'

export * from './types'
export { BUILTIN_LIBRARIES } from './builtin'
export { CATALOG_LIBRARIES } from './catalog'

/** A library the user installed from a ZIP file. */
export interface UserLibrary {
  id: string
  name: string
  author: string
  version: string
  description: string
  headers: string[]
  /** Header name → source text, used to splice declarations into the sketch. */
  sources: Record<string, string>
  /** Class names discovered while scanning the headers. */
  types: string[]
  /** Bytes of the original archive, for the manager UI. */
  sizeBytes: number
  installedAt: number
}

export interface ResolvedLibraries {
  /** Built-in shims to install on the interpreter. */
  builtins: SimLibrary[]
  /** User libraries whose source should be prepended to the sketch. */
  user: UserLibrary[]
  /** Catalogue entries that were matched but only stubbed. */
  stubbed: SimLibrary[]
  /** Headers nothing could satisfy. */
  missing: string[]
  /** Every class name the parser must treat as a type. */
  types: string[]
}

const CATALOG_BY_HEADER = new Map<string, SimLibrary>()
for (const library of CATALOG_LIBRARIES) {
  for (const header of library.headers) CATALOG_BY_HEADER.set(header.toLowerCase(), library)
}

/** Headers that are part of the core and need no library at all. */
const CORE_HEADERS = new Set([
  'arduino.h', 'wprogram.h', 'math.h', 'stdio.h', 'stdlib.h', 'string.h', 'stdint.h',
  'avr/pgmspace.h', 'avr/interrupt.h', 'avr/io.h', 'avr/sleep.h', 'avr/wdt.h',
  'esp_system.h', 'esp_sleep.h', 'esp32-hal.h', 'esp32-hal-ledc.h', 'freertos/freertos.h',
  'freertos/task.h', 'stdbool.h', 'limits.h', 'time.h', 'ctype.h',
])

export function resolveLibraries(includes: string[], userLibraries: UserLibrary[] = []): ResolvedLibraries {
  const builtins: SimLibrary[] = []
  const user: UserLibrary[] = []
  const stubbed: SimLibrary[] = []
  const missing: string[] = []
  const types = new Set<string>()

  const userByHeader = new Map<string, UserLibrary>()
  for (const library of userLibraries) {
    for (const header of library.headers) userByHeader.set(header.toLowerCase(), library)
  }

  for (const rawHeader of includes) {
    const header = rawHeader.toLowerCase()
    if (CORE_HEADERS.has(header)) continue

    const builtin = BUILTIN_BY_HEADER.get(header)
    if (builtin) {
      if (!builtins.includes(builtin)) builtins.push(builtin)
      for (const type of builtin.types) types.add(type)
      continue
    }

    const uploaded = userByHeader.get(header)
    if (uploaded) {
      if (!user.includes(uploaded)) user.push(uploaded)
      for (const type of uploaded.types) types.add(type)
      continue
    }

    const catalogued = CATALOG_BY_HEADER.get(header)
    if (catalogued) {
      if (!stubbed.includes(catalogued)) stubbed.push(catalogued)
      for (const type of catalogued.types) types.add(type)
      continue
    }

    missing.push(rawHeader)
  }

  return { builtins, user, stubbed, missing, types: [...types] }
}

/** Install shims onto an interpreter. Stubs get empty classes so code runs. */
export function installLibraries(interpreter: Interpreter, resolved: ResolvedLibraries) {
  for (const library of resolved.builtins) library.install?.(interpreter)

  for (const library of resolved.stubbed) {
    if (library.install) {
      library.install(interpreter)
      continue
    }
    for (const type of library.types) {
      interpreter.registerClass(type, () => stubObject(interpreter, type))
    }
    interpreter.warn(`Library "${library.name}" belum disimulasikan penuh — pemanggilannya diabaikan.`)
  }
}

/** An object that answers any method with 0 so a stubbed sketch keeps running. */
function stubObject(interpreter: Interpreter, className: string): CObject {
  const methods = new Proxy({} as Record<string, NativeMethod>, {
    get: (_target, method: string) => () => {
      interpreter.warn(`${className}.${method}() belum disimulasikan di KodyUno`)
      return 0
    },
    has: () => true,
  })
  return new CObject(className, {}, methods)
}

/** Everything the search box can look through. */
export const SEARCHABLE_LIBRARIES: SimLibrary[] = [...BUILTIN_LIBRARIES, ...CATALOG_LIBRARIES]

export function searchLibraries(query: string, limit = 30): SimLibrary[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return SEARCHABLE_LIBRARIES.slice(0, limit)
  const words = needle.split(/\s+/)

  const scored = SEARCHABLE_LIBRARIES.map((library) => {
    const haystack = [
      library.name,
      library.author,
      library.description,
      library.category,
      ...library.headers,
      ...library.keywords,
    ]
      .join(' ')
      .toLowerCase()

    let score = 0
    for (const word of words) {
      if (!haystack.includes(word)) return { library, score: -1 }
      if (library.name.toLowerCase().includes(word)) score += 6
      if (library.keywords.some((keyword) => keyword.toLowerCase() === word)) score += 4
      if (library.headers.some((header) => header.toLowerCase().startsWith(word))) score += 3
      score += 1
    }
    if (library.support === 'native') score += 3
    return { library, score }
  })

  return scored
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.library)
}
