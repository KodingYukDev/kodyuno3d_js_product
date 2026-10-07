/* eslint-disable react-refresh/only-export-components -- renderer registry is consumed by the SVG canvas */
import { createElement, type CSSProperties, type ReactNode } from 'react'
import '@kodyuno/vendor/kody-elements'
import type { ComponentType } from '@kodyuno/types'
import { ELEMENT_PART_SOURCE, PHYSICAL_PART_SIZES, type ElementPartType } from '@kodyuno/lib/partSpecs'
import { ELEMENT_GEOMETRY } from '@kodyuno/lib/elementParts'
import { matrixBrightness } from '@kodyuno/lib/matrixDisplay'
import { TftScreen } from './TftScreen'

type PartRenderer = (state: Record<string, unknown>, uid: string) => ReactNode
const num = (value: unknown, fallback = 0) => typeof value === 'number' ? value : fallback
const yes = (value: unknown) => value === true

// Standard 7-segment digit → [a,b,c,d,e,f,g,dp] lit pattern, matching the
// role order our own terminals use (and the values[] array kody-7segment
// expects — not a plain 0-9 number, which is only our own state shape).
const SEVEN_SEGMENT_DIGITS: Record<number, number[]> = {
  0: [1, 1, 1, 1, 1, 1, 0, 0],
  1: [0, 1, 1, 0, 0, 0, 0, 0],
  2: [1, 1, 0, 1, 1, 0, 1, 0],
  3: [1, 1, 1, 1, 0, 0, 1, 0],
  4: [0, 1, 1, 0, 0, 1, 1, 0],
  5: [1, 0, 1, 1, 0, 1, 1, 0],
  6: [1, 0, 1, 1, 1, 1, 1, 0],
  7: [1, 1, 1, 0, 0, 0, 0, 0],
  8: [1, 1, 1, 1, 1, 1, 1, 0],
  9: [1, 1, 1, 1, 0, 1, 1, 0],
}
const sevenSegmentValues = (digit: number) => SEVEN_SEGMENT_DIGITS[digit] ?? SEVEN_SEGMENT_DIGITS[0]

