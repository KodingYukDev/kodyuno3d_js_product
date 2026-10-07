import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { BoardGraphic } from './BoardView'
import { ledAppearance, multimeterReadings } from '@kodyuno/lib/dcSolver'
import { bendInsertIndex, routeMidpoint, snapPoint, wireSvgPath, type WireStyle } from '@kodyuno/lib/wireGeometry'
import { endpointId } from '@kodyuno/lib/wireEndpoints'
import { boardBox, setBoardOffset } from '@kodyuno/lib/boardGeometry'
import { BreadboardGraphic } from './Breadboard'
import { PART_META } from './canvasParts'
import { BB_HOLES, BB_BODY, BB_PITCH, breadboardHoles, nearestBBHole, HOLE_SNAP_RADIUS } from '@kodyuno/lib/breadboard'
import type { Hole } from '@kodyuno/lib/boardGeometry'
import { connectableHoles, isGndPin, nearestHole as nearestArduinoHole, railVolts, setActiveBoard } from '@kodyuno/lib/boardGeometry'
import { pinKey, termKey, nodeKey } from '@kodyuno/lib/circuitSolver'
import { rotatedTerminal } from '@kodyuno/lib/partSpecs'
import type { BoardComponent, NodeRef, Wire } from '@kodyuno/types'
import { boxFromCorners, copyGroup, movedGroup, partsInBox, type Box, type PartGroup } from '@kodyuno/lib/partGroup'

const VIEW_W = 560
const VIEW_H = 900
// Deliberately larger than HOLE_SNAP_RADIUS (the "is this actually plugged
// in" radius) — dragging a wire endpoint or a whole component should feel
// more forgiving than the electrical plug check underneath it.
const SNAP_R = 12 // hit radius for wire endpoints & leg snapping
const MIN_ZOOM = 0.4
const MAX_ZOOM = 4

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ---------- canvas node universe (wire attach points) ----------
interface CanvasNode {
  ref: NodeRef
  key: string
  x: number
  y: number
}

function buildNodes(components: BoardComponent[], headerHoles: Hole[]): CanvasNode[] {
  const nodes: CanvasNode[] = []
  for (const h of headerHoles) {
    nodes.push({ ref: { type: 'pin', pin: h.pin }, key: pinKey(h.pin), x: h.x, y: h.y })
  }
  for (const h of breadboardHoles()) {
    nodes.push({ ref: { type: 'hole', hole: h.id }, key: endpointId({ type: 'hole', hole: h.id }), x: h.x, y: h.y })
  }
  for (const comp of components) {
    const meta = PART_META[comp.type]
    if (!meta || !comp.pos) continue
    for (const t of meta.terminals) {
      const off = rotatedTerminal(meta, t, comp.rot)
      nodes.push({
        ref: { type: 'term', comp: comp.id, role: t.role },
        key: termKey(comp.id, t.role),
        x: comp.pos.x + off.dx,
        y: comp.pos.y + off.dy,
      })
    }
  }
  return nodes
}

