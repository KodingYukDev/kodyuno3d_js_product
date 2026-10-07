/** ILI9341 physical RAM with GFX logical rotation and bounded drawing work. */
export class ColorFramebuffer {
  readonly pixels = new Uint16Array(240 * 320)
  rotation = 0
  get width() { return this.rotation % 2 ? 320 : 240 }
  get height() { return this.rotation % 2 ? 240 : 320 }
  pixel(x: number, y: number, color: number) {
    x = Math.trunc(x); y = Math.trunc(y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) return
    switch (this.rotation) {
      case 1: [x, y] = [239 - y, x]; break
      case 2: [x, y] = [239 - x, 319 - y]; break
      case 3: [x, y] = [y, 319 - x]; break
    }
    this.pixels[y * 240 + x] = color & 0xffff
  }
  fill(color: number) { this.pixels.fill(color & 0xffff) }
  rect(x: number, y: number, w: number, h: number, color: number, filled: boolean) {
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return
    x = Math.trunc(x); y = Math.trunc(y); w = Math.trunc(w); h = Math.trunc(h)
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) {
        if (filled || px === x || px === x + w - 1 || py === y || py === y + h - 1) this.pixel(px, py, color)
      }
    }
  }
  line(x: number, y: number, endX: number, endY: number, color: number) {
    if (![x, y, endX, endY].every(Number.isFinite)) return
    x = Math.trunc(x); y = Math.trunc(y); endX = Math.trunc(endX); endY = Math.trunc(endY)
    const dx = Math.abs(endX - x), dy = -Math.abs(endY - y)
    if (Math.max(dx, -dy) > 100000) return
    const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1
    let error = dx + dy
    for (;;) {
      this.pixel(x, y, color)
      if (x === endX && y === endY) break
      const twice = error * 2
      if (twice >= dy) { error += dy; x += sx }
      if (twice <= dx) { error += dx; y += sy }
    }
  }
  snapshot() { return Array.from(this.pixels) }
}
