// ============================================================
// KodyUno — Circuit Net Solver
//
// Models the wiring as electrical nets (like Tinkercad):
//  - nodes: Arduino header pins, breadboard nets, component terminals
//  - wires and plugged-in legs merge nodes into nets (union-find)
//  - resistors are weighted edges BETWEEN nets
//
// For each component it answers:
//  - which Arduino pin (or 5V/3V3) drives its signal terminal, and
//    through how much series resistance
//  - whether its ground side actually reaches GND
//  - whether the circuit would overcurrent (LED without resistor)
//  - whether a module (servo/LCD/sensor) is powered (VCC+GND wired)
//
// Runs on topology edits only (wire/move/add/remove), never per engine tick.
// ============================================================

import type { BoardComponent, Wire, NodeRef, ComponentCircuit, CircuitFault, PinState } from '@kodyuno/types'
import { PART_SPECS, rotatedTerminal } from './partSpecs'
import { activeBoard, boardHoles, canonicalRail, gndIdSet, powerRailPins, railVolts } from './boardGeometry'
import { BB_HOLES, breadboardHoles, allBBNets, HOLE_SNAP_RADIUS } from './breadboard'

// ---------- node keys ----------
export const pinKey = (pin: number | string) => `P:${pin}`
export const termKey = (comp: string, role: string) => `T:${comp}:${role}`
// breadboard net ids ("rail:tp" / "col:t:4") are used directly as keys

export function nodeKey(ref: NodeRef): string | null {
  if (ref.type === 'pin') return pinKey(ref.pin)
  if (ref.type === 'term') return termKey(ref.comp, ref.role)
  const hole = BB_HOLES.find((h) => h.id === ref.hole)
  return hole ? hole.net : null
}

