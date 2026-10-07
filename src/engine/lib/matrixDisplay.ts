/** MAX7219 intensity register selects duty cycles 1/32, 3/32, ... 31/32. */
export function matrixBrightness(state: Record<string, unknown>): number {
  if (state.shutdown === true) return 0
  const input = typeof state.intensity === 'number' && Number.isFinite(state.intensity) ? state.intensity : 8
  return (2 * Math.max(0, Math.min(15, Math.trunc(input))) + 1) / 32
}
