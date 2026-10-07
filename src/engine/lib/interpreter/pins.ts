import type { PinState, BoardType } from '@kodyuno/types'
import { getBoard } from '@kodyuno/lib/boards'

/**
 * Fresh pin state for a board: every GPIO and analog channel it exposes,
 * as an input at rest. Analog channels idle at mid-scale so a sketch that
 * reads a floating pin sees something plausible instead of a hard zero.
 */
export function makeInitialPins(board: BoardType): PinState[] {
  const def = getBoard(board)
  const midScale = Math.round((2 ** def.adcBits - 1) / 2)

  return def.pins
    .filter((pin) => pin.kind === 'gpio' || pin.kind === 'analog')
    .map((pin) => ({
      pin: pin.id,
      mode: 'INPUT' as const,
      value: 0,
      pwm: 0,
      ...(pin.kind === 'analog' ? { value: midScale } : {}),
    }))
}

/** Pins that accept analogWrite() on the given board. */
export function pwmPins(board: BoardType): Set<number | string> {
  return new Set(getBoard(board).pins.filter((pin) => pin.pwm).map((pin) => pin.id))
}