function nearestNode(nodes: CanvasNode[], x: number, y: number, r = SNAP_R, excludeKey?: string): CanvasNode | undefined {
  let best: CanvasNode | undefined
  let bestD = r * r
  for (const n of nodes) {
    if (excludeKey && n.key === excludeKey) continue
    const dx = n.x - x
    const dy = n.y - y
    const d = dx * dx + dy * dy
    if (d <= bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

interface DragState {
  compId: string
  offX: number
  offY: number
  /** Set when the grabbed part belongs to a multi-selection: everything moves. */
  group?: { start: PartGroup; origin: { x: number; y: number } }
}
interface WireDraft {
  reconnect?: { id: string; end: 'a' | 'b' }
  from: CanvasNode
  color: string
  x: number
  y: number
  points: { x: number; y: number }[]
}
interface ViewState {
  k: number
  x: number
  y: number
}
interface PanState {
  sx: number
  sy: number
  ox: number
  oy: number
}

/** Copied parts (+ wires between them), shared by every canvas in the tab (Ctrl+C / Ctrl+V). */
let partClipboard: { group: PartGroup; pastes: number } | null = null

export function SimulatorCanvas() {
  const boardType = useKodyUnoStore((s) => s.boardType)
  const boardOffset = useKodyUnoStore((s) => s.boardOffset)
  const moveBoard = useKodyUnoStore((s) => s.moveBoard)
  const breadboardOffset = useKodyUnoStore(s => s.breadboardOffset)
  const moveBreadboard = useKodyUnoStore(s => s.moveBreadboard)
  // Header holes follow the selected board; setActiveBoard keeps the pure
  // helpers (solver, snapping) pointed at the same pin table.
  const headerHoles = useMemo(() => {
    setActiveBoard(boardType)
    setBoardOffset(boardOffset)
    return connectableHoles()
  }, [boardType, boardOffset])
  const components = useKodyUnoStore((s) => s.components)
  const wires = useKodyUnoStore((s) => s.wires)
  const pins = useKodyUnoStore((s) => s.pins)
  const circuitIndex = useKodyUnoStore((s) => s.circuitIndex)
  const circuitFaults = useKodyUnoStore((s) => s.circuitFaults)
  const moveComponent = useKodyUnoStore((s) => s.moveComponent)
  const removeComponent = useKodyUnoStore((s) => s.removeComponent)
  const addWire = useKodyUnoStore((s) => s.addWire)
  const removeWire = useKodyUnoStore((s) => s.removeWire)
  const updateWire = useKodyUnoStore((s) => s.updateWire)
  const cycleResistor = useKodyUnoStore((s) => s.cycleResistor)
  const rotateComponent = useKodyUnoStore((s) => s.rotateComponent)
  const resolveCircuit = useKodyUnoStore((s) => s.resolveCircuit)
  const selectedComponentId = useKodyUnoStore((s) => s.selectedComponentId)
  const selectComponent = useKodyUnoStore((s) => s.selectComponent)

  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const panRef = useRef<PanState | null>(null)
  const bendRef = useRef<{ wireId: string; index: number } | null>(null)
  const boardDragRef = useRef<{ x: number; y: number } | null>(null)
  const breadboardDragRef = useRef<{ x: number; y: number } | null>(null)
  const [wiring, setWiring] = useState<WireDraft | null>(null)
  const [view, setView] = useState<ViewState>({ k: 1, x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [selectedWire, setSelectedWire] = useState<string | null>(null)
  const wirePointerRef = useRef<{ x: number; y: number; initial: boolean } | null>(null)
  /** Pointer went down on a wire body; becomes a new bend once it moves. */
  const wireGrabRef = useRef<{ wireId: string; clientX: number; clientY: number; wasSelected: boolean } | null>(null)
  /** Multi-selection (two or more parts); a single part uses selectedComponentId. */
  const [group, setGroup] = useState<string[]>([])
  const liveGroup = group.filter(id => components.some(comp => comp.id === id))
  const groupRef = useRef(liveGroup)
  useEffect(() => { groupRef.current = liveGroup })
  /** Shift+drag selection rectangle, in world space. */
  const boxStartRef = useRef<{ x: number; y: number } | null>(null)
  const [selectBox, setSelectBox] = useState<Box | null>(null)

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        setWiring(null)
        const state = useKodyUnoStore.getState()
        if (event.shiftKey || event.key.toLowerCase() === 'y') state.redo()
        else state.undo()
      }
      if (event.key === 'Escape') {
        setGroup([])
        setWiring(null)
        wirePointerRef.current = null
        setSelectedWire(null)
      }
      if (wiring && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault()
        setWiring(current => current ? { ...current, points: current.points.slice(0, -1) } : null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [wiring])

  // Part shortcuts, as in Wokwi: R rotates, Delete removes, Ctrl+C / Ctrl+V
  // copy-paste, Ctrl+D duplicates. Copies keep state and rotation, not wires.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) return
      const state = useKodyUnoStore.getState()
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      const paste = (copied: PartGroup, step: number) => {
        const ids = state.pasteGroup(copied, { x: 28 * step, y: 28 * step })
        setGroup(ids.length > 1 ? ids : [])
      }
      if (mod && key === 'v' && partClipboard) {
        event.preventDefault()
        paste(partClipboard.group, ++partClipboard.pastes)
        return
      }
      if (wiring || selectedWire) return
      if (mod && key === 'a') {
        event.preventDefault()
        setGroup(state.components.map(comp => comp.id))
        state.selectComponent(null)
        return
      }
      const ids = groupRef.current.length > 1 ? groupRef.current : state.selectedComponentId ? [state.selectedComponentId] : []
      if (!ids.length) return
      if (mod && key === 'c') { event.preventDefault(); partClipboard = { group: copyGroup(state.components, state.wires, ids), pastes: 0 }; return }
      if (mod && key === 'd') { event.preventDefault(); paste(copyGroup(state.components, state.wires, ids), 1); return }
      if (mod || event.altKey) return
      if (key === 'r') { event.preventDefault(); state.rotateComponents(ids); return }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); state.removeComponents(ids); setGroup([]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wiring, selectedWire])

  // Delete / Backspace removes the selected wire
  useEffect(() => {
    if (!selectedWire) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      removeWire(selectedWire)
      setSelectedWire(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedWire, removeWire])

  // ---------- coordinate helpers ----------
  /** Pointer position in world space (inside the pan/zoom group). */
  const toWorld = (e: ReactPointerEvent) => {
    const g = gRef.current
    if (!g) return { x: 0, y: 0 }
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = g.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = pt.matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  const toWorldClient = (clientX: number, clientY: number) => toWorld({ clientX, clientY } as ReactPointerEvent)

  /** Pointer position in the svg root viewBox space (ignores pan/zoom). */
  const toRoot = (e: ReactPointerEvent) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = pt.matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  /**
   * Bends snap to the breadboard hole grid so runs line up with the holes,
   * as in Wokwi. Hold Alt to place a bend freely.
   */
  const snapBend = (point: { x: number; y: number }, free: boolean) => {
    if (free) return point
    const origin = breadboardHoles()[0] ?? { x: 0, y: 0 }
    return snapPoint(point, BB_PITCH / 2, origin)
  }

  // wheel zoom (native listener — React's onWheel is passive)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const m = svg.getScreenCTM()
      if (!m) return
      const p = pt.matrixTransform(m.inverse())
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM)
        const f = k / v.k
        return { k, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number) => {
    // zoom around viewBox center
    const cx = VIEW_W / 2
    const cy = VIEW_H / 2
    setView((v) => {
      const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM)
      const f = k / v.k
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
    })
  }
  const zoomFit = () => setView({ k: 1, x: 0, y: 0 })

  const nodes = buildNodes(components, headerHoles)
  // Multimeters read the live DC operating point (pin levels change it).
  const meterReadings = useMemo(() => multimeterReadings(components, circuitIndex.netOf, pins), [components, circuitIndex.netOf, pins])
  // LEDs glow from the solved current, not from a fixed on/off per pin.
  const ledLooks = useMemo(() => ledAppearance(components, circuitIndex.netOf, pins), [components, circuitIndex.netOf, pins])

  // net roots that currently carry voltage (driven pin HIGH/PWM, or 5V/3V3)
  const hotRoots = new Set<string>()
  for (const [key, root] of Object.entries(circuitIndex.netOf)) {
    if (!key.startsWith('P:')) continue
    const id = key.slice(2)
    if (railVolts(id) !== null) {
      hotRoots.add(root)
      continue
    }
    const pv = pins.find((p) => String(p.pin) === id)
    if (pv && (pv.value === 1 || pv.pwm > 0)) hotRoots.add(root)
  }
  const rootOf = (key: string | null) => {
    if (!key) return ''
    const electricalKey = key.startsWith('H:') ? nodeKey({ type: 'hole', hole: key.slice(2) }) : key
    return electricalKey ? circuitIndex.netOf[electricalKey] ?? electricalKey : ''
  }

  // resolve a wire endpoint to canvas xy
  const endpointXY = (ref: NodeRef): { x: number; y: number } | null => {
    if (ref.type === 'pin') {
      const h = headerHoles.find((hh) => hh.pin === ref.pin)
      return h ? { x: h.x, y: h.y } : null
    }
    if (ref.type === 'hole') {
      const h = breadboardHoles().find((hh) => hh.id === ref.hole)
      return h ? { x: h.x, y: h.y } : null
    }
    const comp = components.find((c) => c.id === ref.comp)
    const meta = comp && PART_META[comp.type]
    const t = meta && meta.terminals.find((tt) => tt.role === ref.role)
    if (!comp || !meta || !t || !comp.pos) return null
    const off = rotatedTerminal(meta, t, comp.rot)
    return { x: comp.pos.x + off.dx, y: comp.pos.y + off.dy }
  }

  const wirePath = (ax: number, ay: number, bx: number, by: number, points?: { x: number; y: number }[], style?: WireStyle) =>
    wireSvgPath({ x: ax, y: ay }, { x: bx, y: by }, points, style)

  /** Insert a bend on `wire` at `at` and return its index in wire.points. */
  const insertBend = (wire: Wire, at: { x: number; y: number }) => {
    const a = endpointXY(wire.a), b = endpointXY(wire.b)
    const bends = wire.points ?? []
    if (!a || !b || bends.length >= 100) return null
    const index = bendInsertIndex(a, b, bends, at, wire.style)
    useKodyUnoStore.getState().checkpoint()
    updateWire(wire.id, { points: [...bends.slice(0, index), at, ...bends.slice(index)] })
    return index
  }

  // ---------- interactions ----------
  const startDrag = (e: ReactPointerEvent, comp: BoardComponent) => {
    e.stopPropagation()
    if (e.shiftKey) {
      // Shift+click adds or removes a part from the selection.
      const current = liveGroup.length ? liveGroup : selectedComponentId ? [selectedComponentId] : []
      const next = current.includes(comp.id) ? current.filter(id => id !== comp.id) : [...current, comp.id]
      setGroup(next.length > 1 ? next : [])
      selectComponent(next.length === 1 ? next[0] : null)
      return
    }
    useKodyUnoStore.getState().checkpoint()
    const p = toWorld(e)
    dragRef.current = { compId: comp.id, offX: p.x - (comp.pos?.x ?? 0), offY: p.y - (comp.pos?.y ?? 0) }
    if (liveGroup.length > 1 && liveGroup.includes(comp.id)) {
      dragRef.current.group = { start: copyGroup(components, wires, liveGroup), origin: p }
    } else {
      setGroup([])
      selectComponent(comp.id)
    }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const startWireFromNode = (e: ReactPointerEvent, node: CanvasNode, color: string) => {
    e.stopPropagation()
    if (wiring) {
      if (node.key !== wiring.from.key) {
        if (wiring.reconnect) useKodyUnoStore.getState().reconnectWire(wiring.reconnect.id, wiring.reconnect.end, node.ref)
        else addWire(wiring.from.ref, node.ref, wiring.color, wiring.points)
      }
      setWiring(null)
      wirePointerRef.current = null
      return
    }
    const p = toWorld(e)
    setSelectedWire(null)
    setWiring({ from: node, color, x: p.x, y: p.y, points: [] })
    wirePointerRef.current = { x: e.clientX, y: e.clientY, initial: true }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const startPan = (e: ReactPointerEvent) => {
    if (wiring) {
      const point = snapBend(toWorld(e), e.altKey)
      setWiring({ ...wiring, points: [...wiring.points, point], x: point.x, y: point.y })
      return
    }
    if (dragRef.current || wiring) return
    setSelectedWire(null)
    selectComponent(null)
    setGroup([])
    if (e.shiftKey) {
      // Shift+drag on empty space draws a selection box (plain drag pans).
      const start = toWorld(e)
      boxStartRef.current = start
      setSelectBox({ ...start, w: 0, h: 0 })
      svgRef.current?.setPointerCapture(e.pointerId)
      return
    }
    const p = toRoot(e)
    panRef.current = { sx: p.x, sy: p.y, ox: view.x, oy: view.y }
    setPanning(true)
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const startReconnect = (event: ReactPointerEvent, wire: Wire, end: 'a' | 'b') => {
    event.stopPropagation()
    const other = end === 'a' ? 'b' : 'a'
    const fixed = endpointXY(wire[other]), position = endpointXY(wire[end])
    if (!fixed || !position) return
    setWiring({ from: { ref: wire[other], key: endpointId(wire[other]), ...fixed }, color: wire.color,
      ...position, points: end === 'a' ? [...(wire.points ?? [])].reverse() : [...(wire.points ?? [])], reconnect: { id: wire.id, end } })
    wirePointerRef.current = { x: event.clientX, y: event.clientY, initial: true }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const wireColorForStart = (node: CanvasNode): string => {
    if (node.ref.type === 'pin') {
      if (isGndPin(node.ref.pin)) return '#1e293b'
      if (railVolts(node.ref.pin) !== null) return '#dc2626'
      return '#16a34a'
    }
    if (node.ref.type === 'term') {
      const comp = components.find((c) => c.id === (node.ref as { comp: string }).comp)
      const meta = comp && PART_META[comp.type]
      const t = meta?.terminals.find((tt) => tt.role === (node.ref as { role: string }).role)
      return t?.color ?? '#16a34a'
    }
    // breadboard hole: rails hint their polarity
    const hole = BB_HOLES.find((h) => h.id === (node.ref as { hole: string }).hole)
    if (hole?.row === 'tp' || hole?.row === 'bp') return '#dc2626'
    if (hole?.row === 'tm' || hole?.row === 'bm') return '#1e293b'
    return '#16a34a'
  }

  const onMove = (e: ReactPointerEvent) => {
    if (boxStartRef.current) {
      setSelectBox(boxFromCorners(boxStartRef.current, toWorld(e)))
      return
    }
    if (breadboardDragRef.current) {
      const point = toWorld(e)
      moveBreadboard({ x: point.x - breadboardDragRef.current.x, y: point.y - breadboardDragRef.current.y })
      return
    }
    if (boardDragRef.current) {
      const point = toWorld(e)
      moveBoard({ x: point.x - boardDragRef.current.x, y: point.y - boardDragRef.current.y })
      return
    }
    if (wireGrabRef.current) {
      const grab = wireGrabRef.current
      if (Math.hypot(e.clientX - grab.clientX, e.clientY - grab.clientY) < 4) return
      wireGrabRef.current = null
      const wire = wires.find((entry) => entry.id === grab.wireId)
      const index = wire ? insertBend(wire, snapBend(toWorld(e), e.altKey)) : null
      if (index !== null) {
        setSelectedWire(grab.wireId)
        bendRef.current = { wireId: grab.wireId, index }
      }
      return
    }
    if (bendRef.current) {
      const { wireId, index } = bendRef.current
      const wire = useKodyUnoStore.getState().wires.find((entry) => entry.id === wireId)
      const point = snapBend(toWorld(e), e.altKey)
      if (wire?.points) updateWire(wireId, { points: wire.points.map((existing, i) => i === index ? point : existing) })
      return
    }
    if (panRef.current) {
      const p = toRoot(e)
      const pan = panRef.current
      setView((v) => ({ ...v, x: pan.ox + (p.x - pan.sx), y: pan.oy + (p.y - pan.sy) }))
      return
    }
    if (!dragRef.current && !wiring) return
    const p = toWorld(e)
    if (dragRef.current) {
      const d = dragRef.current
      // unbounded — the canvas pans/zooms, so parts can go anywhere
      if (d.group) {
        const moved = movedGroup(d.group.start, { x: p.x - d.group.origin.x, y: p.y - d.group.origin.y })
        useKodyUnoStore.getState().placeParts(moved.positions, moved.bends)
      } else moveComponent(d.compId, { x: p.x - d.offX, y: p.y - d.offY })
    } else if (wiring) {
      setWiring({ ...wiring, x: p.x, y: p.y })
    }
  }

  // where a pluggable component snaps so its legs sit in holes (null: stays put)
  const snapTarget = (comp: BoardComponent): { x: number; y: number } | null => {
    const meta = PART_META[comp.type]
    if (!meta?.pluggable || !comp.pos) return null
    const legs = meta.terminals.filter((t) => t.leg).map((t) => rotatedTerminal(meta, t, comp.rot))
    if (legs.length === 0) return null
    const l0 = legs[0]
    const ax = comp.pos.x + l0.dx
    const ay = comp.pos.y + l0.dy
    const bb = nearestBBHole(ax, ay, SNAP_R)
    const ard = bb ? undefined : nearestArduinoHole(ax, ay, SNAP_R)
    const target = bb ?? ard
    if (!target) return null
    const nx = target.x - l0.dx
    const ny = target.y - l0.dy
    // all remaining legs must also land on a hole
    const ok = legs.slice(1).every((t) => {
      const x = nx + t.dx
      const y = ny + t.dy
      // must match circuitSolver's LEG_SNAP or a part can visually "snap"
      // without actually registering as plugged in electrically.
      return nearestBBHole(x, y, HOLE_SNAP_RADIUS) !== undefined || nearestArduinoHole(x, y, HOLE_SNAP_RADIUS) !== undefined
    })
    return ok ? { x: nx, y: ny } : null
  }

  const onUp = (e: ReactPointerEvent) => {
    if (boxStartRef.current) {
      const box = boxFromCorners(boxStartRef.current, toWorld(e))
      boxStartRef.current = null
      setSelectBox(null)
      const ids = partsInBox(components, box)
      setGroup(ids.length > 1 ? ids : [])
      selectComponent(ids.length === 1 ? ids[0] : null)
    }
    if (breadboardDragRef.current) { breadboardDragRef.current = null; resolveCircuit() }
    if (boardDragRef.current) { boardDragRef.current = null; resolveCircuit() }
    bendRef.current = null
    if (wireGrabRef.current) {
      const grab = wireGrabRef.current
      wireGrabRef.current = null
      setSelectedWire(grab.wasSelected ? null : grab.wireId)
    }
    if (panRef.current) {
      panRef.current = null
      setPanning(false)
    }
    if (wiring) {
      const initial = wirePointerRef.current
      if (initial?.initial && Math.hypot(e.clientX - initial.x, e.clientY - initial.y) <= 5) {
        wirePointerRef.current = null
        if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
        return
      }
      const p = toWorld(e)
      const target = nearestNode(nodes, p.x, p.y, SNAP_R + 4, wiring.from.key)
      if (target && rootOf(target.key) !== '' && target.key !== wiring.from.key) {
        if (wiring.reconnect) useKodyUnoStore.getState().reconnectWire(wiring.reconnect.id, wiring.reconnect.end, target.ref)
        else addWire(wiring.from.ref, target.ref, wiring.color, wiring.points)
        setWiring(null)
      } else if (wirePointerRef.current?.initial && Math.hypot(e.clientX - wirePointerRef.current.x, e.clientY - wirePointerRef.current.y) > 5) {
        setWiring({ ...wiring, points: [...wiring.points, p], x: p.x, y: p.y })
      }
      wirePointerRef.current = null
    }
    if (dragRef.current) {
      const drag = dragRef.current
      const comp = components.find((c) => c.id === drag.compId)
      const snapped = comp && snapTarget(comp)
      if (comp && snapped) {
        const from = drag.group?.start.parts.find(part => part.id === comp.id)?.pos
        if (drag.group && from) {
          // The grabbed part decides the snap; the rest keep their spacing.
          const moved = movedGroup(drag.group.start, { x: snapped.x - from.x, y: snapped.y - from.y })
          useKodyUnoStore.getState().placeParts(moved.positions, moved.bends)
        } else moveComponent(comp.id, snapped)
      }
      dragRef.current = null
      resolveCircuit()
    }
    try {
      svgRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // node under cursor while wiring (for highlighting)
  const hoverNode = wiring ? nearestNode(nodes, wiring.x, wiring.y, SNAP_R + 4, wiring.from.key) : undefined
  const highlightNet = hoverNode ? rootOf(hoverNode.key) : wiring ? rootOf(wiring.from.key) : null

  const wireIsHot = (w: Wire) => {
    const ka = nodeKey(w.a)
    return ka ? hotRoots.has(rootOf(ka)) : false
  }

  return (
    <div className="relative w-full h-full min-h-0">
      {selectedWire && <div role="toolbar" aria-label="Pengaturan kabel" className="absolute bottom-12 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-lg">
        <label className="text-xs">Warna kabel <input aria-label="Warna kabel" type="color" value={wires.find(w => w.id === selectedWire)?.color ?? '#16a34a'} onChange={e => updateWire(selectedWire, { color: e.target.value })} /></label>
        <div className="flex overflow-hidden rounded-md border border-slate-200" role="group" aria-label="Bentuk kabel">
          {([['orthogonal', 'Siku'], ['straight', 'Lurus'], ['curved', 'Lengkung']] as const).map(([style, label]) => {
            const active = (wires.find(w => w.id === selectedWire)?.style ?? 'orthogonal') === style
            return <button key={style} type="button" aria-pressed={active}
              className={`px-2 py-1 text-xs ${active ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
              onClick={() => { useKodyUnoStore.getState().checkpoint(); updateWire(selectedWire, { style }) }}>{label}</button>
          })}
        </div>
        <button type="button" className="text-xs" onClick={() => { useKodyUnoStore.getState().checkpoint(); updateWire(selectedWire, { points: [] }) }}>Reset jalur</button>
        <span className="hidden text-[11px] text-slate-500 md:inline">Tarik kabel = belokan baru · klik-ganda titik = hapus · Alt = tanpa snap</span>
      </div>}
      {circuitFaults.length > 0 && (
        <div role="alert" className="absolute top-3 left-1/2 z-30 max-w-[75%] -translate-x-1/2 rounded-lg border border-red-300 bg-red-50/95 px-3 py-2 text-[11px] font-semibold text-red-800 shadow-lg backdrop-blur">
          ⚠ {circuitFaults[0].message}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full touch-none select-none"
        style={{ cursor: panning ? 'grabbing' : 'default' }}
        onPointerDown={startPan}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          setWiring(null)
          wirePointerRef.current = null
          boardDragRef.current = null
          breadboardDragRef.current = null
          bendRef.current = null
          wireGrabRef.current = null
          dragRef.current = null
          panRef.current = null
          boxStartRef.current = null
          setSelectBox(null)
          setPanning(false)
          resolveCircuit()
        }}
        role="application"
        aria-label="Kanvas simulator Arduino dengan breadboard"
      >
        <g ref={gRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* ===== Arduino board ===== */}
          <g onPointerDown={e => {
            if (e.shiftKey) return
            e.stopPropagation()
            useKodyUnoStore.getState().checkpoint()
            const point = toWorld(e)
            boardDragRef.current = { x: point.x - boardOffset.x, y: point.y - boardOffset.y }
            svgRef.current?.setPointerCapture(e.pointerId)
          }} style={{ cursor: 'grab' }}>
            <BoardGraphic />
            <rect x={boardBox().x} y={boardBox().y} width={boardBox().w} height={boardBox().h} fill="transparent" />
            <title>Geser board · kabel tetap mengikuti pin</title>
          </g>

          {/* ===== breadboard ===== */}
          <g transform={`translate(${breadboardOffset.x} ${breadboardOffset.y})`} onPointerDown={e => {
            if (wiring || e.shiftKey) return
            e.stopPropagation()
            useKodyUnoStore.getState().checkpoint()
            const point = toWorld(e)
            breadboardDragRef.current = { x: point.x - breadboardOffset.x, y: point.y - breadboardOffset.y }
            svgRef.current?.setPointerCapture(e.pointerId)
          }} style={{ cursor: 'grab' }}>
            <BreadboardGraphic highlightNet={wiring ? highlightNet : null} netOf={circuitIndex.netOf} />
            <rect x={BB_BODY.x} y={BB_BODY.y} width={BB_BODY.w} height={BB_BODY.h} fill="transparent" />
            <title>Geser badan breadboard</title>
          </g>

          {/* Arduino hole targets while wiring */}
          {wiring &&
            headerHoles.map((h) => {
              const isHover = hoverNode?.ref.type === 'pin' && hoverNode.ref.pin === h.pin
              return (
                <circle
                  key={`t${h.pin}`}
                  cx={h.x}
                  cy={h.y}
                  r={isHover ? 9 : 6.5}
                  fill="none"
                  stroke={isHover ? '#22c55e' : '#38bdf8'}
                  strokeWidth={isHover ? 2.5 : 1.2}
                  opacity={isHover ? 1 : 0.5}
                />
              )
            })}

          {/* invisible wire-start targets on breadboard holes (below wires and parts) */}
          {breadboardHoles().map((h) => (
            <circle
              key={`bbhit-${h.id}`}
              cx={h.x} cy={h.y} r="6"
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => {
                const node: CanvasNode = { ref: { type: 'hole', hole: h.id }, key: endpointId({ type: 'hole', hole: h.id }), x: h.x, y: h.y }
                startWireFromNode(e, node, wireColorForStart(node))
              }}
            />
          ))}
          {/* invisible wire-start targets on Arduino holes */}
          {headerHoles.map((h) => (
            <circle
              key={`pinhit-${h.pin}`}
              cx={h.x} cy={h.y} r="7"
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => {
                const node: CanvasNode = { ref: { type: 'pin', pin: h.pin }, key: pinKey(h.pin), x: h.x, y: h.y }
                startWireFromNode(e, node, wireColorForStart(node))
              }}
            />
          ))}

          {/* ===== components ===== */}
          {components.map((comp) => {
            const meta = PART_META[comp.type]
            if (!meta) return null
            const x = comp.pos?.x ?? 0
            const y = comp.pos?.y ?? 0
            const rot = ((Math.round(comp.rot ?? 0) % 360) + 360) % 360
            const sideways = rot === 90 || rot === 270
            // visual bounding box after rotation (local coords)
            const bw = sideways ? meta.h : meta.w
            const bh = sideways ? meta.w : meta.h
            const ox = (meta.w - bw) / 2
            const oy = (meta.h - bh) / 2
            const warning = typeof comp.state.warning === 'string' ? comp.state.warning : null
            return (
              <g key={comp.id} transform={`translate(${x} ${y})`}>
                {liveGroup.includes(comp.id) && (
                  <rect x={ox - 7} y={oy - 7} width={bw + 14} height={bh + 24} rx="9" fill="#38bdf8" fillOpacity="0.06" stroke="#0284c7" strokeWidth="2" strokeDasharray="5 3" />
                )}
                {selectedComponentId === comp.id && (
                  <rect x={ox - 7} y={oy - 7} width={bw + 14} height={bh + 24} rx="9" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3" />
                )}
                {/* drag surface + body (rotated around part center) */}
                <g
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => startDrag(e, comp)}
                  transform={rot ? `rotate(${rot} ${meta.w / 2} ${meta.h / 2})` : undefined}
                >
                  <rect x={-4} y={-4} width={meta.w + 8} height={meta.h + 8} rx="6" fill="transparent" />
                  {meta.render(comp.type === 'multimeter' ? { ...comp.state, reading: meterReadings[comp.id] } : ledLooks[comp.id] ? { ...comp.state, ...ledLooks[comp.id] } : comp.state, comp.id)}
                </g>

                {/* label */}
                <text x={ox + bw / 2} y={oy + bh + 12} textAnchor="middle" fontSize="9" fill="#334155" fontFamily="sans-serif" fontWeight="bold">
                  {comp.label}
                </text>

                {/* resistor value badge — click to cycle */}
                {comp.type === 'resistor' && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); cycleResistor(comp.id) }}
                  >
                    <rect x={ox + bw / 2 - 14} y={oy + bh + 16} width="28" height="12" rx="4" fill="#fef3c7" stroke="#f59e0b" strokeWidth="0.8" />
                    <text x={ox + bw / 2} y={oy + bh + 25} textAnchor="middle" fontSize="7.5" fill="#92400e" fontFamily="monospace" fontWeight="bold">ubah</text>
                    <title>Klik untuk mengganti nilai resistor</title>
                  </g>
                )}

                {/* terminals (at rotated positions) */}
                {meta.terminals.map((term) => {
                  const off = rotatedTerminal(meta, term, rot)
                  const tKey = termKey(comp.id, term.role)
                  const root = rootOf(tKey)
                  // terminal is "connected" when its net contains more than itself
                  const connected = (circuitIndex.members[root]?.length ?? 1) > 1
                  return (
                    <g key={term.role}>
                      <circle
                        cx={off.dx}
                        cy={off.dy}
                        r="5.5"
                        fill={connected ? term.color : '#ffffff'}
                        stroke={term.color}
                        strokeWidth="2"
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => {
                          const node: CanvasNode = {
                            ref: { type: 'term', comp: comp.id, role: term.role },
                            key: tKey,
                            x: x + off.dx,
                            y: y + off.dy,
                          }
                          startWireFromNode(e, node, term.color)
                        }}
                      >
                        <title>{`${term.role} — tarik ke lubang breadboard / pin Arduino`}</title>
                      </circle>
                    </g>
                  )
                })}

                {/* warning chip */}
                {warning && (
                  <g>
                    <circle cx={ox - 10} cy={oy - 10} r="8" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
                    <text x={ox - 10} y={oy - 6} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#7c2d12">!</text>
                    <title>{warning}</title>
                  </g>
                )}

                {/* rotate 90° */}
                <g
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); rotateComponent(comp.id) }}
                >
                  <circle cx={ox + bw - 10} cy={oy - 10} r="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
                  {/* standard rotate-cw glyph (24×24 grid), scaled to fit the button */}
                  <g
                    transform={`translate(${ox + bw - 10} ${oy - 10}) scale(0.42) translate(-12 -12)`}
                    fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </g>
                  <title>Putar 90°</title>
                </g>

                {/* remove */}
                <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); removeComponent(comp.id) }}>
                  <circle cx={ox + bw + 10} cy={oy - 10} r="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
                  <path d={`M ${ox + bw + 6.5} ${oy - 13.5} L ${ox + bw + 13.5} ${oy - 6.5} M ${ox + bw + 13.5} ${oy - 13.5} L ${ox + bw + 6.5} ${oy - 6.5}`} stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round" />
                  <title>Hapus komponen</title>
                </g>
              </g>
            )
          })}

          {/* ===== committed wires =====
              Above the hole targets and the parts, as in Wokwi: a wire lying
              across the breadboard or over a module must stay visible and
              clickable. A press near a wire end still starts a new wire from
              that hole or terminal (see the hit-path handler). */}
          {/* Ref writes below occur exclusively inside pointer event handlers. */}
          {/* eslint-disable-next-line react-hooks/refs -- nested endpoint handlers capture refs; rendering never reads .current */}
          {wires.map((w) => {
            if (wiring?.reconnect?.id === w.id) return null
            const a = endpointXY(w.a)
            const b = endpointXY(w.b)
            if (!a || !b) return null
            const hot = wireIsHot(w)
            const selected = selectedWire === w.id
            const d = wirePath(a.x, a.y, b.x, b.y, w.points, w.style)
            const { x: mx, y: my } = routeMidpoint(a, b, w.points, w.style)
            return (
              <g key={w.id} style={{ cursor: selected ? 'move' : 'pointer' }}>
                {/* fat invisible hit path — click to select, drag to bend */}
                <path
                  d={d} fill="none" stroke="transparent" strokeWidth="14"
                  onPointerDown={(e) => {
                    if (wiring) return
                    const at = toWorld(e)
                    const node = nearestNode(nodes, at.x, at.y, SNAP_R)
                    if (node) { startWireFromNode(e, node, wireColorForStart(node)); return }
                    e.stopPropagation()
                    wireGrabRef.current = { wireId: w.id, clientX: e.clientX, clientY: e.clientY, wasSelected: selected }
                    svgRef.current?.setPointerCapture(e.pointerId)
                  }}
                  onDoubleClick={(e) => {
                    // Double-click adds a bend where you clicked. It used to
                    // delete the wire, which cost children whole circuits.
                    e.stopPropagation()
                    insertBend(w, snapBend(toWorldClient(e.clientX, e.clientY), e.altKey))
                    setSelectedWire(w.id)
                  }}
                />
                {selected && (
                  <path d={d} fill="none" stroke="#38bdf8" strokeWidth="6.5" strokeOpacity="0.55" strokeLinecap="round" pointerEvents="none" />
                )}
                <path d={d} fill="none" stroke="#0f172a" strokeWidth={hot ? 4.5 : 3.5} strokeOpacity="0.22" strokeLinecap="round" pointerEvents="none" />
                <path d={d} fill="none" stroke={w.color} strokeWidth={hot ? 3 : 2.4} strokeLinecap="round" opacity={hot ? 1 : 0.9} pointerEvents="none" />
                {hot && (
                  <path d={d} fill="none" stroke="#fde047" strokeWidth="1.1" strokeDasharray="2 8" strokeLinecap="round" pointerEvents="none">
                    <animate attributeName="stroke-dashoffset" from="10" to="0" dur="0.5s" repeatCount="indefinite" />
                  </path>
                )}
                {selected && w.points?.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="5" fill="white" stroke="#0284c7" strokeWidth="2"
                  onPointerDown={e => { e.stopPropagation(); useKodyUnoStore.getState().checkpoint(); bendRef.current = { wireId: w.id, index }; svgRef.current?.setPointerCapture(e.pointerId) }}
                  onDoubleClick={e => { e.stopPropagation(); updateWire(w.id, { points: w.points!.filter((_, i) => i !== index) }) }}>
                  <title>Geser belokan · klik ganda untuk hapus belokan</title>
                </circle>)}
                {selected && (['a', 'b'] as const).map(end => {
                  const position = end === 'a' ? a : b
                  return <circle key={end} cx={position.x} cy={position.y} r="7" fill="#dbeafe" stroke="#2563eb" strokeWidth="2"
                    onPointerDown={event => startReconnect(event, w, end)}><title>Geser ujung kabel ke pin lain · Escape untuk batal</title></circle>
                })}
                {/* delete button at wire midpoint when selected */}
                {selected && (
                  <g
                    onPointerDown={(e) => { e.stopPropagation(); removeWire(w.id); setSelectedWire(null) }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle cx={mx} cy={my} r="9" fill="#ffffff" stroke="#ef4444" strokeWidth="1.5" />
                    <path d={`M ${mx - 3.5} ${my - 3.5} L ${mx + 3.5} ${my + 3.5} M ${mx + 3.5} ${my - 3.5} L ${mx - 3.5} ${my + 3.5}`} stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
                    <title>Hapus kabel</title>
                  </g>
                )}
                <title>{selected ? 'Tarik kabel untuk menambah belokan · tekan Delete atau ✕ untuk melepas' : 'Klik untuk memilih · tarik untuk membelokkan kabel'}</title>
              </g>
            )
          })}

          {/* pending wire */}
          {wiring && (
            <path
              d={wirePath(wiring.from.x, wiring.from.y, hoverNode?.x ?? wiring.x, hoverNode?.y ?? wiring.y, wiring.points)}
              fill="none" stroke={wiring.color} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" opacity="0.9"
            />
          )}

          {selectBox && (
            <rect x={selectBox.x} y={selectBox.y} width={selectBox.w} height={selectBox.h}
              fill="#38bdf8" fillOpacity="0.1" stroke="#0284c7" strokeWidth={1.2 / view.k} strokeDasharray="4 3" pointerEvents="none" />
          )}
        </g>
      </svg>
      {liveGroup.length > 1 && (
        <div role="status" className="absolute top-3 right-3 z-20 rounded-lg border border-sky-200 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-sky-800 shadow">
          {liveGroup.length} komponen dipilih · seret untuk memindah · R putar · Ctrl+C/D salin · Delete hapus · Esc batal
        </div>
      )}

      {/* zoom controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-1 z-10">
        <button
          onClick={() => zoomBy(1.25)}
          className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg shadow-sm text-slate-600 hover:bg-slate-50 text-lg font-bold leading-none"
          title="Perbesar"
        >+</button>
        <button
          onClick={() => zoomBy(1 / 1.25)}
          className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg shadow-sm text-slate-600 hover:bg-slate-50 text-lg font-bold leading-none"
          title="Perkecil"
        >−</button>
        <button
          onClick={zoomFit}
          className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg shadow-sm text-slate-500 hover:bg-slate-50"
          title="Pas ke layar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>

      {/* usage hint */}
      <p className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 text-[10px] text-slate-400 bg-white/80 backdrop-blur px-3 py-1 rounded-full pointer-events-none whitespace-nowrap max-w-full overflow-hidden text-ellipsis">
        Seret komponen ke breadboard · tarik kabel antar titik · tarik badan kabel untuk membelokkan · Shift+seret pilih banyak · R putar · Ctrl+C/V/D salin · Delete hapus · scroll zoom
      </p>
    </div>
  )
}
