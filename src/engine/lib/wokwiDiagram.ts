// Wokwi diagram.json ⇄ KodyUno project, so a circuit can move between the
// two simulators. Scope: an Arduino Uno, parts, jumpers and one breadboard.
// Breadboard holes map by row letter and column (Wokwi's half breadboard has
// 30 columns, ours 24: a circuit is shifted left to fit when it can be).
// Parts pushed into the breadboard (`$bb` connections) are plugged into the
// same holes when their legs line up, otherwise joined with short jumpers.

import type { BoardComponent, ComponentType, NodeRef, Wire } from '@kodyuno/types'
import { COMPONENT_CATALOG } from './componentCatalog'
import { COMPONENT_DEFS } from './interpreter/components'
import { BB_COLS, breadboardHoles, HOLE_SNAP_RADIUS, nearestBBHole } from './breadboard'
import { PART_SPECS, rotatedTerminal } from './partSpecs'

/** KodyUno world units are 14 per 0.1"; Wokwi uses CSS px (9.6 per 0.1"). */
export const WOKWI_TO_WORLD = 14 / 9.6

interface PartMap {
  wokwi: string
  /** KodyUno terminal role → Wokwi pin name. */
  pins: Record<string, string>
  toAttrs?: (state: Record<string, unknown>) => Record<string, string>
  fromAttrs?: (attrs: Record<string, unknown>) => Record<string, unknown>
}

const upper = (roles: string[]) => Object.fromEntries(roles.map(role => [role, role.toUpperCase()]))

