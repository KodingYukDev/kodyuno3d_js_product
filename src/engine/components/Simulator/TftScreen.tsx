import { useEffect, useRef } from 'react'
import { rgb565 } from '@kodyuno/lib/displayColor'

export function TftScreen({ state }: { state: Record<string, unknown> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const data = context.createImageData(240, 320)
    const pixels = Array.isArray(state.framebuffer) ? state.framebuffer : []
    for (let i = 0; i < 240 * 320; i++) {
      const color = Number(pixels[i] ?? state.bgColor ?? 0) & 0xffff
      const r = color >> 11, g = (color >> 5) & 63, b = color & 31
      data.data.set([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255], i * 4)
    }
    context.putImageData(data, 0, 0)
    if (Array.isArray(state.textRuns)) {
      for (const run of state.textRuns) {
        if (!run || typeof run.text !== 'string') continue
        const size = Math.max(1, Math.min(16, Number(run.size) || 1))
        context.save()
        switch (Number(run.rotation) & 3) {
          case 1: context.translate(240, 0); context.rotate(Math.PI / 2); break
          case 2: context.translate(240, 320); context.rotate(Math.PI); break
          case 3: context.translate(0, 320); context.rotate(-Math.PI / 2); break
        }
        if (typeof run.background === 'number') {
          context.fillStyle = rgb565(run.background)
          context.fillRect(Number(run.x) || 0, Number(run.y) || 0, 6 * size, 8 * size)
        }
        context.fillStyle = rgb565(run.color, 0xffff)
        context.font = `${size * 8}px monospace`
        context.textBaseline = 'top'
        context.fillText(run.text, Number(run.x) || 0, Number(run.y) || 0)
        context.restore()
      }
      return
    }
    const size = Math.max(1, Math.min(16, Number(state.textSize) || 1))
    context.fillStyle = rgb565(state.textColor, 0xffff)
    context.font = `${size * 8}px monospace`
    context.textBaseline = 'top'
    if (Array.isArray(state.lines)) state.lines.slice(0, 40).forEach((line, i) => context.fillText(String(line), 0, i * 8 * size))
  }, [state])
  return <canvas ref={canvas} width={240} height={320} aria-label="Layar TFT ILI9341" style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
}
