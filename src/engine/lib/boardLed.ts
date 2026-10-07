import type { BoardDef } from './boards'
import type { PinState } from '@kodyuno/types'

/** Input/high-impedance pins do not drive the user LED. */
export function boardLedOn(board: BoardDef, pins: PinState[], powered: boolean): boolean {
  if (!powered || board.builtinLed === null) return false
  const pin = pins.find((entry) => String(entry.pin) === String(board.builtinLed))
  if (!pin || pin.mode !== 'OUTPUT') return false
  const duty = pin.pwm > 0 ? Math.min(1, pin.pwm / 255) : pin.value > 0 ? 1 : 0
  return board.builtinLedActiveLow ? duty < 1 : duty > 0
}
