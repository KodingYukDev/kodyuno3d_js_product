// Serial Monitor baud behaviour of the real Arduino IDE.

/** Both ends of a UART must agree within a few percent, as on real hardware. */
export function baudMismatch(monitor: number, sketch: number | null) {
  return sketch !== null && sketch > 0 && Math.abs(monitor - sketch) / sketch > 0.03
}

/**
 * What a real Serial Monitor shows when its baud differs from the sketch's:
 * bytes framed at the wrong speed decode as junk. Deterministic so the
 * screen does not flicker; line breaks survive the way they often do.
 */
export function garble(text: string, monitor: number, sketch: number) {
  const junk = '⸮⸮⸮xø?ÿ~ÀþðŒ'
  let out = ''
  let seed = Math.round((monitor * 7 + sketch * 13) % 997)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) { out += '\n'; continue }
    seed = (seed * 31 + code + i) % 9973
    // Slower monitor than sketch: several sketch bytes merge into one.
    if (monitor < sketch && seed % Math.max(1, Math.round(sketch / monitor)) !== 0) continue
    out += junk[seed % junk.length]
  }
  return out
}
