import type { ComponentType } from '@kodyuno/types'
import { ELEMENT_GEOMETRY } from './elementParts'

// ============================================================
// Physical spec of every simulator part: bounding box + terminals.
// Terminal dx/dy are in the part's local coordinate space.
//  - leg: true  → a metal leg that can be plugged into a breadboard hole
//                 (leg spacing is a multiple of BB_PITCH=14 so legs align)
//  - kind       → semantic role, used for wire auto-coloring & rules
// ============================================================

export type TerminalKind = 'signal' | 'vcc' | 'gnd' | 'anode' | 'cathode' | 'passive'

export interface TerminalSpec {
  role: string
  dx: number
  dy: number
  color: string
  kind: TerminalKind
  leg?: boolean
}

/** Parts drawn from the KodyUno element library, sized by their artwork. */
export type ElementPartType =
  | 'ssd1306' | 'lcd2004' | 'tft_ili9341'
  | 'neopixel' | 'neopixel_matrix' | 'led_bar'
  | 'dht22' | 'mpu6050' | 'ds1307' | 'hx711'
  | 'ntc_temp' | 'heart_sensor' | 'tilt_switch'
  | 'slide_switch' | 'dip_switch' | 'microsd'
  | 'servo' | 'lcd' | 'dht11' | 'ultrasonic' | 'pir'
  | 'potentiometer' | 'ldr' | 'sound_sensor' | 'gas_sensor' | 'flame_sensor'
  | 'joystick' | 'ir_receiver' | 'rotary_encoder' | 'keypad' | 'seven_segment' | 'stepper'

/** Parts with a hand-authored terminal layout scaled to real dimensions. */
export type LegacyPartType = Exclude<ComponentType, ElementPartType>

export interface PartSpec {
  w: number
  h: number
  terminals: TerminalSpec[]
  /** part body can be plugged onto the breadboard (all legs snap to holes) */
  pluggable?: boolean
  /** How the solver should evaluate this part. Modules require VCC/GND. */
  electrical?: 'module' | 'passive' | 'led' | 'rgb-led' | 'resistor' | 'buzzer' | 'input'
}

