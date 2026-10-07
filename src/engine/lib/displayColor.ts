/** Expand RGB565 to CSS RGB, replicating high bits to preserve endpoints. */
export function rgb565(value: unknown, fallback = 0): string {
  const word = (typeof value === 'number' && Number.isFinite(value) ? value : fallback) & 0xffff
  const r = (word >> 11) & 31, g = (word >> 5) & 63, b = word & 31
  return `rgb(${(r << 3) | (r >> 2)}, ${(g << 2) | (g >> 4)}, ${(b << 3) | (b >> 2)})`
}
