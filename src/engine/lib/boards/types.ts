// ============================================================
// KodyUno — Board definition model
//
// One BoardDef fully describes a development board for the simulator:
//  * its header layout (pin ids, silkscreen labels, coordinates)
//  * the electrical capability of every pin (PWM / ADC / DAC / touch)
//  * the MCU traits the interpreter needs (ADC bits, logic voltage, aliases)
//  * how to draw it (vendored element artwork, or KodyUno's generic devkit)
//
// Coordinates are CSS pixels at 96dpi, the same space the element artwork
// uses. `BOARD_SCALE` converts them into simulator canvas units so a board
// and a breadboard share one physical scale.
// ============================================================
import { WORLD_UNITS_PER_MM } from '@kodyuno/lib/partSpecs'

export const CSS_PX_PER_MM = 96 / 25.4
/** CSS px (96dpi) → simulator canvas units. */
export const BOARD_SCALE = WORLD_UNITS_PER_MM / CSS_PX_PER_MM
/** One 2.54mm header pitch, expressed in CSS px. */
export const HEADER_PITCH_PX = 2.54 * CSS_PX_PER_MM

export type BoardId =
  | 'uno'
  | 'nano'
  | 'mega'
  | 'esp32'
  | 'esp32-s3'
  | 'esp32-s2'
  | 'esp32-c3'
  | 'esp32-c6'
  | 'esp8266'

export type PinKind = 'gpio' | 'analog' | 'power' | 'gnd' | 'special'

export interface BoardPin {
  /** Node id used by wires and the circuit solver. Numeric for GPIO. */
  id: number | string
  /** Silkscreen label. */
  label: string
  /** CSS px, relative to the board artwork origin. */
  x: number
  y: number
  kind: PinKind
  /** A wire may attach here. */
  connectable: boolean
  /** Hardware PWM capable (AVR timer pin / ESP LEDC capable). */
  pwm?: boolean
  /** Analog channel alias, e.g. 'A0'. `analogRead(A0)` resolves through this. */
  adc?: string
  /** ESP32 GPIOs 34–39 cannot be driven as outputs. */
  inputOnly?: boolean
  /** Capacitive touch channel. */
  touch?: boolean
  /** True DAC output (ESP32 GPIO 25/26). */
  dac?: boolean
  /** Nominal voltage for power rails. */
  volts?: number
  /** Extra warning shown in the inspector, e.g. strapping pins. */
  note?: string
}

export type BoardArtwork =
  | {
      kind: 'element'
      /** Custom element tag from the vendored KodyUno element library. */
      tag: string
      cssW: number
      cssH: number
      /** Static props passed to the element (LED props are added at render). */
      props?: Record<string, unknown>
    }
  | {
      kind: 'generic'
      cssW: number
      cssH: number
      theme: GenericBoardTheme
    }

export interface GenericBoardTheme {
  /** PCB solder mask colour. */
  pcb: string
  /** Silkscreen colour. */
  silk: string
  /** RF shield / module can colour. */
  shield: string
  /** Text printed on the RF shield. */
  moduleLabel: string
  /** Text printed under the module. */
  subLabel: string
  usb: 'usb-c' | 'micro' | 'mini'
  /** Number of USB sockets along the top edge. */
  usbCount?: number
  buttons?: string[]
}

export interface BoardDef {
  id: BoardId
  /** Full product name shown in the picker. */
  name: string
  /** Compact name for chips and headers. */
  shortName: string
  vendor: string
  mcu: string
  arch: 'avr' | 'xtensa' | 'riscv'
  family: 'arduino' | 'esp32' | 'esp8266'
  /** IO logic level in volts — 5 on classic AVR, 3.3 on every ESP. */
  logicVolts: number
  /** analogRead() resolution in bits (10 on AVR, 12 on ESP32, 10 on ESP8266). */
  adcBits: number
  /** analogWrite() / LEDC resolution in bits. */
  pwmBits: number
  cpuMHz: number
  flashKB: number
  ramKB: number
  hasWiFi: boolean
  hasBLE: boolean
  /** Pin behind LED_BUILTIN, or null when the board has no user LED. */
  builtinLed: number | string | null
  /** Onboard LED sinks current when its GPIO is LOW. */
  builtinLedActiveLow?: boolean
  artwork: BoardArtwork
  pins: BoardPin[]
  /**
   * Identifier → pin, injected into the interpreter's global scope.
   * Covers LED_BUILTIN, the A0.. aliases, and the ESP8266 D0..D8 labels.
   */
  aliases: Record<string, number | string>
  /** Short KodyUno blurb shown in the board picker. */
  blurb: string
}

/** Every pin id that is electrically ground on a board. */
export function gndIds(board: BoardDef): Set<string> {
  return new Set(board.pins.filter((p) => p.kind === 'gnd').map((p) => String(p.id)))
}

/** Power rail id → volts (5V / 3V3 / VIN). */
export function powerRails(board: BoardDef): Record<string, number> {
  const rails: Record<string, number> = {}
  for (const pin of board.pins) {
    if (pin.kind === 'power' && pin.volts) rails[String(pin.id)] = pin.volts
  }
  return rails
}

export function boardPin(board: BoardDef, id: number | string): BoardPin | undefined {
  return board.pins.find((p) => p.id === id)
}

/** Digital-capable pin ids, in ascending hardware order. */
export function digitalPinIds(board: BoardDef): (number | string)[] {
  return board.pins.filter((p) => p.kind === 'gpio' || p.kind === 'analog').map((p) => p.id)
}

/** Analog channel alias → pin id, e.g. `A0` → 'A0' on AVR, 36 on ESP32. */
export function analogAliases(board: BoardDef): Record<string, number | string> {
  const map: Record<string, number | string> = {}
  for (const pin of board.pins) {
    if (pin.adc) map[pin.adc] = pin.id
  }
  return map
}

// ------------------------------------------------------------
// Header layout helpers for KodyUno's own devkit artwork
// ------------------------------------------------------------

/** Shorthand row entry used by the generic devkit builders. */
export interface PinSpec extends Omit<BoardPin, 'x' | 'y' | 'connectable'> {
  connectable?: boolean
}

export interface DevkitLayout {
  /** Left header, top → bottom. */
  left: PinSpec[]
  /** Right header, top → bottom. */
  right: PinSpec[]
  /** Distance from the board edge to the header centreline, in CSS px. */
  edgeInset?: number
  /** Vertical offset of the first header pin, in CSS px. */
  topInset?: number
  /** Board material below the last header pin, in CSS px. */
  bottomInset?: number
  /** Board width in CSS px. */
  cssW: number
}

/** Turn two header columns into positioned BoardPins. */
export function layoutDevkit(layout: DevkitLayout): { pins: BoardPin[]; cssH: number } {
  const inset = layout.edgeInset ?? 5
  const top = layout.topInset ?? 62
  const rows = Math.max(layout.left.length, layout.right.length)
  const place = (specs: PinSpec[], x: number): BoardPin[] =>
    specs.map((spec, i) => ({
      ...spec,
      x,
      y: top + i * HEADER_PITCH_PX,
      connectable: spec.connectable ?? true,
    }))

  return {
    pins: [
      ...place(layout.left, inset),
      ...place(layout.right, layout.cssW - inset),
    ],
    cssH: top + (rows - 1) * HEADER_PITCH_PX + (layout.bottomInset ?? 22),
  }
}