const BASE_PART_SPECS: Record<LegacyPartType, PartSpec> = {
  // led/resistor/buzzer/rgb_led stay hand-tuned (not element-backed) because
  // they need `leg`/`pluggable` — a breadboard-plug part, unlike the
  // ElementPartType set below which is always wired with a loose jumper.
  // w/h and terminal dx/dy are the real kody-* element's own css-px size and
  // `pinInfo` (its actual leg coordinates), taken straight from the vendored
  // source (led-element.js / resistor-element.js / …) — not measured from
  // the artwork by eye — so the terminal dot lands exactly on the drawn leg.
  led: {
    w: 40,
    h: 50,
    pluggable: true,
    electrical: 'led',
    terminals: [
      { role: 'anode', dx: 25, dy: 42, color: '#ef4444', kind: 'anode', leg: true },
      { role: 'cathode', dx: 15, dy: 42, color: '#334155', kind: 'cathode', leg: true },
    ],
  },
  resistor: {
    w: 59.13,
    h: 11.34,
    pluggable: true,
    electrical: 'resistor',
    terminals: [
      { role: 't1', dx: 0, dy: 5.65, color: '#78716c', kind: 'passive', leg: true },
      { role: 't2', dx: 58.8, dy: 5.65, color: '#78716c', kind: 'passive', leg: true },
    ],
  },
  buzzer: {
    w: 75,
    h: 84,
    pluggable: true,
    electrical: 'buzzer',
    terminals: [
      { role: 'signal', dx: 27, dy: 84, color: '#f59e0b', kind: 'signal', leg: true },
      { role: 'gnd', dx: 37, dy: 84, color: '#334155', kind: 'gnd', leg: true },
    ],
  },
  rgb_led: {
    // real kody-rgb-led element's own css size + pinInfo (see led/resistor comment above)
    w: 42.129, h: 72.582, pluggable: true, electrical: 'rgb-led',
    terminals: [
      { role: 'red', dx: 8.5, dy: 44, color: '#ef4444', kind: 'signal', leg: true },
      { role: 'common', dx: 18, dy: 54, color: '#334155', kind: 'gnd', leg: true },
      { role: 'green', dx: 26.4, dy: 44, color: '#22c55e', kind: 'signal', leg: true },
      { role: 'blue', dx: 35.7, dy: 44, color: '#3b82f6', kind: 'signal', leg: true },
    ],
  },
  pushbutton: {
    // real kody-pushbutton element's own css size + pinInfo. Real part has 4
    // legs (1.l/2.l/1.r/2.r — a 4-leg tact switch); this sim keeps the
    // simplified 2-terminal model but places them on the diagonal pair
    // (1.l / 2.r) real tutorials wire, so the dot sits on an actual leg.
    w: 67.28, h: 45.35, pluggable: true, electrical: 'input',
    terminals: [
      { role: 'signal', dx: 0, dy: 13, color: '#8b5cf6', kind: 'signal', leg: true },
      { role: 'gnd', dx: 67, dy: 32, color: '#334155', kind: 'gnd', leg: true },
    ],
  },
  lm35: {
    w: 38, h: 50,
    terminals: [
      { role: 'vcc', dx: 8, dy: 46, color: '#dc2626', kind: 'vcc' },
      { role: 'signal', dx: 19, dy: 46, color: '#f97316', kind: 'signal' },
      { role: 'gnd', dx: 30, dy: 46, color: '#334155', kind: 'gnd' },
    ],
  },
  led_matrix4: {
    w: 300, h: 80,
    terminals: [
      { role: 'vcc', dx: 4, dy: 12, color: '#dc2626', kind: 'vcc' },
      { role: 'gnd', dx: 4, dy: 26, color: '#334155', kind: 'gnd' },
      { role: 'din', dx: 4, dy: 40, color: '#8b5cf6', kind: 'signal' },
      { role: 'cs', dx: 4, dy: 54, color: '#0ea5e9', kind: 'signal' },
      { role: 'clk', dx: 4, dy: 68, color: '#f97316', kind: 'signal' },
    ],
  },
  ds18b20: {
    w: 38, h: 50,
    terminals: [
      { role: 'gnd', dx: 8, dy: 46, color: '#334155', kind: 'gnd' },
      { role: 'data', dx: 19, dy: 46, color: '#eab308', kind: 'signal' },
      { role: 'vcc', dx: 30, dy: 46, color: '#dc2626', kind: 'vcc' },
    ],
  },
  water_sensor: {
    w: 74, h: 64,
    terminals: [
      { role: 'signal', dx: 19, dy: 60, color: '#0ea5e9', kind: 'signal' },
      { role: 'vcc', dx: 37, dy: 60, color: '#dc2626', kind: 'vcc' },
      { role: 'gnd', dx: 55, dy: 60, color: '#334155', kind: 'gnd' },
    ],
  },
  // Tinkercad-style bench meter: two probe sockets wired with jumpers.
  // Reads are computed by dcSolver.ts; `passive` keeps it out of module checks.
  multimeter: {
    w: 70, h: 96,
    electrical: 'passive',
    terminals: [
      { role: 'com', dx: 22, dy: 92, color: '#111827', kind: 'passive' },
      { role: 'v', dx: 48, dy: 92, color: '#dc2626', kind: 'passive' },
    ],
  },
  // Wokwi-style 8-channel logic analyzer: D0–D7 probe sockets + GND.
  logic_analyzer: {
    w: 100, h: 60,
    electrical: 'passive',
    terminals: [
      ...Array.from({ length: 8 }, (_, i) => ({ role: `d${i}`, dx: 10 + i * 10, dy: 56, color: ['#a16207', '#dc2626', '#f97316', '#eab308', '#16a34a', '#2563eb', '#7c3aed', '#6b7280'][i], kind: 'passive' as const })),
      { role: 'gnd', dx: 90, dy: 56, color: '#111827', kind: 'gnd' },
    ],
  },
  relay: {
    w: 80, h: 56,
    terminals: [
      { role: 'in', dx: 10, dy: 52, color: '#f97316', kind: 'signal' },
      { role: 'vcc', dx: 26, dy: 52, color: '#dc2626', kind: 'vcc' },
      { role: 'gnd', dx: 42, dy: 52, color: '#334155', kind: 'gnd' },
      { role: 'com', dx: 58, dy: 52, color: '#64748b', kind: 'passive' },
      { role: 'no', dx: 74, dy: 52, color: '#22c55e', kind: 'passive' },
    ],
  },
  rfid: {
    w: 92, h: 68,
    terminals: [
      { role: 'sda', dx: 8, dy: 64, color: '#8b5cf6', kind: 'signal' },
      { role: 'sck', dx: 20, dy: 64, color: '#0ea5e9', kind: 'signal' },
      { role: 'mosi', dx: 32, dy: 64, color: '#f97316', kind: 'signal' },
      { role: 'miso', dx: 44, dy: 64, color: '#22c55e', kind: 'signal' },
      { role: 'rst', dx: 56, dy: 64, color: '#eab308', kind: 'signal' },
      { role: 'vcc', dx: 68, dy: 64, color: '#dc2626', kind: 'vcc' },
      { role: 'gnd', dx: 80, dy: 64, color: '#334155', kind: 'gnd' },
    ],
  },
  led_matrix: {
    w: 82, h: 76,
    terminals: [
      { role: 'din', dx: 18, dy: 72, color: '#8b5cf6', kind: 'signal' },
      { role: 'cs', dx: 34, dy: 72, color: '#0ea5e9', kind: 'signal' },
      { role: 'clk', dx: 50, dy: 72, color: '#f97316', kind: 'signal' },
      { role: 'vcc', dx: 66, dy: 72, color: '#dc2626', kind: 'vcc' },
      { role: 'gnd', dx: 78, dy: 72, color: '#334155', kind: 'gnd' },
    ],
  },
}

