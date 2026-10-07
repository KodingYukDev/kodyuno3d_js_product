// ============================================================
// KodyUno — sketch pipeline
//
// source → preprocess → resolve libraries → preprocess again (now with
// uploaded library headers spliced in) → parse → interpret.
//
// The second preprocess pass exists because we only know which uploaded
// library provides a header after the first pass has listed the includes.
// ============================================================
import { CppSyntaxError } from './lexer'
import { preprocess } from './preprocess'
import { parse } from './parser'
import type { Program } from './ast'
import { Interpreter, RuntimeError, StopSignal } from './runtime'
import { installArduinoCore } from './arduino'
import { setDoubleIsFloat } from './values'
import { installLibraries, resolveLibraries, type ResolvedLibraries, type UserLibrary } from './libs'
import type { Hardware } from './hardware'
import type { BoardDef } from '@kodyuno/lib/boards'

export interface CompileOptions {
  board: BoardDef
  userLibraries?: UserLibrary[]
}

export interface CompileResult {
  program: Program
  includes: string[]
  libraries: ResolvedLibraries
  /** Human-readable notes to show before the sketch runs. */
  notes: string[]
}

export class CompileError extends Error {
  readonly line?: number

  constructor(message: string, line?: number) {
    super(message)
    this.name = 'CompileError'
    this.line = line
  }
}

/** Macros the real Arduino toolchain defines for each board family. */
function boardDefines(board: BoardDef): Record<string, string> {
  const defines: Record<string, string> = {
    ARDUINO: '10819',
    F_CPU: String(board.cpuMHz * 1_000_000),
    __KODYUNO__: '1',
    LED_BUILTIN: String(board.builtinLed ?? 13),
  }
  switch (board.family) {
    case 'esp32':
      defines.ESP32 = '1'
      defines.ARDUINO_ARCH_ESP32 = '1'
      if (board.id === 'esp32-s3') defines.CONFIG_IDF_TARGET_ESP32S3 = '1'
      if (board.id === 'esp32-s2') defines.CONFIG_IDF_TARGET_ESP32S2 = '1'
      if (board.id === 'esp32-c3') defines.CONFIG_IDF_TARGET_ESP32C3 = '1'
      if (board.id === 'esp32-c6') defines.CONFIG_IDF_TARGET_ESP32C6 = '1'
      break
    case 'esp8266':
      defines.ESP8266 = '1'
      defines.ARDUINO_ARCH_ESP8266 = '1'
      break
    default:
      defines.__AVR__ = '1'
      defines.ARDUINO_ARCH_AVR = '1'
      if (board.id === 'mega') defines.__AVR_ATmega2560__ = '1'
      else defines.__AVR_ATmega328P__ = '1'
  }
  return defines
}

export function compileSketch(source: string, options: CompileOptions): CompileResult {
  const defines = boardDefines(options.board)
  const userLibraries = options.userLibraries ?? []

  try {
    // pass 1 — discover which headers the sketch asks for
    const discovery = preprocess(source, { predefined: defines })
    const libraries = resolveLibraries(discovery.includes, userLibraries)

    // pass 2 — splice in the source of any uploaded library
    const sourceByHeader = new Map<string, string>()
    for (const library of libraries.user) {
      for (const [header, text] of Object.entries(library.sources)) {
        sourceByHeader.set(header.toLowerCase(), text)
      }
    }
    const final = sourceByHeader.size
      ? preprocess(source, {
          predefined: defines,
          headerSource: (header) => sourceByHeader.get(header.toLowerCase()),
        })
      : discovery

    const program = parse(final.tokens, { knownTypes: libraries.types })

    const notes: string[] = []
    for (const library of libraries.builtins) notes.push(`Library ${library.name} aktif (simulasi penuh).`)
    for (const library of libraries.user) notes.push(`Library ${library.name} dijalankan dari sumber yang kamu unggah.`)
    for (const library of libraries.stubbed) notes.push(`Library ${library.name} hanya di-stub — panggilannya tidak menggerakkan komponen.`)
    for (const header of libraries.missing) {
      notes.push(`Header "${header}" tidak ditemukan. Unggah ZIP library-nya lewat Library Manager.`)
    }

    return { program, includes: discovery.includes, libraries, notes }
  } catch (error) {
    if (error instanceof CppSyntaxError) throw new CompileError(error.message, error.line)
    throw new CompileError(error instanceof Error ? error.message : String(error))
  }
}

export interface RunOptions extends CompileOptions {
  hardware: Hardware
  speed?: number
  onSerial?: (text: string) => void
  onWarning?: (text: string) => void
  onError?: (message: string) => void
  onFinished?: () => void
}

export interface SketchRun {
  interpreter: Interpreter
  /** Resolves when the sketch stops or throws. */
  done: Promise<void>
  stop(): void
}

/** Compile and start a sketch. Throws CompileError before anything runs. */
export function runSketch(source: string, options: RunOptions): SketchRun {
  const compiled = compileSketch(source, options)

  const interpreter = new Interpreter({
    hardware: options.hardware,
    speed: options.speed,
    onSerial: options.onSerial,
    onWarning: options.onWarning,
  })

  setDoubleIsFloat(options.board.arch === 'avr')
  installArduinoCore(interpreter)
  installLibraries(interpreter, compiled.libraries)

  const done = interpreter
    .run(compiled.program)
    .catch((error: unknown) => {
      if (error instanceof StopSignal) return
      const message = error instanceof RuntimeError || error instanceof Error ? error.message : String(error)
      options.onError?.(message)
    })
    .finally(() => options.onFinished?.())

  return {
    interpreter,
    done,
    stop: () => interpreter.stop(),
  }
}

export { RuntimeError, StopSignal } from './runtime'
export type { UserLibrary } from './libs'