function KodyElement({ tag, w, h, sourceW, sourceH, props = {} }: {
  tag: string; w: number; h: number; sourceW: number; sourceH: number; props?: Record<string, unknown>
}) {
  // Element SVGs often declare their size in millimetres. CSS resolves those
  // values to 96dpi pixels (1mm = 3.7795px), so scaling from the SVG viewBox
  // dimensions clips the shadow DOM artwork. sourceW/sourceH are the actual
  // rendered CSS dimensions of each element, not its viewBox dimensions.
  const scale = Math.min(w / sourceW, h / sourceH)
  const renderedW = sourceW * scale
  const renderedH = sourceH * scale
  const offsetX = (w - renderedW) / 2
  const offsetY = (h - renderedH) / 2
  const style: CSSProperties = { display: 'block', width: sourceW, height: sourceH }
  return (
    <foreignObject x="0" y="0" width={w} height={h} style={{ overflow: 'visible', pointerEvents: 'none' }}>
      {/* overflow: visible — a lead/leg that runs past sourceW/sourceH (several
          elements draw legs slightly outside their own declared box) must
          never be hard-cropped; a few px of imprecision in sourceW/sourceH
          should cost alignment, not amputate the artwork. */}
      <div style={{ width: w, height: h, overflow: 'visible' }}>
        <div style={{ width: sourceW, height: sourceH, transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`, transformOrigin: '0 0' }}>
          {createElement(tag, { ...props, style })}
        </div>
      </div>
    </foreignObject>
  )
}

function KodyPart({ type, tag, sourceW, sourceH, props = {} }: {
  type: ComponentType; tag: string; sourceW: number; sourceH: number; props?: Record<string, unknown>
}) {
  const { w, h } = PHYSICAL_PART_SIZES[type]
  return <KodyElement tag={tag} w={w} h={h} sourceW={sourceW} sourceH={sourceH} props={props} />
}

function ModuleBoard({ id, w, h, color = '#167c62', children }: { id: string; w: number; h: number; color?: string; children: ReactNode }) {
  return <><defs><filter id={`module-shadow-${id}`} x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".28" /></filter></defs><rect x="1" y="1" width={w - 2} height={h - 7} rx="3" fill={color} stroke="#0f3f37" filter={`url(#module-shadow-${id})`} />{children}</>
}

const customBase: Partial<Record<ComponentType, PartRenderer>> = {
  lm35(state) {
    return <><path d="M7 30 V47 M19 30 V47 M31 30 V47" stroke="#9ca3af" strokeWidth="2" /><path d="M5 30 V13 A14 14 0 0 1 33 13 V30 Z" fill="#202124" /><path d="M8 13 A11 11 0 0 1 26 6" fill="none" stroke="#4b5563" strokeWidth="2" /><text x="19" y="22" textAnchor="middle" fontSize="6" fill="#e5e7eb">LM35</text><text x="19" y="29" textAnchor="middle" fontSize="5" fill="#fbbf24">{num(state.temperature, 25)}°C</text></>
  },
  led_matrix4(state, id) {
    const modules = Array.isArray(state.modules) ? state.modules as Array<Record<string, unknown>> : []
    return <ModuleBoard id={id} w={300} h={80} color="#1d4ed8"><text x="13" y="9" fontSize="5" fill="#dbeafe">IN</text>{Array.from({ length: 4 }).map((_, m) => {
      const module = modules[m] ?? (m === 0 ? state : {})
      const pixels = Array.isArray(module.pixels) ? module.pixels as number[] : []
      const brightness = matrixBrightness(module)
      return <g key={m} transform={`translate(${14 + m * 70} 4)`}><rect width="68" height="66" rx="2" fill="#101827" />{Array.from({ length: 64 }).map((__, i) => <g key={i}>
        <circle cx={5 + (i % 8) * 8.2} cy={5 + Math.floor(i / 8) * 8.1} r="3" fill="#5b1717" />
        {pixels.includes(i) && brightness > 0 && <circle cx={5 + (i % 8) * 8.2} cy={5 + Math.floor(i / 8) * 8.1} r="3" fill="#ff3535" opacity={Math.sqrt(brightness)} />}
      </g>)}<text x="34" y="74" textAnchor="middle" fontSize="5" fill="#dbeafe">{m}</text></g>
    })}</ModuleBoard>
  },
  ds18b20(state) {
    return <><path d="M7 30 V47 M19 30 V47 M31 30 V47" stroke="#9ca3af" strokeWidth="2" /><path d="M5 30 V13 A14 14 0 0 1 33 13 V30 Z" fill="#202124" /><path d="M8 13 A11 11 0 0 1 26 6" fill="none" stroke="#4b5563" strokeWidth="2" /><text x="19" y="20" textAnchor="middle" fontSize="5" fill="#e5e7eb">DS18B20</text><text x="19" y="28" textAnchor="middle" fontSize="5" fill="#fbbf24">{num(state.temperature, 25)}°C</text><text x="7" y="38" textAnchor="middle" fontSize="3.5" fill="#9ca3af">G</text><text x="19" y="38" textAnchor="middle" fontSize="3.5" fill="#9ca3af">DQ</text><text x="31" y="38" textAnchor="middle" fontSize="3.5" fill="#9ca3af">V</text></>
  },
  water_sensor(state, id) {
    const level = Math.max(0, Math.min(1023, num(state.level)))
    return <ModuleBoard id={id} w={74} h={64} color="#bd2026"><rect x="9" y="5" width="56" height="42" rx="2" fill="#d52b32" />{Array.from({ length: 8 }).map((_, i) => <path key={i} d={`M${14 + i * 7} 9 V43`} stroke="#f0a42b" strokeWidth="3" />)}<rect x="9" y={47 - 35 * level / 1023} width="56" height={35 * level / 1023} fill="#38bdf8" opacity=".42" /><text x="37" y="56" textAnchor="middle" fontSize="6" fill="white" fontWeight="bold">WATER {Math.round(level / 10.23)}%</text></ModuleBoard>
  },
  multimeter(state) {
    const mode = state.mode === 'mA' || state.mode === 'ohm' ? state.mode : 'V'
    const reading = typeof state.reading === 'number' && Number.isFinite(state.reading) ? state.reading : null
    const text = state.reading === undefined ? '----' : reading === null ? 'OL'
      : mode === 'ohm' ? (reading >= 1000 ? `${(reading / 1000).toFixed(2)}k` : reading.toFixed(0))
      : mode === 'mA' ? reading.toFixed(1) : reading.toFixed(2)
    const unit = mode === 'ohm' ? 'Ω' : mode
    return <>
      <rect x="2" y="2" width="66" height="92" rx="9" fill="#f59e0b" stroke="#92400e" strokeWidth="1.5" />
      <rect x="7" y="7" width="56" height="82" rx="6" fill="#1f2937" />
      <rect x="11" y="12" width="48" height="22" rx="2" fill="#bef264" stroke="#365314" />
      <text x="56" y="29" textAnchor="end" fontSize="13" fontFamily="monospace" fontWeight="bold" fill="#1a2e05">{text}</text>
      <text x="14" y="19" fontSize="5" fontFamily="monospace" fill="#365314">{unit}</text>
      <circle cx="35" cy="54" r="12" fill="#374151" stroke="#9ca3af" />
      <path d={`M35 54 L${35 + 9 * Math.cos(mode === 'V' ? -2.4 : mode === 'mA' ? -1.57 : -0.7)} ${54 + 9 * Math.sin(mode === 'V' ? -2.4 : mode === 'mA' ? -1.57 : -0.7)}`} stroke="#f9fafb" strokeWidth="2.5" strokeLinecap="round" />
      <text x="18" y="44" fontSize="6" fill={mode === 'V' ? '#fde047' : '#9ca3af'} fontWeight="bold">V</text>
      <text x="30" y="40" fontSize="6" fill={mode === 'mA' ? '#fde047' : '#9ca3af'} fontWeight="bold">mA</text>
      <text x="48" y="44" fontSize="6" fill={mode === 'ohm' ? '#fde047' : '#9ca3af'} fontWeight="bold">Ω</text>
      <circle cx="22" cy="80" r="5" fill="#111827" stroke="#6b7280" /><text x="22" y="72" textAnchor="middle" fontSize="5" fill="#d1d5db">COM</text>
      <circle cx="48" cy="80" r="5" fill="#dc2626" stroke="#7f1d1d" /><text x="48" y="72" textAnchor="middle" fontSize="5" fill="#d1d5db">{unit}</text>
    </>
  },
  logic_analyzer(state) {
    const recording = yes(state.recording)
    return <>
      <rect x="1" y="1" width="98" height="58" rx="4" fill="#1f2937" stroke="#030712" />
      <rect x="6" y="6" width="54" height="30" rx="2" fill="#030712" />
      {Array.from({ length: 4 }).map((_, row) => <path key={row} d={`M9 ${12 + row * 7} h8 v-3 h6 v3 h10 v-3 h4 v3 h14`} fill="none" stroke={['#fbbf24', '#f87171', '#fb923c', '#facc15'][row]} strokeWidth="1" />)}
      <text x="80" y="16" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#e5e7eb">LOGIC</text>
      <text x="80" y="25" textAnchor="middle" fontSize="5" fill="#9ca3af">8 CH</text>
      <circle cx="80" cy="33" r="3" fill={recording ? '#ef4444' : '#374151'} />
      <text x="50" y="47" textAnchor="middle" fontSize="5" fill="#9ca3af">{num(state.events, 0) > 0 ? `${num(state.events, 0)} perubahan` : 'belum ada rekaman'}</text>
      {Array.from({ length: 9 }).map((_, i) => <text key={i} x={10 + i * 10} y="54" textAnchor="middle" fontSize="4" fill="#d1d5db">{i < 8 ? `D${i}` : 'G'}</text>)}
    </>
  },
  relay(state, id) {
    return <ModuleBoard id={id} w={80} h={56} color="#1766a3"><rect x="8" y="7" width="42" height="31" rx="3" fill={yes(state.active) ? '#2b8bd0' : '#145487'} stroke="#0d3b62" /><text x="29" y="20" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">SRD-05VDC</text><text x="29" y="29" textAnchor="middle" fontSize="5" fill="#dbeafe">RELAY</text>{[0,1,2].map(i => <g key={i}><circle cx={60 + (i % 2) * 12} cy={12 + i * 12} r="5" fill="#d6d3d1" stroke="#57534e" /><circle cx={60 + (i % 2) * 12} cy={12 + i * 12} r="2" fill="#44403c" /></g>)}</ModuleBoard>
  },
  rfid(state, id) {
    return <ModuleBoard id={id} w={92} h={68} color="#1468a8"><rect x="8" y="7" width="76" height="46" rx="4" fill="none" stroke="#d8b13f" strokeWidth="3" />{Array.from({ length: 4 }).map((_, i) => <rect key={i} x={13 + i * 5} y={12 + i * 5} width={66 - i * 10} height={36 - i * 10} rx="3" fill="none" stroke="#d8b13f" />)}<rect x="34" y="19" width="24" height="17" fill="#1f2937" /><text x="46" y="60" textAnchor="middle" fontSize="6" fill="white" fontWeight="bold">RC522 {yes(state.cardPresent) ? 'CARD ✓' : 'READY'}</text></ModuleBoard>
  },
  led_matrix(state, id) {
    const pixels = Array.isArray(state.pixels) ? state.pixels as number[] : []
    const brightness = matrixBrightness(state)
    return <ModuleBoard id={id} w={82} h={76} color="#11705f"><rect x="8" y="5" width="66" height="56" rx="2" fill="#101827" />{Array.from({ length: 64 }).map((_, i) => <g key={i}>
      <circle cx={12 + (i % 8) * 8.2} cy={9 + Math.floor(i / 8) * 7} r="2.7" fill="#5b1717" />
      {pixels.includes(i) && brightness > 0 && <circle cx={12 + (i % 8) * 8.2} cy={9 + Math.floor(i / 8) * 7} r="2.7" fill="#ff3535" opacity={Math.sqrt(brightness)} />}
    </g>)}<text x="41" y="68" textAnchor="middle" fontSize="6" fill="white">MAX7219 8×8</text></ModuleBoard>
  },
}

const CUSTOM_SOURCE_SIZES: Partial<Record<ComponentType, { w: number; h: number }>> = {
  lm35: { w: 38, h: 50 },
  ds18b20: { w: 38, h: 50 },
  led_matrix4: { w: 300, h: 80 },
  water_sensor: { w: 74, h: 64 },
  relay: { w: 80, h: 56 },
  multimeter: { w: 70, h: 96 },
  logic_analyzer: { w: 100, h: 60 },
  rfid: { w: 92, h: 68 },
  led_matrix: { w: 82, h: 76 },
}

const custom = Object.fromEntries(
  (Object.keys(customBase) as ComponentType[]).map((type) => {
    const renderer = customBase[type]!
    const source = CUSTOM_SOURCE_SIZES[type]!
    const target = PHYSICAL_PART_SIZES[type]
    return [type, (state: Record<string, unknown>, uid: string) => (
      <g transform={`scale(${target.w / source.w} ${target.h / source.h})`}>
        {renderer(state, uid)}
      </g>
    )]
  }),
) as Partial<Record<ComponentType, PartRenderer>>

/**
 * Element-backed parts need no per-part numbers: tag and intrinsic size both
 * come from the same geometry table that placed their terminals.
 */
function ElementPart({ type, props = {} }: { type: ElementPartType; props?: Record<string, unknown> }) {
  const source = ELEMENT_GEOMETRY[ELEMENT_PART_SOURCE[type].geometry]
  const { w, h } = PHYSICAL_PART_SIZES[type]
  return <KodyElement tag={source.tag} w={w} h={h} sourceW={source.cssW} sourceH={source.cssH} props={props} />
}

const numbers = (value: unknown, length: number): number[] => {
  const list = Array.isArray(value) ? (value as number[]) : []
  return Array.from({ length }, (_, i) => Number(list[i] ?? 0))
}

const elementBacked: Partial<Record<ComponentType, PartRenderer>> = {
  ssd1306: (state) => {
    const { w, h } = PHYSICAL_PART_SIZES.ssd1306
    const source = ELEMENT_GEOMETRY[ELEMENT_PART_SOURCE.ssd1306.geometry]
    const scale = Math.min(w / source.cssW, h / source.cssH)
    const pixels = Array.isArray(state.framebuffer) ? state.framebuffer : []
    const lines = Array.isArray(state.lines) ? state.lines : []
    const textSize = Math.max(1, Math.min(8, num(state.textSize, 1)))
    const background = state.inverted ? '#d9f7ff' : '#080d12'
    const foreground = state.inverted ? '#080d12' : '#d9f7ff'
    const path = pixels.slice(0, 8192).flatMap((value, i) => value ? [`M${i % 128} ${Math.floor(i / 128)}h1v1h-1z`] : []).join('')
    return <><ElementPart type="ssd1306" /><svg x={(w - source.cssW * scale) / 2 + 11.5 * scale}
      y={(h - source.cssH * scale) / 2 + 27 * scale} width={128 * scale} height={64 * scale} viewBox="0 0 128 64" overflow="hidden">
      <rect width="128" height="64" fill={background} />
      <path d={path} fill={foreground} shapeRendering="crispEdges" />
      {lines.slice(0, 8).map((line, row) => <text key={row} x="0" y={(row + 1) * 8 * textSize - 1} fontFamily="monospace" fontSize={8 * textSize} fill={foreground} xmlSpace="preserve">{String(line)}</text>)}
      {state.dimmed === true && <rect width="128" height="64" fill="black" opacity=".65" />}
    </svg></>
  },
  lcd2004: (s) => (
    <ElementPart
      type="lcd2004"
      props={{ text: Array.isArray(s.lines) ? (s.lines as string[]).join(String.fromCharCode(10)) : '', pins: 'i2c', backlight: yes(s.backlight ?? true) }}
    />
  ),
  tft_ili9341: (s) => {
    const { w, h } = PHYSICAL_PART_SIZES.tft_ili9341
    return <><ElementPart type="tft_ili9341" /><foreignObject x={w * 0.04} y={h * 0.1} width={w * 0.91} height={h * 0.7}><TftScreen state={s} /></foreignObject></>
  },
  neopixel: (s) => <ElementPart type="neopixel" props={{ r: num(s.red) / 255, g: num(s.green) / 255, b: num(s.blue) / 255 }} />,
  neopixel_matrix: (s) => (
    <ElementPart type="neopixel_matrix" props={{ rows: num(s.rows, 8), cols: num(s.cols, 8), pixels: s.pixels ?? [] }} />
  ),
  led_bar: (s) => <ElementPart type="led_bar" props={{ values: numbers(s.values, 10), color: 'red' }} />,
  dht22: () => <ElementPart type="dht22" />,
  mpu6050: (s) => <ElementPart type="mpu6050" props={{ led1: yes(s.powered) }} />,
  ds1307: () => <ElementPart type="ds1307" />,
  hx711: () => <ElementPart type="hx711" props={{ type: '5kg' }} />,
  ntc_temp: () => <ElementPart type="ntc_temp" />,
  heart_sensor: () => <ElementPart type="heart_sensor" />,
  tilt_switch: () => <ElementPart type="tilt_switch" />,
  slide_switch: (s) => <ElementPart type="slide_switch" props={{ value: num(s.value) }} />,
  dip_switch: (s) => <ElementPart type="dip_switch" props={{ values: numbers(s.values, 8) }} />,
  microsd: () => <ElementPart type="microsd" />,
  servo: (s) => <ElementPart type="servo" props={{ angle: num(s.angle), horn: 'single' }} />,
  lcd: (s) => (
    <ElementPart
      type="lcd"
      props={{ text: Array.isArray(s.lines) ? (s.lines as string[]).join(String.fromCharCode(10)) : '', pins: 'i2c', backlight: yes(s.backlight ?? true) }}
    />
  ),
  // Wokwi ships one DHT visual (the DHT22/AM2302 blue case) covering both
  // DHT11 and DHT22 — same physical package, no on-device readout either way.
  dht11: () => <ElementPart type="dht11" />,
  ultrasonic: () => <ElementPart type="ultrasonic" />,
  pir: () => <ElementPart type="pir" />,
  potentiometer: (s) => <ElementPart type="potentiometer" props={{ value: num(s.value, 512) / 1023 }} />,
  ldr: () => <ElementPart type="ldr" />,
  sound_sensor: () => <ElementPart type="sound_sensor" />,
  gas_sensor: () => <ElementPart type="gas_sensor" />,
  flame_sensor: () => <ElementPart type="flame_sensor" />,
  joystick: (s) => <ElementPart type="joystick" props={{ xValue: num(s.x, 512) / 1023, yValue: num(s.y, 512) / 1023 }} />,
  ir_receiver: () => <ElementPart type="ir_receiver" />,
  rotary_encoder: () => <ElementPart type="rotary_encoder" />,
  // `connector` must be true — without it the element draws no ribbon/pin
  // strip at all, and our terminal dots (positioned against the connector
  // artwork) would float over nothing. See elementParts.ts comment.
  keypad: () => <ElementPart type="keypad" props={{ connector: true }} />,
  seven_segment: (s) => <ElementPart type="seven_segment" props={{ values: Array.isArray(s.segments) ? numbers(s.segments, 8) : sevenSegmentValues(num(s.value, 0)) }} />,
  stepper: (s) => <ElementPart type="stepper" props={{ angle: num(s.angle) }} />,
}

export const REALISTIC_RENDERERS: Partial<Record<ComponentType, PartRenderer>> = {
  led: (s) => <KodyPart type="led" tag="kody-led" sourceW={40} sourceH={50} props={{ value: yes(s.on), brightness: num(s.brightness, 1), color: s.color ?? 'red' }} />,
  resistor: (s) => <KodyPart type="resistor" tag="kody-resistor" sourceW={59.13} sourceH={11.34} props={{ value: String(num(s.value, 220)) }} />,
  buzzer: () => <KodyPart type="buzzer" tag="kody-buzzer" sourceW={75} sourceH={84} />,
  rgb_led: (s) => <KodyPart type="rgb_led" tag="kody-rgb-led" sourceW={42.129} sourceH={72.582} props={{ r: num(s.red), g: num(s.green), b: num(s.blue) }} />,
  pushbutton: (s) => <KodyPart type="pushbutton" tag="kody-pushbutton" sourceW={67.28} sourceH={45.35} props={{ pressed: yes(s.pressed), color: 'red' }} />,
  ...custom,
  ...elementBacked,
}