/**
 * One real breadboard pitch is 2.54mm and is represented by 14 canvas units.
 * Keeping this as the single physical scale makes parts, the breadboard, and
 * the Arduino comparable by their real-world dimensions.
 */
export const WORLD_UNITS_PER_MM = 14 / 2.54
const ELEMENT_CSS_TO_WORLD = WORLD_UNITS_PER_MM / (96 / 25.4)
const mmSize = (w: number, h: number) => ({ w: w * WORLD_UNITS_PER_MM, h: h * WORLD_UNITS_PER_MM })
const elementCssSize = (w: number, h: number) => ({ w: w * ELEMENT_CSS_TO_WORLD, h: h * ELEMENT_CSS_TO_WORLD })

/** Real/intrinsic dimensions converted to the canvas' breadboard scale. */
export const LEGACY_PART_SIZES: Record<LegacyPartType, { w: number; h: number }> = {
  // matches BASE_PART_SPECS' own w/h 1:1 (already the real element's css-px
  // size) so this scale factor is always ELEMENT_CSS_TO_WORLD, uniformly.
  led: elementCssSize(40, 50),
  rgb_led: elementCssSize(42.129, 72.582),
  resistor: elementCssSize(59.13, 11.34),
  buzzer: elementCssSize(75, 84),
  pushbutton: elementCssSize(67.28, 45.35),
  lm35: mmSize(10, 14),
  ds18b20: mmSize(10, 14),
  led_matrix4: mmSize(131, 35),
  water_sensor: mmSize(42, 36.32),
  relay: mmSize(40, 28),
  multimeter: mmSize(35, 48),
  logic_analyzer: mmSize(45.72, 27.43),
  rfid: mmSize(46, 34),
  led_matrix: mmSize(36, 33.37),
}

/** Scale the established electrical terminal layout with the physical body. */
const SCALED_LEGACY_SPECS = Object.fromEntries(
  (Object.keys(BASE_PART_SPECS) as LegacyPartType[]).map((type) => {
    const base = BASE_PART_SPECS[type]
    const size = LEGACY_PART_SIZES[type]
    const sx = size.w / base.w
    const sy = size.h / base.h
    return [type, {
      ...base,
      ...size,
      terminals: base.terminals.map((terminal) => ({
        ...terminal,
        dx: terminal.dx * sx,
        dy: terminal.dy * sy,
      })),
    }]
  }),
) as Record<LegacyPartType, PartSpec>

// ------------------------------------------------------------
// Element-backed parts
//
// Newer parts skip the hand-tuned terminal layout entirely: their body size
// and terminal positions are read from the element artwork, so they line up
// by construction. `electrical` still says how the solver should treat them.
// ------------------------------------------------------------

