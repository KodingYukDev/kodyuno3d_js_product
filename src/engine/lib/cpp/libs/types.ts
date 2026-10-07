// ============================================================
// KodyUno — simulator library model
//
// A "library" here is a shim: it registers the classes and globals a
// header provides and drives the simulated parts directly, instead of
// bit-banging a protocol. That keeps the whole thing on the user's device
// with no compile step, which is the point of KodyUno.
// ============================================================
import type { Interpreter } from '../runtime'

export type LibraryCategory =
  | 'Aktuator'
  | 'Display'
  | 'Sensor'
  | 'Komunikasi'
  | 'Penyimpanan'
  | 'Input'
  | 'Utilitas'

export type LibrarySupport =
  /** Fully simulated: the sketch drives real parts on the canvas. */
  | 'native'
  /** Parsed from the user's uploaded source and executed by the interpreter. */
  | 'parsed'
  /** Known to the index, but only stubbed so the sketch still compiles. */
  | 'stub'

export interface SimLibrary {
  id: string
  name: string
  author: string
  version: string
  category: LibraryCategory
  description: string
  /** Headers that pull this library in, e.g. ['Servo.h', 'ESP32Servo.h']. */
  headers: string[]
  /** Search terms beyond name and description. */
  keywords: string[]
  /** Class names the parser must treat as types. */
  types: string[]
  support: LibrarySupport
  /** Boards the library makes sense on; empty means all of them. */
  boards?: string[]
  install?: (interpreter: Interpreter) => void
}