// ---------- union-find ----------
class UF {
  private parent = new Map<string, string>()
  add(k: string) {
    if (!this.parent.has(k)) this.parent.set(k, k)
  }
  find(k: string): string {
    this.add(k)
    let root = k
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // path compression
    let cur = k
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  keys(): string[] {
    return [...this.parent.keys()]
  }
}

const LEG_SNAP = HOLE_SNAP_RADIUS // a leg this close to a hole counts as plugged

export interface SolveResult {
  /** patched components (pins derived from wiring, circuit info, state warnings) */
  components: BoardComponent[]
  /** node key → net root (canvas uses it to highlight/energize whole nets) */
  netOf: Record<string, string>
  /** net root → member node keys */
  members: Record<string, string[]>
  /** Fatal rail wiring errors, equivalent to Wokwi's short-circuit diagnostics. */
  faults: CircuitFault[]
}

interface Trace {
  hitKey: string
  resistance: number
}

export function solveCircuit(components: BoardComponent[], wires: Wire[], pinStates: PinState[] = []): SolveResult {
  const uf = new UF()
  const headerHoles = boardHoles()
  const GND_IDS = gndIdSet()

  // seed all known nodes so netOf/members are complete
  for (const h of headerHoles) uf.add(pinKey(h.pin))
  for (const net of allBBNets()) uf.add(net)
  for (const comp of components) {
    const spec = PART_SPECS[comp.type]
    if (!spec) continue
    for (const t of spec.terminals) uf.add(termKey(comp.id, t.role))
  }

  // all GND holes are one net
  const gndIds = [...GND_IDS]
  for (let i = 1; i < gndIds.length; i++) uf.union(pinKey(gndIds[0]), pinKey(gndIds[i]))

  // Header duplicates are electrically identical on the real board. Mega,
  // ESP32 and ESP8266 commonly expose more than one 5V/3V3 pin.
  const railsByVoltage = new Map<number, string[]>()
  for (const rail of powerRailPins()) {
    const volts = rail.volts!
    const ids = railsByVoltage.get(volts) ?? []
    ids.push(String(rail.id))
    railsByVoltage.set(volts, ids)
  }
  for (const ids of railsByVoltage.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(pinKey(ids[0]), pinKey(ids[i]))
  }

  const compIds = new Set(components.map((c) => c.id))

  // wires merge nets (skip wires pointing at removed components)
  for (const w of wires) {
    if (w.a.type === 'term' && !compIds.has(w.a.comp)) continue
    if (w.b.type === 'term' && !compIds.has(w.b.comp)) continue
    const ka = nodeKey(w.a)
    const kb = nodeKey(w.b)
    if (ka && kb) uf.union(ka, kb)
  }

  // plugged legs merge terminal with the hole's net (breadboard or Arduino header)
  for (const comp of components) {
    const spec = PART_SPECS[comp.type]
    if (!spec || !comp.pos) continue
    for (const t of spec.terminals) {
      if (!t.leg) continue
      const off = rotatedTerminal(spec, t, comp.rot)
      const ax = comp.pos.x + off.dx
      const ay = comp.pos.y + off.dy
      const tk = termKey(comp.id, t.role)
      let plugged = false
      for (const h of breadboardHoles()) {
        const dx = h.x - ax
        const dy = h.y - ay
        if (dx * dx + dy * dy <= LEG_SNAP * LEG_SNAP) {
          uf.union(tk, h.net)
          plugged = true
          break
        }
      }
      if (!plugged) {
        for (const h of headerHoles) {
          if (!h.connectable) continue
          const dx = h.x - ax
          const dy = h.y - ay
          if (dx * dx + dy * dy <= LEG_SNAP * LEG_SNAP) {
            uf.union(tk, pinKey(h.pin))
            break
          }
        }
      }
    }
  }

  // Stateful mechanical contacts merge nets exactly like their real parts.
  // This affects both current flow and net highlighting, not just the value
  // returned by digitalRead().
  for (const comp of components) {
    if (comp.type === 'pushbutton' && comp.state.pressed) {
      uf.union(termKey(comp.id, 'signal'), termKey(comp.id, 'gnd'))
    } else if (comp.type === 'slide_switch') {
      const selected = Number(comp.state.value ?? 0) > 0 ? '3' : '1'
      uf.union(termKey(comp.id, '2'), termKey(comp.id, selected))
    } else if (comp.type === 'dip_switch') {
      const values = Array.isArray(comp.state.values) ? comp.state.values : []
      for (let index = 0; index < 8; index++) {
        if (values[index]) uf.union(termKey(comp.id, `${index + 1}a`), termKey(comp.id, `${index + 1}b`))
      }
    } else if (comp.type === 'relay' && comp.state.active) {
      uf.union(termKey(comp.id, 'com'), termKey(comp.id, 'no'))
    }
  }

  // resistors become weighted edges between net roots
  type Edge = { to: string; r: number }
  const edges = new Map<string, Edge[]>()
  const addEdge = (a: string, b: string, r: number) => {
    if (a === b) return
    if (!edges.has(a)) edges.set(a, [])
    if (!edges.has(b)) edges.set(b, [])
    edges.get(a)!.push({ to: b, r })
    edges.get(b)!.push({ to: a, r })
  }
  for (const comp of components) {
    if (comp.type !== 'resistor') continue
    const r = typeof comp.state.value === 'number' ? comp.state.value : 220
    const t1 = uf.find(termKey(comp.id, 't1'))
    const t2 = uf.find(termKey(comp.id, 't2'))
    addEdge(t1, t2, r)
  }

  // membership index
  const netOf: Record<string, string> = {}
  const members: Record<string, string[]> = {}
  for (const k of uf.keys()) {
    const root = uf.find(k)
    netOf[k] = root
    if (!members[root]) members[root] = []
    members[root].push(k)
  }


  const faults: CircuitFault[] = []
  const board = activeBoard()
  for (const [root, memberKeys] of Object.entries(members)) {
    const hasGround = memberKeys.some((key) => key.startsWith('P:') && GND_IDS.has(key.slice(2)))
    const voltages = new Set<number>()
    for (const key of memberKeys) {
      if (!key.startsWith('P:')) continue
      const volts = railVolts(key.slice(2))
      if (volts !== null) voltages.add(volts)
    }
    if (hasGround && voltages.size > 0) {
      faults.push({
        type: 'short-circuit', net: root, nodes: memberKeys,
        message: `Korsleting: rail ${[...voltages].map((v) => `${v}V`).join('/')} tersambung langsung ke GND.`,
      })
    } else if (voltages.size > 1) {
      faults.push({
        type: 'voltage-conflict', net: root, nodes: memberKeys,
        message: `Konflik tegangan: rail ${[...voltages].map((v) => `${v}V`).join(' dan ')} berada pada jalur yang sama.`,
      })
    }

    const outputs = memberKeys
      .filter((key) => key.startsWith('P:'))
      .map((key) => {
        const id = key.slice(2)
        return pinStates.find((state) => String(state.pin) === id && state.mode === 'OUTPUT')
      })
      .filter((state): state is PinState => Boolean(state))
    const drivenLevels = new Set(outputs.map((state) => state.pwm > 0 || state.value > 0 ? 1 : 0))
    if (drivenLevels.size > 1) {
      faults.push({
        type: 'gpio-contention', net: root, nodes: memberKeys,
        message: 'Konflik output: dua GPIO pada jalur yang sama sedang memaksa level HIGH dan LOW.',
      })
    }
    if (outputs.length > 0 && (hasGround || voltages.size === 1)) {
      const forcedVolts = hasGround ? 0 : [...voltages][0]
      const conflictsRail = outputs.some((state) => {
        const outputVolts = state.pwm > 0 || state.value > 0 ? board.logicVolts : 0
        return Math.abs(outputVolts - forcedVolts) > 0.1
      })
      if (conflictsRail && !faults.some((fault) => fault.net === root && fault.type === 'short-circuit')) {
        faults.push({
          type: 'short-circuit', net: root, nodes: memberKeys,
          message: 'Korsleting GPIO: output board bertentangan dengan rail daya atau GND pada jalur ini.',
        })
      }
    }
  }

  const gndRoot = uf.find(pinKey('GND'))

  // Dijkstra over net roots through resistor edges
  function trace(start: string, isTarget: (memberKeys: string[]) => string | null): Trace | null {
    const dist = new Map<string, number>([[start, 0]])
    const visited = new Set<string>()
    while (true) {
      let cur: string | null = null
      let curD = Infinity
      for (const [k, d] of dist) {
        if (!visited.has(k) && d < curD) {
          cur = k
          curD = d
        }
      }
      if (cur === null) return null
      visited.add(cur)
      const hit = isTarget(members[cur] ?? [])
      if (hit !== null) return { hitKey: hit, resistance: curD }
      for (const e of edges.get(cur) ?? []) {
        const nd = curD + e.r
        if (nd < (dist.get(e.to) ?? Infinity)) dist.set(e.to, nd)
      }
    }
  }

  const isSource = (memberKeys: string[]): string | null => {
    // Prefer a GPIO over a rail when both are present so component-to-pin
    // mapping stays useful; the unsafe topology is reported separately.
    for (const k of memberKeys) {
      if (!k.startsWith('P:')) continue
      const id = k.slice(2)
      const pin = board.pins.find((entry) => String(entry.id) === id)
      if (pin?.kind === 'gpio' || pin?.kind === 'analog') return k
    }
    for (const k of memberKeys) {
      if (!k.startsWith('P:')) continue
      const id = k.slice(2)
      if (railVolts(id) !== null) return k
    }
    return null
  }
  const isGnd = (memberKeys: string[]): string | null =>
    memberKeys.some((k) => netOf[k] === gndRoot || (k.startsWith('P:') && GND_IDS.has(k.slice(2)))) ? 'P:GND' : null

  const parseSrc = (key: string): number | string => {
    const id = key.slice(2)
    const rail = canonicalRail(id)
    if (rail) return rail
    const n = Number(id)
    return Number.isNaN(n) ? id : n
  }

  // ---------- evaluate each component ----------
  const patched = components.map((comp) => {
    const spec = PART_SPECS[comp.type]
    if (!spec) return comp

    const circuit: ComponentCircuit = {
      srcPin: null,
      seriesR: 0,
      gndOk: false,
      overcurrent: false,
      brightScale: 1,
      powered: true,
      rolePins: {},
      warning: null,
    }
    const statePatch: Record<string, unknown> = {}

    const rootOfTerm = (role: string) => uf.find(termKey(comp.id, role))

    const electrical = spec.electrical ?? 'module'

    if (electrical === 'led') {
      const srcTrace = trace(rootOfTerm('anode'), isSource)
      const gndTrace = trace(rootOfTerm('cathode'), isGnd)
      circuit.gndOk = gndTrace !== null
      if (srcTrace) {
        circuit.srcPin = parseSrc(srcTrace.hitKey)
        circuit.seriesR = srcTrace.resistance + (gndTrace?.resistance ?? 0)
      }
      const totalR = circuit.seriesR
      circuit.overcurrent = circuit.srcPin !== null && circuit.gndOk && totalR < 100
      circuit.brightScale = totalR <= 100 ? 1 : Math.min(1, 300 / totalR)

      if (!srcTrace) circuit.warning = 'Kaki anode (+) LED belum tersambung ke pin Arduino atau 5V.'
      else if (!circuit.gndOk) circuit.warning = 'Kaki katode (−) LED belum ke GND — rangkaian belum tertutup.'
      else if (circuit.overcurrent) circuit.warning = 'Arus terlalu besar! Pasang resistor (mis. 220Ω) supaya LED tidak terbakar.'

      // constant sources (5V/3V3) light the LED without the engine
      if (circuit.srcPin === '5V' || circuit.srcPin === '3V3') {
        if (circuit.overcurrent) {
          statePatch.on = false
          statePatch.burned = true
        } else if (circuit.gndOk) {
          statePatch.on = true
          statePatch.brightness = circuit.brightScale
          statePatch.burned = false
        }
      } else if (!circuit.gndOk || circuit.srcPin === null) {
        statePatch.on = false
      }
      // fixing the circuit heals a burned LED
      if (!circuit.overcurrent && comp.state.burned) statePatch.burned = false
    } else if (electrical === 'rgb-led') {
      const gndTrace = trace(rootOfTerm('common'), isGnd)
      circuit.gndOk = gndTrace !== null
      for (const role of ['red', 'green', 'blue']) {
        const st = trace(rootOfTerm(role), isSource)
        circuit.rolePins[role] = st ? parseSrc(st.hitKey) : ''
      }
      circuit.srcPin = circuit.rolePins.red || circuit.rolePins.green || circuit.rolePins.blue || null
      if (!circuit.gndOk) circuit.warning = 'Kaki common LED RGB belum tersambung ke GND.'
      else if (['red', 'green', 'blue'].some((role) => circuit.rolePins[role] === '')) {
        circuit.warning = 'Hubungkan pin R, G, dan B LED RGB ke pin PWM Arduino.'
      }
    } else if (electrical === 'buzzer') {
      const srcTrace = trace(rootOfTerm('signal'), isSource)
      const gndTrace = trace(rootOfTerm('gnd'), isGnd)
      circuit.gndOk = gndTrace !== null
      if (srcTrace) circuit.srcPin = parseSrc(srcTrace.hitKey)
      if (!srcTrace) circuit.warning = 'Kaki sinyal (+) buzzer belum tersambung ke pin Arduino.'
      else if (!circuit.gndOk) circuit.warning = 'Kaki (−) buzzer belum ke GND.'
      if (!circuit.gndOk) statePatch.active = false
    } else if (electrical === 'resistor' || electrical === 'passive') {
      // Passive matrices have no supply pins, but libraries still need the
      // physical signal-to-GPIO mapping (e.g. keypad row/column headers).
      // LED bars and 7-segment digits drive through anode/cathode legs, so
      // map every non-supply terminal, not only ones tagged as signals.
      for (const terminal of spec.terminals.filter(t => t.kind !== 'vcc' && t.kind !== 'gnd')) {
        const source = trace(rootOfTerm(terminal.role), isSource)
        circuit.rolePins[terminal.role] = source ? parseSrc(source.hitKey) : ''
      }
    } else if (electrical === 'input') {
      const signalRoles = spec.terminals.filter((t) => t.kind === 'signal').map((t) => t.role)
      for (const role of signalRoles) {
        const st = trace(rootOfTerm(role), isSource)
        circuit.rolePins[role] = st ? parseSrc(st.hitKey) : ''
      }
      circuit.srcPin = circuit.rolePins[signalRoles[0]] || null
      const hasGnd = spec.terminals.some((t) => t.role === 'gnd')
      const hasVcc = spec.terminals.some((t) => t.role === 'vcc')
      circuit.gndOk = !hasGnd || trace(rootOfTerm('gnd'), isGnd) !== null
      const vccOk = !hasVcc || trace(rootOfTerm('vcc'), (mk) => {
        const rail = mk.find((key) => key.startsWith('P:') && railVolts(key.slice(2)) !== null)
        return rail ?? null
      }) !== null
      circuit.powered = circuit.gndOk && vccOk
      if (!circuit.powered) circuit.warning = `${comp.label}: periksa sambungan daya sensor.`
      else if (signalRoles.some((r) => circuit.rolePins[r] === '')) circuit.warning = `${comp.label}: kabel sinyal belum tersambung.`
    } else {
      // modules: servo, lcd, dht11, ultrasonic, pir
      const vccTrace = trace(rootOfTerm('vcc'), (mk) => {
        const rail = mk.find((key) => key.startsWith('P:') && railVolts(key.slice(2)) !== null)
        return rail ?? null
      })
      const gndTrace = trace(rootOfTerm('gnd'), isGnd)
      circuit.powered = vccTrace !== null && gndTrace !== null
      circuit.gndOk = gndTrace !== null

      const signalRoles = spec.terminals.filter((t) => t.kind === 'signal').map((t) => t.role)
      for (const role of signalRoles) {
        const st = trace(rootOfTerm(role), isSource)
        circuit.rolePins[role] = st && circuit.powered ? parseSrc(st.hitKey) : ''
      }
      const primary = circuit.rolePins[signalRoles[0]]
      circuit.srcPin = primary === '' || primary === undefined ? null : primary

      if (!circuit.powered) {
        circuit.warning = `${comp.label}: sambungkan VCC ke 5V dan GND ke GND dulu supaya dapat daya.`
      } else if (signalRoles.some((r) => circuit.rolePins[r] === '')) {
        circuit.warning = `${comp.label}: kabel sinyal belum tersambung ke pin Arduino.`
      }
    }

    // derive legacy pins mapping so the engine & levels keep working
    const pins = comp.pins.map((p) => {
      if (electrical === 'led' && p.role === 'anode') {
        return { ...p, pin: typeof circuit.srcPin === 'number' ? circuit.srcPin : circuit.srcPin === null ? '' : circuit.srcPin }
      }
      if (electrical === 'buzzer' && p.role === 'signal') {
        return { ...p, pin: circuit.srcPin ?? '' }
      }
      if (p.role in circuit.rolePins) {
        return { ...p, pin: circuit.rolePins[p.role] }
      }
      return p
    })

    statePatch.warning = circuit.warning

    return { ...comp, pins, circuit, state: { ...comp.state, ...statePatch } }
  })

  return { components: patched, netOf, members, faults }
}
