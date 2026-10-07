// ============================================================
// KodyUno — hardware bridge
//
// Everything the interpreter is allowed to touch outside its own memory.
// Keeping it behind one interface means the C++ engine can be unit-tested
// with a fake board, and the simulator UI stays the only place that knows
// about the zustand store.
// ============================================================
import type { BoardDef } from '@kodyuno/lib/boards'

export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP' | 'OUTPUT_OPEN_DRAIN'

export interface SimComponentView {
  id: string
  type: string
  state: Record<string, unknown>
  /** Role → pin, as resolved by the circuit solver (falls back to authoring). */
  rolePins: Record<string, number | string>
  powered: boolean
}

export interface Hardware {
  board: BoardDef
  /** Cancel anything the bridge scheduled itself (tone timers); called when the session is revoked. */
  dispose?(): void

  // ---- digital / analog IO ----
  pinMode(pin: number | string, mode: PinMode): void
  digitalWrite(pin: number | string, value: 0 | 1): void
  digitalRead(pin: number | string): number
  /** Whether anything outside the chip is wired to this pin (optional fast path). */
  pinWired?(pin: number | string): boolean
  analogWrite(pin: number | string, value: number): void
  analogRead(pin: number | string): number
  /** ESP32 DAC output, 0–255. */
  dacWrite(pin: number | string, value: number): void
  touchRead(pin: number | string): number

  // ---- peripheral buses ----
  /** Write bytes to an I2C address. Returns Arduino Wire status (0 = ACK). */
  i2cWrite(address: number, bytes: number[], sda?: number | string, scl?: number | string): number
  /** Read bytes from the current register pointer of an I2C device. */
  i2cRead(address: number, count: number, sda?: number | string, scl?: number | string): number[]
  /** Transfer one byte to the currently selected (CS=LOW) SPI device. */
  spiTransfer(value: number, pins?: { mosi: number | string; miso: number | string; sck: number | string }): number

  // ---- sound ----
  tone(pin: number | string, frequency: number, durationMs?: number): void
  noTone(pin: number | string): void

  // ---- timing measurement ----
  pulseIn(pin: number | string, value: number, timeoutUs: number): number

  // ---- serial ----
  serialWrite(text: string): void
  /** Baud the sketch's UART runs at (Serial.begin / UBRR0), for the monitor. */
  serialBaud?(baud: number): void
  serialAvailable(): number
  serialRead(): number
  serialPeek(): number
  /** Consume everything currently buffered, e.g. for readString(). */
  serialReadAll(): string

  // ---- component access for library shims ----
  components(): SimComponentView[]
  componentsOfType(type: string): SimComponentView[]
  /** Nearest component of `type` whose `role` is wired to `pin`. */
  componentOn(type: string, pin: number | string, role?: string): SimComponentView | undefined
  patchComponent(id: string, patch: Record<string, unknown>): void

  // ---- diagnostics ----
  warn(message: string): void

  /** Resolve LED_BUILTIN / A0 / D4 style aliases to a real pin id. */
  resolvePin(pin: number | string): number | string
}

/** A hardware bridge that does nothing — used by tests and the parser preview. */
export function nullHardware(board: BoardDef): Hardware {
  return {
    board,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    dacWrite: () => {},
    touchRead: () => 0,
    i2cWrite: () => 2,
    i2cRead: () => [],
    spiTransfer: () => 0xff,
    tone: () => {},
    noTone: () => {},
    pulseIn: () => 0,
    serialWrite: () => {},
    serialAvailable: () => 0,
    serialRead: () => -1,
    serialPeek: () => -1,
    serialReadAll: () => '',
    components: () => [],
    componentsOfType: () => [],
    componentOn: () => undefined,
    patchComponent: () => {},
    warn: () => {},
    resolvePin: (pin) => pin,
  }
}
