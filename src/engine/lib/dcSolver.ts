// ============================================================
// KodyUno — DC operating point (like Tinkercad's circuit solver)
//
// circuitSolver.ts decides which terminals share a net. This module puts
// numbers on those nets: node voltages and branch currents from modified
// nodal analysis, with LEDs as piecewise-linear diodes solved iteratively.
//
// Sources: GND (0V), the board's power rails, and output pins (a HIGH/LOW
// level or a PWM average behind the pin's ~25Ω output resistance).
// Elements: resistors, LEDs (single and RGB), potentiometers, buzzers, and
// the multimeter itself.
// ============================================================

import type { BoardComponent, PinState } from '@kodyuno/types'
import { termKey, pinKey } from './circuitSolver'
import { activeBoard, gndIdSet, powerRailPins } from './boardGeometry'

/** Output resistance of an AVR/ESP GPIO driver, roughly. */
const PIN_OUTPUT_OHMS = 25
/** Keeps floating nets solvable; far too small to show on a meter. */
const LEAK_SIEMENS = 1e-9
const LED_SERIES_OHMS = 10
const POT_TOTAL_OHMS = 10_000
const BUZZER_OHMS = 200
const AMMETER_OHMS = 0.1

/** LED forward voltage by colour, as in common 5mm parts. */
export function ledForwardVolts(color: unknown): number {
  const c = String(color ?? '').toLowerCase()
  if (/blue|biru|white|putih|#(3b82f6|60a5fa|2563eb|ffffff|f8fafc)/.test(c)) return 3.0
  if (/green|hijau|#(22c55e|16a34a|4ade80)/.test(c)) return 2.1
  if (/yellow|kuning|amber|orange|#(f59e0b|eab308|facc15|f97316)/.test(c)) return 2.0
  return 1.8 // red and anything unknown
}

export type MeterMode = 'V' | 'mA' | 'ohm'

export interface DcInput {
  components: BoardComponent[]
  /** Node key → net root, from solveCircuit(). */
  netOf: Record<string, string>
  pins: PinState[]
  /** Board logic level for a HIGH output (5 on AVR, 3.3 on ESP). */
  logicVolts: number
  /** Header pins that are power rails, with their voltage. */
  rails: Array<{ pin: string; volts: number }>
  /** Header pins that are ground. */
  grounds: string[]
}

export interface DcSolution {
  /** Net root → volts (only nets that take part in the circuit). */
  netVolts: Record<string, number>
  /** Component id → current through it in amps (LED/resistor/buzzer). */
  current: Record<string, number>
  /** Multimeter id → reading in its mode's unit; null means "OL" (open / out of range). */
  meter: Record<string, number | null>
}

interface Branch { a: string; b: string; g: number }
interface Diode { id: string; anode: string; cathode: string; vf: number }

function gaussSolve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row
    if (Math.abs(matrix[pivot][col]) < 1e-18) return null
    ;[matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]]
    ;[rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]]
    for (let row = col + 1; row < n; row++) {
      const factor = matrix[row][col] / matrix[col][col]
      if (!factor) continue
      for (let k = col; k < n; k++) matrix[row][k] -= factor * matrix[col][k]
      rhs[row] -= factor * rhs[col]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row]
    for (let k = row + 1; k < n; k++) sum -= matrix[row][k] * x[k]
    x[row] = sum / matrix[row][row]
  }
  return x
}

/**
 * Solve one network. `fixed` pins net voltages; `sources` are Norton current
 * injections (net, amps); branches and conducting diodes are conductances.
 */
function solveNetwork(nets: string[], fixed: Map<string, number>, branches: Branch[], sources: Array<[string, number]>,
  diodes: Diode[], diodeOn: Set<string>): Map<string, number> | null {
  const unknown = nets.filter(net => !fixed.has(net))
  const index = new Map(unknown.map((net, i) => [net, i]))
  const n = unknown.length
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const rhs = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) matrix[i][i] += LEAK_SIEMENS
  const stamp = (a: string, b: string, g: number) => {
    const ia = index.get(a), ib = index.get(b)
    if (ia !== undefined) { matrix[ia][ia] += g; if (ib !== undefined) matrix[ia][ib] -= g; else rhs[ia] += g * (fixed.get(b) ?? 0) }
    if (ib !== undefined) { matrix[ib][ib] += g; if (ia !== undefined) matrix[ib][ia] -= g; else rhs[ib] += g * (fixed.get(a) ?? 0) }
  }
  for (const { a, b, g } of branches) if (a !== b) stamp(a, b, g)
  for (const [net, amps] of sources) { const i = index.get(net); if (i !== undefined) rhs[i] += amps }
  // A conducting diode is Vf in series with LED_SERIES_OHMS:
  // I = g·(Va − Vc − Vf), i.e. a conductance g plus a constant g·Vf that
  // flows back into the anode node and out of the cathode node.
  for (const d of diodes) {
    if (!diodeOn.has(d.id) || d.anode === d.cathode) continue
    const g = 1 / LED_SERIES_OHMS
    stamp(d.anode, d.cathode, g)
    const ia = index.get(d.anode), ic = index.get(d.cathode)
    if (ia !== undefined) rhs[ia] += g * d.vf
    if (ic !== undefined) rhs[ic] -= g * d.vf
  }
  const x = n ? gaussSolve(matrix, rhs) : []
  if (!x) return null
  const volts = new Map(fixed)
  unknown.forEach((net, i) => volts.set(net, x[i]))
  return volts
}