const PART_MAP: Partial<Record<ComponentType, PartMap>> = {
  led: {
    wokwi: 'wokwi-led', pins: { anode: 'A', cathode: 'C' },
    toAttrs: s => ({ color: String(s.color ?? 'red') }),
    fromAttrs: a => (typeof a.color === 'string' ? { color: a.color } : {}),
  },
  resistor: {
    wokwi: 'wokwi-resistor', pins: { t1: '1', t2: '2' },
    toAttrs: s => ({ value: String(typeof s.value === 'number' ? s.value : 220) }),
    fromAttrs: a => {
      const raw = String(a.value ?? '220').trim().toLowerCase()
      const n = parseFloat(raw) * (raw.endsWith('k') ? 1000 : raw.endsWith('m') ? 1_000_000 : 1)
      return Number.isFinite(n) && n > 0 ? { value: n } : {}
    },
  },
  pushbutton: { wokwi: 'wokwi-pushbutton', pins: { signal: '1.l', gnd: '2.l' } },
  servo: { wokwi: 'wokwi-servo', pins: { gnd: 'GND', vcc: 'V+', signal: 'PWM' } },
  ultrasonic: { wokwi: 'wokwi-hc-sr04', pins: upper(['vcc', 'trig', 'echo', 'gnd']) },
  dht22: { wokwi: 'wokwi-dht22', pins: { vcc: 'VCC', data: 'SDA', nc: 'NC', gnd: 'GND' } },
  potentiometer: { wokwi: 'wokwi-potentiometer', pins: { gnd: 'GND', signal: 'SIG', vcc: 'VCC' } },
  buzzer: { wokwi: 'wokwi-buzzer', pins: { gnd: '1', signal: '2' } },
  rgb_led: { wokwi: 'wokwi-rgb-led', pins: { red: 'R', common: 'COM', green: 'G', blue: 'B' } },
  lcd: { wokwi: 'wokwi-lcd1602', pins: upper(['gnd', 'vcc', 'sda', 'scl']), toAttrs: () => ({ pins: 'i2c' }) },
  lcd2004: { wokwi: 'wokwi-lcd2004', pins: upper(['gnd', 'vcc', 'sda', 'scl']), toAttrs: () => ({ pins: 'i2c' }) },
  neopixel: { wokwi: 'wokwi-neopixel', pins: { vcc: 'VDD', dout: 'DOUT', gnd: 'VSS', din: 'DIN' } },
  pir: { wokwi: 'wokwi-pir-motion-sensor', pins: upper(['vcc', 'out', 'gnd']) },
  ldr: { wokwi: 'wokwi-photoresistor-sensor', pins: { vcc: 'VCC', gnd: 'GND', do: 'DO', signal: 'AO' } },
  slide_switch: { wokwi: 'wokwi-slide-switch', pins: { 1: '1', 2: '2', 3: '3' } },
  ds18b20: { wokwi: 'wokwi-ds18b20', pins: { gnd: 'GND', data: 'DQ', vcc: 'VCC' } },
  ntc_temp: { wokwi: 'wokwi-ntc-temperature-sensor', pins: { gnd: 'GND', vcc: 'VCC', signal: 'OUT' } },
  relay: { wokwi: 'wokwi-relay-module', pins: { in: 'IN', vcc: 'VCC', gnd: 'GND', com: 'COM', no: 'NO' } },
  joystick: { wokwi: 'wokwi-analog-joystick', pins: { vcc: 'VCC', vrx: 'HORZ', vry: 'VERT', sw: 'SEL', gnd: 'GND' } },
  keypad: { wokwi: 'wokwi-membrane-keypad', pins: upper(['r1', 'r2', 'r3', 'r4', 'c1', 'c2', 'c3', 'c4']) },
  ir_receiver: { wokwi: 'wokwi-ir-receiver', pins: { gnd: 'GND', vcc: 'VCC', out: 'DAT' } },
  mpu6050: { wokwi: 'wokwi-mpu6050', pins: upper(['int', 'ad0', 'xcl', 'xda', 'sda', 'scl', 'gnd', 'vcc']) },
  ds1307: { wokwi: 'wokwi-ds1307', pins: upper(['gnd', 'vcc', 'sda', 'scl', 'sqw']) },
  hx711: { wokwi: 'wokwi-hx711', pins: { gnd: 'GND', dt: 'DT', sck: 'SCK', vcc: 'VCC' } },
  logic_analyzer: { wokwi: 'wokwi-logic-analyzer', pins: { ...upper(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']), gnd: 'GND' } },
  tilt_switch: { wokwi: 'wokwi-tilt-switch', pins: { gnd: 'GND', vcc: 'VCC', signal: 'OUT' } },
}

const WOKWI_TO_TYPE = new Map<string, ComponentType>(
  (Object.entries(PART_MAP) as Array<[ComponentType, PartMap]>).map(([type, map]) => [map.wokwi, type]))

/** KodyUno Uno header id ⇄ Wokwi Uno pin name. */
function unoPinToWokwi(pin: number | string): string {
  const id = String(pin)
  if (id === 'GND3') return 'GND.1'
  if (id === 'GND') return 'GND.2'
  if (id === 'GND2') return 'GND.3'
  if (id === '3V3') return '3.3V'
  return id
}
function wokwiToUnoPin(name: string): number | string {
  if (/^GND(\.\d)?$/.test(name)) return ({ 'GND.1': 'GND3', 'GND.2': 'GND', 'GND.3': 'GND2' } as Record<string, string>)[name] ?? 'GND'
  if (name === '3.3V') return '3V3'
  if (/^\d+$/.test(name)) return Number(name)
  return name
}

export interface WokwiDiagram {
  version: number
  author?: string
  editor?: string
  parts: Array<{ type: string; id: string; top: number; left: number; rotate?: number; attrs?: Record<string, unknown> }>
  connections: Array<[string, string, string, string[]?]>
  dependencies?: Record<string, unknown>
}

const RAIL_TO_WOKWI: Record<string, string> = { tp: 'tp', tm: 'tn', bm: 'bn', bp: 'bp' }
const WOKWI_TO_RAIL: Record<string, string> = { tp: 'tp', tn: 'tm', bn: 'bm', bp: 'bp' }

/** Our hole id ("row:col") → Wokwi breadboard pin ("12t.a", "tn.3"). */
export function holeToWokwi(hole: string): string | null {
  const [row, colText] = hole.split(':')
  const col = Number(colText)
  if (!Number.isInteger(col) || col < 0 || col >= BB_COLS) return null
  if (RAIL_TO_WOKWI[row]) return `${RAIL_TO_WOKWI[row]}.${Math.floor(col / 6) * 5 + (col % 6) + 1}`
  if ('abcde'.includes(row) && row.length === 1) return `${col + 1}t.${row}`
  if ('fghij'.includes(row) && row.length === 1) return `${col + 1}b.${row}`
  return null
}

/** Wokwi breadboard pin → our hole id, with main-area columns shifted by `shift`. */
export function wokwiToHole(pin: string, shift = 0): string | null {
  const main = /^(\d+)([tb])\.([a-j])$/.exec(pin)
  if (main) {
    const col = Number(main[1]) - 1 - shift, row = main[3]
    if (col < 0 || col >= BB_COLS || (main[2] === 't') !== 'abcde'.includes(row)) return null
    return `${row}:${col}`
  }
  const rail = /^(tp|tn|bp|bn)\.(\d+)$/.exec(pin)
  // A rail is one conductor end to end, so any of its holes is the same node.
  if (rail) return `${WOKWI_TO_RAIL[rail[1]]}:0`
  return null
}

const COLOR_NAMES: Record<string, string> = {
  red: '#dc2626', black: '#1e293b', green: '#16a34a', blue: '#2563eb', yellow: '#eab308', orange: '#f97316',
  white: '#f8fafc', gray: '#6b7280', grey: '#6b7280', purple: '#9333ea', violet: '#7c3aed', cyan: '#06b6d4',
  brown: '#92400e', gold: '#ca8a04', magenta: '#db2777', limegreen: '#65a30d',
}
function colorToHex(color: string): string {
  if (/^#[\da-f]{6}$/i.test(color)) return color
  return COLOR_NAMES[color.toLowerCase()] ?? '#16a34a'
}
function hexToColor(hex: string): string {
  const match = Object.entries(COLOR_NAMES).find(([, value]) => value.toLowerCase() === hex.toLowerCase())
  return match ? match[0] : hex
}

export function exportWokwiDiagram(state: {
  components: BoardComponent[]; wires: Wire[]; boardOrigin: { x: number; y: number }
}): { diagram: WokwiDiagram; warnings: string[] } {
  const warnings: string[] = []
  const ids = new Map<string, string>()
  const parts: WokwiDiagram['parts'] = [{ type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0, attrs: {} }]
  const counters: Record<string, number> = {}
  for (const comp of state.components) {
    const map = PART_MAP[comp.type]
    if (!map) { warnings.push(`${comp.label}: belum ada padanan di Wokwi, dilewati.`); continue }
    const base = map.wokwi.replace(/^wokwi-/, '').replace(/[^a-z0-9]/g, '')
    counters[base] = (counters[base] ?? 0) + 1
    const id = `${base}${counters[base]}`
    ids.set(comp.id, id)
    const pos = comp.pos ?? state.boardOrigin
    parts.push({
      type: map.wokwi, id,
      top: Math.round((pos.y - state.boardOrigin.y) / WOKWI_TO_WORLD),
      left: Math.round((pos.x - state.boardOrigin.x) / WOKWI_TO_WORLD),
      ...(comp.rot ? { rotate: comp.rot } : {}),
      attrs: map.toAttrs?.(comp.state) ?? {},
    })
  }
  const holes = breadboardHoles()
  const first = holes.find(hole => hole.id === 'tp:0') ?? holes[0]
  // Wokwi's half breadboard: first top-rail hole sits ~(15, 11) px from its corner.
  parts.push({ type: 'wokwi-breadboard-half', id: 'bb1',
    top: Math.round((first.y - state.boardOrigin.y) / WOKWI_TO_WORLD - 11), left: Math.round((first.x - state.boardOrigin.x) / WOKWI_TO_WORLD - 15), attrs: {} })
  const endpoint = (ref: NodeRef): string | null => {
    if (ref.type === 'hole') { const pin = holeToWokwi(ref.hole); return pin ? `bb1:${pin}` : null }
    if (ref.type === 'pin') return `uno:${unoPinToWokwi(ref.pin)}`
    if (ref.type === 'term') {
      const comp = state.components.find(c => c.id === ref.comp)
      const pin = comp && PART_MAP[comp.type]?.pins[ref.role]
      const id = ids.get(ref.comp)
      return pin && id ? `${id}:${pin}` : null
    }
    return null
  }
  const connections: WokwiDiagram['connections'] = []
  let skippedHoles = 0
  for (const wire of state.wires) {
    const a = endpoint(wire.a), b = endpoint(wire.b)
    if (!a || !b) { if (wire.a.type === 'hole' || wire.b.type === 'hole') skippedHoles++; continue }
    connections.push([a, b, hexToColor(wire.color), []])
  }
  if (skippedHoles) warnings.push(`${skippedHoles} kabel ke breadboard tidak ikut diekspor.`)
  // Legs pushed into breadboard holes become Wokwi's `$bb` connections.
  for (const comp of state.components) {
    const spec = PART_SPECS[comp.type], id = ids.get(comp.id), map = PART_MAP[comp.type]
    if (!spec?.pluggable || !id || !map || !comp.pos) continue
    for (const terminal of spec.terminals) {
      if (!terminal.leg || !map.pins[terminal.role]) continue
      const offset = rotatedTerminal(spec, terminal, comp.rot)
      const hole = nearestBBHole(comp.pos.x + offset.dx, comp.pos.y + offset.dy, HOLE_SNAP_RADIUS)
      const pin = hole && holeToWokwi(hole.id)
      if (pin) connections.push([`${id}:${map.pins[terminal.role]}`, `bb1:${pin}`, '', ['$bb']])
    }
  }
  return { diagram: { version: 1, author: 'KodyUno', editor: 'wokwi', parts, connections, dependencies: {} }, warnings }
}

export function importWokwiDiagram(input: unknown, boardOrigin: { x: number; y: number }): {
  components: BoardComponent[]; wires: Wire[]; warnings: string[]
} {
  const diagram = input as WokwiDiagram
  if (!diagram || typeof diagram !== 'object' || !Array.isArray(diagram.parts) || !Array.isArray(diagram.connections)) {
    throw new Error('Bukan file diagram.json Wokwi.')
  }
  const warnings: string[] = []
  const board = diagram.parts.find(p => p.type === 'wokwi-arduino-uno')
  if (!board) warnings.push('Tidak ada Arduino Uno di diagram; posisi dan sambungan ke board mungkin tidak lengkap.')
  const origin = { top: board?.top ?? 0, left: board?.left ?? 0 }
  const components: BoardComponent[] = []
  const byWokwiId = new Map<string, BoardComponent>()
  for (const part of diagram.parts) {
    if (part === board) continue
    const type = WOKWI_TO_TYPE.get(part.type)
    if (!type) {
      if (!/breadboard/.test(part.type)) warnings.push(`${part.id} (${part.type}) belum didukung KodyUno, dilewati.`)
      continue
    }
    const catalog = COMPONENT_CATALOG.find(item => item.type === type)
    const def = COMPONENT_DEFS[type]
    const comp: BoardComponent = {
      id: `${type}-${part.id}`.replace(/[^\w-]/g, '_'),
      type,
      label: catalog?.label ?? part.id,
      pins: [],
      pos: {
        x: boardOrigin.x + (Number(part.left) - origin.left) * WOKWI_TO_WORLD,
        y: boardOrigin.y + (Number(part.top) - origin.top) * WOKWI_TO_WORLD,
      },
      ...(part.rotate && [90, 180, 270].includes(Number(part.rotate)) ? { rot: Number(part.rotate) as 90 | 180 | 270 } : {}),
      state: { ...(def ? def.makeState() : {}), ...(PART_MAP[type]?.fromAttrs?.(part.attrs ?? {}) ?? {}) },
    }
    components.push(comp)
    byWokwiId.set(part.id, comp)
  }
  const breadboard = diagram.parts.find(p => /^wokwi-breadboard(-half)?$/.test(p.type))
  if (diagram.parts.filter(p => /breadboard/.test(p.type)).length > 1) warnings.push('Hanya satu breadboard yang dipakai; sambungan ke breadboard lain dilewati.')
  // Shift the used columns left when they would run past our 24 columns.
  const usedColumns = diagram.connections.flatMap(([from, to]) => [String(from), String(to)])
    .filter(name => breadboard && name.startsWith(`${breadboard.id}:`))
    .map(name => /^(\d+)[tb]\./.exec(name.slice(breadboard!.id.length + 1))?.[1]).filter(Boolean).map(Number)
  const shift = usedColumns.length && Math.max(...usedColumns) > BB_COLS ? Math.min(...usedColumns) - 1 : 0
  let outside = 0
  const endpoint = (name: string): NodeRef | null => {
    const colon = name.indexOf(':')
    if (colon < 0) return null
    const partId = name.slice(0, colon), pin = name.slice(colon + 1)
    if (breadboard && partId === breadboard.id) {
      const hole = wokwiToHole(pin, shift)
      if (!hole) outside++
      return hole ? { type: 'hole', hole } : null
    }
    if (board && partId === board.id) return { type: 'pin', pin: wokwiToUnoPin(pin) }
    const comp = byWokwiId.get(partId)
    if (!comp) return null
    const map = PART_MAP[comp.type]!
    const alias = pin.replace(/\.r$/, '.l') // pushbutton: left and right legs are the same contact
    const role = Object.entries(map.pins).find(([, wokwiPin]) => wokwiPin === pin || wokwiPin === alias)?.[0]
    return role ? { type: 'term', comp: comp.id, role } : null
  }
  const wires: Wire[] = []
  let skipped = 0
  const resolved: Array<{ a: NodeRef; b: NodeRef; color: string }> = []
  for (const [from, to, color] of diagram.connections) {
    const a = endpoint(String(from)), b = endpoint(String(to))
    if (!a || !b) { skipped++; continue }
    resolved.push({ a, b, color: colorToHex(String(color || 'green')) })
  }
  // Plug parts whose legs all landed in holes: place the part so the legs sit
  // in those holes (same 0.1" pitch in both simulators) and drop the jumpers.
  const holes = breadboardHoles()
  const legsOf = new Map<string, Map<string, string>>()
  for (const { a, b } of resolved) {
    const [term, hole] = a.type === 'term' && b.type === 'hole' ? [a, b] : b.type === 'term' && a.type === 'hole' ? [b, a] : [null, null]
    if (!term || !hole) continue
    if (!legsOf.has(term.comp)) legsOf.set(term.comp, new Map())
    legsOf.get(term.comp)!.set(term.role, hole.hole)
  }
  // A leg counts as plugged when it lands in a hole on the same strip as its
  // Wokwi hole. Legs that land nowhere keep a short jumper; a placement that
  // would put any leg on a different strip is rejected (it would short nets).
  const netOf = new Map(holes.map(h => [h.id, h.net]))
  const pluggedLegs = new Set<string>()
  for (const comp of components) {
    const spec = PART_SPECS[comp.type], legs = legsOf.get(comp.id)
    const legTerminals = spec?.pluggable ? spec.terminals.filter(t => t.leg && legs?.has(t.role)) : []
    if (!legs || !legTerminals.length) continue
    let best: { pos: { x: number; y: number }; roles: string[] } | null = null
    for (const anchorLeg of legTerminals) {
      const anchor = holes.find(h => h.id === legs.get(anchorLeg.role))
      if (!anchor) continue
      const offset = rotatedTerminal(spec, anchorLeg, comp.rot)
      const pos = { x: anchor.x - offset.dx, y: anchor.y - offset.dy }
      const roles: string[] = []
      const safe = spec.terminals.filter(t => t.leg).every(t => {
        const o = rotatedTerminal(spec, t, comp.rot)
        const landed = nearestBBHole(pos.x + o.dx, pos.y + o.dy, HOLE_SNAP_RADIUS)
        if (!landed) return true
        const wanted = legs.get(t.role)
        if (!wanted || netOf.get(wanted) !== landed.net) return false
        roles.push(t.role)
        return true
      })
      if (safe && (!best || roles.length > best.roles.length)) best = { pos, roles }
    }
    if (!best) continue
    comp.pos = best.pos
    for (const role of best.roles) pluggedLegs.add(`${comp.id}|${role}`)
  }
  for (const { a, b, color } of resolved) {
    const term = a.type === 'term' ? a : b.type === 'term' ? b : null
    if (term && pluggedLegs.has(`${term.comp}|${term.role}`) && (a.type === 'hole' || b.type === 'hole')) continue
    wires.push({ id: crypto.randomUUID(), a, b, color })
  }
  if (outside) warnings.push(`${outside} titik breadboard di luar 24 kolom breadboard KodyUno, dilewati.`)
  if (skipped - outside > 0) warnings.push(`${skipped - outside} sambungan dilewati (komponen yang belum didukung).`)
  return { components, wires, warnings }
}
