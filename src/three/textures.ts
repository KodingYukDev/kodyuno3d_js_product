import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BoardDef } from '@kodyuno/lib/boards'
import type { ComponentType } from '@kodyuno/types'
import { ELEMENT_GEOMETRY } from '@kodyuno/lib/elementParts'
import { ELEMENT_PART_SOURCE, PHYSICAL_PART_SIZES, type ElementPartType } from '@kodyuno/lib/partSpecs'
import { REALISTIC_RENDERERS } from '@kodyuno/components/Simulator/RealisticPart'
import { GenericBoard } from '@kodyuno/components/Simulator/GenericBoard'
import { LolinBoard } from '@kodyuno/components/Simulator/LolinBoard'
import { rgb565 } from '@kodyuno/lib/displayColor'
import { propsKey, rasterizeElement, rasterizeMarkup } from './rasterize'

type State = Record<string, unknown>
const num = (value: unknown, fallback = 0) => (typeof value === 'number' ? value : fallback)
const yes = (value: unknown) => value === true
const numbers = (value: unknown, length: number) => {
  const list = Array.isArray(value) ? (value as number[]) : []
  return Array.from({ length }, (_, i) => Number(list[i] ?? 0))
}
const lines = (state: State) => (Array.isArray(state.lines) ? (state.lines as string[]).join('\n') : '')

const SEVEN_SEGMENT: Record<number, number[]> = {
  0: [1, 1, 1, 1, 1, 1, 0, 0], 1: [0, 1, 1, 0, 0, 0, 0, 0], 2: [1, 1, 0, 1, 1, 0, 1, 0], 3: [1, 1, 1, 1, 0, 0, 1, 0],
  4: [0, 1, 1, 0, 0, 1, 1, 0], 5: [1, 0, 1, 1, 0, 1, 1, 0], 6: [1, 0, 1, 1, 1, 1, 1, 0], 7: [1, 1, 1, 0, 0, 0, 0, 0],
  8: [1, 1, 1, 1, 1, 1, 1, 0], 9: [1, 1, 1, 1, 0, 1, 1, 0],
}

/**
 * Element props per part, mirroring RealisticPart's elementBacked table so
 * the texture shows exactly what the 2D canvas shows for the same state.
 * Parts that move in 3D (servo horn, pot knob, joystick) get a neutral pose
 * here; the mesh animates the moving piece.
 */
const ELEMENT_PROPS: Partial<Record<ElementPartType, (state: State) => Record<string, unknown>>> = {
  lcd2004: s => ({ text: lines(s), pins: 'i2c', backlight: yes(s.backlight ?? true) }),
  lcd: s => ({ text: lines(s), pins: 'i2c', backlight: yes(s.backlight ?? true) }),
  neopixel: s => ({ r: num(s.red) / 255, g: num(s.green) / 255, b: num(s.blue) / 255 }),
  neopixel_matrix: s => ({ rows: num(s.rows, 8), cols: num(s.cols, 8), pixels: s.pixels ?? [] }),
  led_bar: s => ({ values: numbers(s.values, 10), color: 'red' }),
  mpu6050: s => ({ led1: yes(s.powered) }),
  hx711: () => ({ type: '5kg' }),
  slide_switch: s => ({ value: num(s.value) }),
  dip_switch: s => ({ values: numbers(s.values, 8) }),
  servo: () => ({ angle: 0, horn: 'single' }),
  potentiometer: () => ({ value: 0.5 }),
  joystick: () => ({ xValue: 0.5, yValue: 0.5 }),
  keypad: () => ({ connector: true }),
  seven_segment: s => ({ values: Array.isArray(s.segments) ? numbers(s.segments, 8) : SEVEN_SEGMENT[num(s.value, 0)] ?? SEVEN_SEGMENT[0] }),
  stepper: s => ({ angle: num(s.angle) }),
}

export interface Artwork {
  /** Changes whenever the pixels would. */
  key: string
  /** Live displays repaint every frame they change; they skip the cache. */
  live?: boolean
  draw(): Promise<HTMLCanvasElement>
}

const SCALE = 4

function elementArtwork(type: ElementPartType, state: State): Artwork {
  const geometry = ELEMENT_GEOMETRY[ELEMENT_PART_SOURCE[type].geometry]
  const props = ELEMENT_PROPS[type]?.(state) ?? {}
  return {
    key: `${geometry.tag}|${propsKey(props)}`,
    draw: () => rasterizeElement(geometry.tag, props, geometry.cssW, geometry.cssH, SCALE),
  }
}

/** Hand-drawn SVG parts (relay, RFID, LM35 …) render straight to markup. */
function markupArtwork(type: ComponentType, state: State, id: string): Artwork | null {
  const render = REALISTIC_RENDERERS[type]
  if (!render) return null
  const { w, h } = PHYSICAL_PART_SIZES[type]
  const markup = renderToStaticMarkup(createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg', width: w, height: h, viewBox: `0 0 ${w} ${h}`,
  }, render(state, `p${id.replace(/[^a-z0-9]/gi, '')}`)))
  return { key: markup, draw: () => rasterizeMarkup(markup, markup, w, h, SCALE * 1.4) }
}

function screenCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function paintOled(state: State): HTMLCanvasElement {
  const canvas = screenCanvas(128, 64)
  const ctx = canvas.getContext('2d')!
  const background = state.inverted ? '#d9f7ff' : '#05090d'
  const foreground = state.inverted ? '#080d12' : '#9be7ff'
  ctx.fillStyle = background
  ctx.fillRect(0, 0, 128, 64)
  ctx.fillStyle = foreground
  const pixels = Array.isArray(state.framebuffer) ? (state.framebuffer as number[]) : []
  for (let i = 0; i < Math.min(pixels.length, 8192); i++) if (pixels[i]) ctx.fillRect(i % 128, Math.floor(i / 128), 1, 1)
  const size = Math.max(1, Math.min(8, num(state.textSize, 1)))
  ctx.font = `${8 * size}px monospace`
  ctx.textBaseline = 'alphabetic'
  const text = Array.isArray(state.lines) ? (state.lines as unknown[]) : []
  text.slice(0, 8).forEach((line, row) => ctx.fillText(String(line), 0, (row + 1) * 8 * size - 1))
  if (state.dimmed === true) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, 128, 64) }
  return canvas
}

function paintTft(state: State): HTMLCanvasElement {
  const canvas = screenCanvas(240, 320)
  const ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(240, 320)
  const pixels = Array.isArray(state.framebuffer) ? state.framebuffer : []
  for (let i = 0; i < 240 * 320; i++) {
    const color = Number(pixels[i] ?? state.bgColor ?? 0) & 0xffff
    const r = color >> 11, g = (color >> 5) & 63, b = color & 31
    data.data[i * 4] = (r << 3) | (r >> 2)
    data.data[i * 4 + 1] = (g << 2) | (g >> 4)
    data.data[i * 4 + 2] = (b << 3) | (b >> 2)
    data.data[i * 4 + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  ctx.textBaseline = 'top'
  if (Array.isArray(state.textRuns)) {
    for (const run of state.textRuns as Array<Record<string, unknown>>) {
      if (!run || typeof run.text !== 'string') continue
      const size = Math.max(1, Math.min(16, Number(run.size) || 1))
      ctx.save()
      switch (Number(run.rotation) & 3) {
        case 1: ctx.translate(240, 0); ctx.rotate(Math.PI / 2); break
        case 2: ctx.translate(240, 320); ctx.rotate(Math.PI); break
        case 3: ctx.translate(0, 320); ctx.rotate(-Math.PI / 2); break
      }
      if (typeof run.background === 'number') {
        ctx.fillStyle = rgb565(run.background)
        ctx.fillRect(Number(run.x) || 0, Number(run.y) || 0, 6 * size * run.text.length, 8 * size)
      }
      ctx.fillStyle = rgb565(run.color, 0xffff)
      ctx.font = `${size * 8}px monospace`
      ctx.fillText(run.text, Number(run.x) || 0, Number(run.y) || 0)
      ctx.restore()
    }
  } else if (Array.isArray(state.lines)) {
    const size = Math.max(1, Math.min(16, Number(state.textSize) || 1))
    ctx.fillStyle = rgb565(state.textColor, 0xffff)
    ctx.font = `${size * 8}px monospace`
    ;(state.lines as unknown[]).slice(0, 40).forEach((line, i) => ctx.fillText(String(line), 0, i * 8 * size))
  }
  return canvas
}

/** Element frame with a screen painted on top (OLED, TFT). */
function screenArtwork(type: 'ssd1306' | 'tft_ili9341', state: State): Artwork {
  const frame = elementArtwork(type, {})
  const geometry = ELEMENT_GEOMETRY[ELEMENT_PART_SOURCE[type].geometry]
  const key = `${type}|${propsKey({ f: state.framebuffer, l: state.lines, t: state.textRuns, i: state.inverted, d: state.dimmed, b: state.bgColor, s: state.textSize, c: state.textColor })}`
  return {
    key,
    live: true,
    async draw() {
      const base = await frame.draw()
      const canvas = screenCanvas(base.width, base.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      ctx.imageSmoothingEnabled = false
      const sx = base.width / geometry.cssW, sy = base.height / geometry.cssH
      if (type === 'ssd1306') ctx.drawImage(paintOled(state), 11.5 * sx, 27 * sy, 128 * sx, 64 * sy)
      else ctx.drawImage(paintTft(state), geometry.cssW * 0.04 * sx, geometry.cssH * 0.1 * sy, geometry.cssW * 0.91 * sx, geometry.cssH * 0.7 * sy)
      return canvas
    },
  }
}

/** Top-face artwork of a part, or null when the part is fully modelled in 3D. */
export function partArtwork(type: ComponentType, state: State, id: string): Artwork | null {
  if (type === 'ssd1306' || type === 'tft_ili9341') return screenArtwork(type, state)
  if (type in ELEMENT_PART_SOURCE) return elementArtwork(type as ElementPartType, state)
  return markupArtwork(type, state, id)
}

/** Board artwork: photo-real element (Uno, Nano, Mega, ESP32) or KodyUno's generic devkit. */
export function boardArtwork(board: BoardDef, ledOn: boolean, powerOn: boolean): Artwork {
  const art = board.artwork
  if (art.kind === 'element') {
    const leds = board.family === 'esp32' ? { led1: ledOn, ledPower: powerOn } : { led13: ledOn, ledPower: powerOn, ledTX: powerOn, ledRX: false }
    const props = { ...leds, ...art.props }
    return { key: `${art.tag}|${propsKey(props)}`, draw: () => rasterizeElement(art.tag, props, art.cssW, art.cssH, 4) }
  }
  const body = board.id === 'esp8266'
    ? createElement(LolinBoard, { board, ledOn })
    : createElement(GenericBoard, { board, ledOn, powerOn })
  const markup = renderToStaticMarkup(createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg', width: art.cssW, height: art.cssH, viewBox: `0 0 ${art.cssW} ${art.cssH}`,
  }, body))
  return { key: markup, draw: () => rasterizeMarkup(markup, markup, art.cssW, art.cssH, 4) }
}