export function solveDc(input: DcInput, meters: Array<{ id: string; mode: MeterMode }> = []): DcSolution {
  const net = (key: string) => input.netOf[key] ?? key
  const term = (comp: string, role: string) => net(termKey(comp, role))
  const nets = new Set<string>()
  const branches: Branch[] = []
  const diodes: Diode[] = []
  const add = (...keys: string[]) => keys.forEach(k => nets.add(k))

  for (const comp of input.components) {
    if (comp.type === 'resistor') {
      const r = typeof comp.state.value === 'number' && comp.state.value > 0 ? comp.state.value : 220
      const a = term(comp.id, 't1'), b = term(comp.id, 't2'); add(a, b)
      branches.push({ a, b, g: 1 / r })
    } else if (comp.type === 'led' && !comp.state.burned) {
      const anode = term(comp.id, 'anode'), cathode = term(comp.id, 'cathode'); add(anode, cathode)
      diodes.push({ id: comp.id, anode, cathode, vf: ledForwardVolts(comp.state.color) })
    } else if (comp.type === 'rgb_led') {
      const common = term(comp.id, 'common')
      for (const [role, vf] of [['red', 1.8], ['green', 2.1], ['blue', 3.0]] as const) {
        const anode = term(comp.id, role); add(anode, common)
        diodes.push({ id: `${comp.id}:${role}`, anode, cathode: common, vf })
      }
    } else if (comp.type === 'potentiometer') {
      const f = Math.max(0, Math.min(1, Number(comp.state.value ?? 512) / 1023))
      const vcc = term(comp.id, 'vcc'), wiper = term(comp.id, 'signal'), gnd = term(comp.id, 'gnd'); add(vcc, wiper, gnd)
      branches.push({ a: vcc, b: wiper, g: 1 / Math.max(1, POT_TOTAL_OHMS * (1 - f)) })
      branches.push({ a: wiper, b: gnd, g: 1 / Math.max(1, POT_TOTAL_OHMS * f) })
    } else if (comp.type === 'buzzer') {
      const a = term(comp.id, 'signal'), b = term(comp.id, 'gnd'); add(a, b)
      branches.push({ a, b, g: 1 / BUZZER_OHMS })
    } else if (comp.type === 'multimeter') {
      add(term(comp.id, 'v'), term(comp.id, 'com'))
    }
  }

  const fixed = new Map<string, number>()
  for (const g of input.grounds) fixed.set(net(pinKey(g)), 0)
  for (const rail of input.rails) if (!fixed.has(net(pinKey(rail.pin)))) fixed.set(net(pinKey(rail.pin)), rail.volts)
  const sources: Array<[string, number]> = []
  for (const pin of input.pins) {
    if (pin.mode !== 'OUTPUT') continue
    const node = net(pinKey(pin.pin))
    if (!nets.has(node) || fixed.has(node)) continue
    const volts = pin.pwm > 0 ? input.logicVolts * Math.min(255, pin.pwm) / 255 : pin.value ? input.logicVolts : 0
    branches.push({ a: node, b: '__gnd_ref', g: 1 / PIN_OUTPUT_OHMS })
    sources.push([node, volts / PIN_OUTPUT_OHMS])
  }
  fixed.set('__gnd_ref', 0)
  for (const f of fixed.keys()) nets.add(f)

  const ammeters = meters.filter(m => m.mode === 'mA')
  for (const m of ammeters) branches.push({ a: term(m.id, 'v'), b: term(m.id, 'com'), g: 1 / AMMETER_OHMS })

  // Diode states: start off, switch on where forward-biased beyond Vf,
  // off where a conducting diode would carry reverse current. Converges in
  // a few rounds for the circuits children build.
  const netList = [...nets]
  let diodeOn = new Set<string>()
  let volts = solveNetwork(netList, fixed, branches, sources, diodes, diodeOn)
  for (let round = 0; volts && round < 25; round++) {
    const next = new Set<string>()
    for (const d of diodes) {
      const vd = (volts.get(d.anode) ?? 0) - (volts.get(d.cathode) ?? 0)
      if (diodeOn.has(d.id) ? vd > d.vf : vd > d.vf + 1e-6) next.add(d.id)
    }
    if (next.size === diodeOn.size && [...next].every(id => diodeOn.has(id))) break
    diodeOn = next
    volts = solveNetwork(netList, fixed, branches, sources, diodes, diodeOn)
  }

  const solution: DcSolution = { netVolts: {}, current: {}, meter: {} }
  if (!volts) return solution
  for (const [key, v] of volts) if (!key.startsWith('__')) solution.netVolts[key] = v
  const v = (node: string) => volts!.get(node) ?? 0
  for (const comp of input.components) {
    if (comp.type === 'resistor') solution.current[comp.id] = (v(term(comp.id, 't1')) - v(term(comp.id, 't2'))) * (1 / (typeof comp.state.value === 'number' && comp.state.value > 0 ? comp.state.value : 220))
    else if (comp.type === 'buzzer') solution.current[comp.id] = (v(term(comp.id, 'signal')) - v(term(comp.id, 'gnd'))) / BUZZER_OHMS
  }
  for (const d of diodes) {
    solution.current[d.id] = diodeOn.has(d.id) ? Math.max(0, (v(d.anode) - v(d.cathode) - d.vf) / LED_SERIES_OHMS) : 0
  }
  for (const m of meters) {
    const plus = term(m.id, 'v'), minus = term(m.id, 'com')
    if (m.mode === 'V') solution.meter[m.id] = plus === minus ? 0 : v(plus) - v(minus)
    else if (m.mode === 'mA') solution.meter[m.id] = ((v(plus) - v(minus)) / AMMETER_OHMS) * 1000
    else solution.meter[m.id] = measureResistance(netList, branches.filter(b => b.b !== '__gnd_ref' && b.a !== '__gnd_ref'), plus, minus)
  }
  return solution
}

