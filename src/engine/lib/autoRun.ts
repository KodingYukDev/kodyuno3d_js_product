// Run a sketch the way Wokwi does: AVR boards compile on the server (cached)
// and run the real firmware, with no fallback engine. Only boards without a
// firmware emulator yet (ESP) use the educational interpreter.

import type { BoardDef } from './boards/types'
import { CompilerTimeoutError, CompilerUnavailableError, compileSketch } from './compilerClient'
import { runSketch } from './cpp/sketch'
import { startAvrFirmware } from './firmware/browserRun'
import { createHardwareSession } from './hardwareSession'
import { createSimulatorHardware } from './interpreter/hardwareBridge'

export interface AutoRunOptions {
  source: string
  board: BoardDef
  speed: number
  token?: string
  /** Status and fallback notes for the serial monitor. */
  note: (text: string) => void
  onError: (message: string) => void
  onFinished: () => void
  /** Which engine ended up running the sketch. */
  onEngine?: (engine: 'firmware' | 'interpreter') => void
  /** Compiled HEX text when the firmware engine ran — sent to the server as the trusted artifact. */
  onArtifact?: (hexText: string) => void
}

export interface AutoRun { stop(): void }

const FIRMWARE_BOARDS = new Set(['uno', 'nano', 'mega'])

export function startAutoRun(options: AutoRunOptions): AutoRun {
  const session = createHardwareSession(createSimulatorHardware)
  let stopped = false
  let current: { stop(): void } | null = null
  const controller = new AbortController()
  const finish = () => { session.revoke(); if (!stopped) options.onFinished() }

  const interpret = () => {
    options.onEngine?.('interpreter')
    current = runSketch(options.source, {
      board: options.board,
      hardware: session.hardware,
      speed: options.speed,
      onWarning: text => options.note(`[KodyUno] ${text}\n`),
      onError: message => { if (!stopped) options.onError(message) },
      onFinished: finish,
    })
  }

  if (!FIRMWARE_BOARDS.has(options.board.id)) {
    interpret()
  } else {
    options.note('[KodyUno] Compile sketch…\n')
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 150000)
    compileSketch(options.board.id === 'mega' ? 'mega' : 'uno', options.source, options.token, controller.signal)
      .then(artifact => {
        if (stopped) return
        options.onEngine?.('firmware')
        options.onArtifact?.(new TextDecoder().decode(artifact.bytes))
        // Like the Arduino IDE after every upload: flash/RAM use, and its own
        // "Low memory available" warning when globals leave little stack.
        if (artifact.logs.trim()) options.note(`${artifact.logs.trim()}\n`)
        current = startAvrFirmware(new TextDecoder().decode(artifact.bytes), session.hardware, message => {
          if (stopped) return
          session.revoke()
          options.onError(message)
        })
      })
      .catch(error => {
        if (stopped) return
        if (timedOut && !(error instanceof CompilerUnavailableError)) error = new CompilerTimeoutError('Compile melewati batas waktu.')
        session.revoke()
        const message = error instanceof Error ? error.message : String(error)
        // Like Wokwi there is no second engine: the same sketch must give the
        // same result, so an unreachable compiler is an error to retry, never
        // a silent switch to the educational interpreter.
        if (error instanceof CompilerUnavailableError) {
          options.onError(`${message} Coba jalankan lagi sebentar lagi.`)
          return
        }
        // A real compile error: gcc's first line, then the rest in the monitor.
        const [first, ...rest] = message.split('\n')
        options.onError(first)
        if (rest.length) options.note(`${rest.join('\n')}\n`)
        const missing = /fatal error: ([\w./-]+\.h): No such file or directory/.exec(message)
        if (missing) options.note(`[KodyUno] Library ${missing[1]} belum ada di server compile. Tambahkan lewat libraries.txt atau hubungi admin.\n`)
      })
      .finally(() => clearTimeout(timeout))
  }

  return {
    stop() {
      stopped = true
      controller.abort()
      current?.stop()
      session.revoke()
    },
  }
}