/** ComponentType → key in ELEMENT_GEOMETRY, plus how the solver models it. */
export const ELEMENT_PART_SOURCE: Record<ElementPartType, { geometry: string; electrical: PartSpec['electrical'] }> = {
  ssd1306: { geometry: 'ssd1306', electrical: 'module' },
  lcd2004: { geometry: 'lcd2004', electrical: 'module' },
  tft_ili9341: { geometry: 'ili9341', electrical: 'module' },
  neopixel: { geometry: 'neopixel', electrical: 'module' },
  neopixel_matrix: { geometry: 'neopixel-matrix', electrical: 'module' },
  led_bar: { geometry: 'led-bar-graph', electrical: 'passive' },
  dht22: { geometry: 'dht22', electrical: 'module' },
  mpu6050: { geometry: 'mpu6050', electrical: 'module' },
  ds1307: { geometry: 'ds1307', electrical: 'module' },
  hx711: { geometry: 'hx711', electrical: 'module' },
  ntc_temp: { geometry: 'ntc-temperature-sensor', electrical: 'input' },
  heart_sensor: { geometry: 'heart-beat-sensor', electrical: 'module' },
  tilt_switch: { geometry: 'tilt-switch', electrical: 'module' },
  slide_switch: { geometry: 'slide-switch', electrical: 'input' },
  dip_switch: { geometry: 'dip-switch-8', electrical: 'input' },
  microsd: { geometry: 'microsd-card', electrical: 'module' },
  servo: { geometry: 'servo', electrical: 'module' },
  lcd: { geometry: 'lcd1602', electrical: 'module' },
  // DHT11 and DHT22 are the same physical package — Wokwi ships one visual.
  dht11: { geometry: 'dht22', electrical: 'module' },
  ultrasonic: { geometry: 'hc-sr04', electrical: 'module' },
  pir: { geometry: 'pir-motion-sensor', electrical: 'module' },
  potentiometer: { geometry: 'potentiometer', electrical: 'module' },
  ldr: { geometry: 'photoresistor-sensor', electrical: 'input' },
  sound_sensor: { geometry: 'big-sound-sensor', electrical: 'module' },
  gas_sensor: { geometry: 'gas-sensor', electrical: 'module' },
  flame_sensor: { geometry: 'flame-sensor', electrical: 'module' },
  joystick: { geometry: 'analog-joystick', electrical: 'module' },
  ir_receiver: { geometry: 'ir-receiver', electrical: 'module' },
  rotary_encoder: { geometry: 'ky-040', electrical: 'module' },
  keypad: { geometry: 'membrane-keypad', electrical: 'passive' },
  seven_segment: { geometry: '7segment', electrical: 'passive' },
  stepper: { geometry: 'stepper-motor', electrical: 'module' },
}

const ELEMENT_SPECS = Object.fromEntries(
  (Object.keys(ELEMENT_PART_SOURCE) as ElementPartType[]).map((type) => {
    const { geometry, electrical } = ELEMENT_PART_SOURCE[type]
    const source = ELEMENT_GEOMETRY[geometry]
    const scale = ELEMENT_CSS_TO_WORLD
    return [type, {
      w: source.cssW * scale,
      h: source.cssH * scale,
      electrical,
      terminals: source.terminals.map((terminal) => ({
        role: terminal.role,
        kind: terminal.kind,
        color: terminal.color,
        dx: terminal.dx * scale,
        dy: terminal.dy * scale,
      })),
    }]
  }),
) as Record<ElementPartType, PartSpec>

export const PART_SPECS: Record<ComponentType, PartSpec> = {
  ...SCALED_LEGACY_SPECS,
  ...ELEMENT_SPECS,
}

/** Real/intrinsic dimensions of every part, in canvas units. */
export const PHYSICAL_PART_SIZES: Record<ComponentType, { w: number; h: number }> = Object.fromEntries(
  (Object.keys(PART_SPECS) as ComponentType[]).map((type) => [type, { w: PART_SPECS[type].w, h: PART_SPECS[type].h }]),
) as Record<ComponentType, { w: number; h: number }>

/**
 * Terminal offset after rotating the part by `rot` degrees (0/90/180/270)
 * around its bounding-box center. Screen coords: +90° = clockwise.
 */
export function rotatedTerminal(
  spec: PartSpec,
  t: { dx: number; dy: number },
  rot: number | undefined
): { dx: number; dy: number } {
  const r = ((Math.round(rot ?? 0) % 360) + 360) % 360
  const cx = spec.w / 2
  const cy = spec.h / 2
  const dx = t.dx - cx
  const dy = t.dy - cy
  switch (r) {
    case 90: return { dx: cx - dy, dy: cy + dx }
    case 180: return { dx: cx - dx, dy: cy - dy }
    case 270: return { dx: cx + dy, dy: cy - dx }
    default: return { dx: t.dx, dy: t.dy }
  }
}

/** Resistor value presets (Ω) cycled by clicking the value badge. */
export const RESISTOR_VALUES = [220, 1000, 10000] as const

export function formatOhm(v: number): string {
  if (v >= 1000000) return `${v / 1000000}MΩ`
  if (v >= 1000) return `${v / 1000}kΩ`
  return `${v}Ω`
}

/** 4-band color code for the preset values. */
export function resistorBands(v: number): [string, string, string] {
  switch (v) {
    case 220: return ['#dc2626', '#dc2626', '#92400e'] // red red brown
    case 1000: return ['#92400e', '#111111', '#dc2626'] // brown black red
    case 10000: return ['#92400e', '#111111', '#f97316'] // brown black orange
    default: return ['#92400e', '#111111', '#111111']
  }
}