/**
 * Ohmmeter: power removed (rails, pins and ground float), 1mA pushed from
 * the red probe to the black one, R = V / I. Diodes stay off, as a meter's
 * small test voltage would mostly leave an LED dark in either direction.
 */
function measureResistance(nets: string[], branches: Branch[], plus: string, minus: string): number | null {
  if (plus === minus) return 0
  const volts = solveNetwork(nets.filter(n => !n.startsWith('__')), new Map([[minus, 0]]), branches, [[plus, 0.001]], [], new Set())
  if (!volts) return null
  const ohms = (volts.get(plus) ?? 0) / 0.001
  return ohms > 20_000_000 ? null : ohms
}

/** DC input for the board currently on the canvas. */
export function dcInputForActiveBoard(components: BoardComponent[], netOf: Record<string, string>, pins: PinState[]): DcInput {
  return {
    components, netOf, pins,
    logicVolts: activeBoard().logicVolts,
    rails: powerRailPins().map(pin => ({ pin: String(pin.id), volts: pin.volts! })),
    grounds: [...gndIdSet()],
  }
}

/** Live multimeter readings, keyed by component id (null = "OL"). */
export function multimeterReadings(components: BoardComponent[], netOf: Record<string, string>, pins: PinState[]): Record<string, number | null> {
  const meters = components.filter(c => c.type === 'multimeter')
    .map(c => ({ id: c.id, mode: (c.state.mode === 'mA' || c.state.mode === 'ohm' ? c.state.mode : 'V') as MeterMode }))
  if (!meters.length) return {}
  return solveDc(dcInputForActiveBoard(components, netOf, pins), meters).meter
}

/** Current at which a 5mm LED looks fully bright. */
const LED_FULL_AMPS = 0.015

/** Perceived brightness 0..1 from LED current (eyes respond roughly to √I). */
export function ledBrightnessFromCurrent(amps: number): number {
  if (!(amps > 0.00005)) return 0
  return Math.min(1, Math.sqrt(amps / LED_FULL_AMPS))
}

/**
 * LED appearance from the DC operating point, like Tinkercad: brightness
 * follows the actual current, so the resistor value, supply rail and LED
 * colour all matter, and an LED fed straight from 5V through a resistor
 * lights even without any code. PWM pins contribute their average current.
 */
export function ledAppearance(components: BoardComponent[], netOf: Record<string, string>, pins: PinState[]): Record<string, Record<string, unknown>> {
  if (!components.some(c => c.type === 'led' || c.type === 'rgb_led')) return {}
  const dc = solveDc(dcInputForActiveBoard(components, netOf, pins))
  const looks: Record<string, Record<string, unknown>> = {}
  for (const comp of components) {
    if (comp.type === 'led' && !comp.state.burned) {
      const brightness = ledBrightnessFromCurrent(dc.current[comp.id] ?? 0)
      looks[comp.id] = { on: brightness > 0, brightness }
    } else if (comp.type === 'rgb_led') {
      const level = (role: string) => Math.round(255 * ledBrightnessFromCurrent(dc.current[`${comp.id}:${role}`] ?? 0))
      looks[comp.id] = { red: level('red'), green: level('green'), blue: level('blue') }
    }
  }
  return looks
}
