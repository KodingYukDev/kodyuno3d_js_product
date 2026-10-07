/** Bounded monochrome framebuffer used by behavioural OLED shims. */
export class MonoFramebuffer {
  readonly pixels = new Uint8Array(128 * 64)
  clear() { this.pixels.fill(0) }
  pixel(x: number, y: number, color: number) {
    x = Math.trunc(x); y = Math.trunc(y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 128 || y < 0 || y >= 64) return
    const index = y * 128 + x
    this.pixels[index] = color === 2 ? this.pixels[index] ^ 1 : color ? 1 : 0
  }
  line(x0: number, y0: number, x1: number, y1: number, color: number) {
    // Bound work even for malformed sketch coordinates.
    if (![x0, y0, x1, y1].every(Number.isFinite)) return
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1)
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
    if (Math.max(dx, -dy) > 100000) return
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let error = dx + dy
    for (;;) {
      this.pixel(x0, y0, color)
      if (x0 === x1 && y0 === y1) break
      const twice = 2 * error
      if (twice >= dy) { error += dy; x0 += sx }
      if (twice <= dx) { error += dx; y0 += sy }
    }
  }
  rect(x: number, y: number, w: number, h: number, color: number, filled: boolean) {
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return
    x = Math.trunc(x); y = Math.trunc(y); w = Math.trunc(w); h = Math.trunc(h)
    for (let py = Math.max(0, y); py < Math.min(64, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(128, x + w); px++) {
        if (filled || px === x || px === x + w - 1 || py === y || py === y + h - 1) this.pixel(px, py, color)
      }
    }
  }
  snapshot() { return Array.from(this.pixels) }
  circle(cx: number, cy: number, radius: number, color: number, filled: boolean) {
    if (![cx, cy, radius].every(Number.isFinite) || radius < 0 || radius > 4096) return
    cx = Math.trunc(cx); cy = Math.trunc(cy); radius = Math.trunc(radius)
    // Deduplicate symmetry points, especially important for INVERSE drawing.
    const points = new Set<number>()
    const add = (x: number, y: number) => {
      if (x >= 0 && x < 128 && y >= 0 && y < 64) points.add(y * 128 + x)
    }
    if (filled) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(63, cy + radius); y++) {
        const span = Math.floor(Math.sqrt(radius * radius - (y - cy) ** 2))
        for (let x = Math.max(0, cx - span); x <= Math.min(127, cx + span); x++) add(x, y)
      }
    } else {
      let x = radius, y = 0, error = 1 - radius
      while (x >= y) {
        for (const [dx, dy] of [[x,y],[y,x],[-y,x],[-x,y],[-x,-y],[-y,-x],[y,-x],[x,-y]]) add(cx + dx, cy + dy)
        y++
        if (error < 0) error += 2 * y + 1
        else { x--; error += 2 * (y - x) + 1 }
      }
    }
    for (const index of points) this.pixel(index % 128, Math.floor(index / 128), color)
  }
  bitmap(x: number, y: number, bytes: number[], width: number, height: number, color: number, background?: number) {
    if (![x, y, width, height].every(Number.isFinite)) return
    x = Math.trunc(x); y = Math.trunc(y); width = Math.trunc(width); height = Math.trunc(height)
    if (width <= 0 || height <= 0) return
    const stride = Math.ceil(width / 8)
    for (let py = Math.max(0, y); py < Math.min(64, y + height); py++) {
      for (let px = Math.max(0, x); px < Math.min(128, x + width); px++) {
        const dx = px - x, dy = py - y
        const on = ((bytes[dy * stride + Math.floor(dx / 8)] ?? 0) >> (7 - dx % 8)) & 1
        if (on) this.pixel(px, py, color)
        else if (background !== undefined) this.pixel(px, py, background)
      }
    }
  }
}
