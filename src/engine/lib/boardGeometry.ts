// ============================================================
// KodyUno — Board Geometry
//
// Header layout of whichever board is currently on the canvas. The pin
// tables themselves live in lib/boards; this module turns them into canvas
// coordinates and answers the geometric questions the canvas and the
// circuit solver ask ("which hole is under the cursor", "is this ground").
//
// The active board is module state so pure helpers like the circuit solver
// stay call-site simple. The store keeps it in sync via setActiveBoard().
// ============================================================
import type { BoardDef, BoardId, BoardPin } from './boards'
import { BOARDS, BOARD_SCALE, BOARD_X, BOARD_Y, boardSize } from './boards'
import { HOLE_SNAP_RADIUS } from './breadboard'

export { BOARD_SCALE, BOARD_X, BOARD_Y }

export interface Hole {
  pin: number | string
  label: string
  x: number
  y: number
  connectable: boolean
  /** Full pin record, for capability checks and inspector hints. */
  def: BoardPin
}

let active: BoardDef = BOARDS.uno
let offset = { x: 0, y: 0 }
export function setBoardOffset(value: { x: number; y: number }) {
  offset = { ...value }
}
const holeCache = new Map<BoardId, Hole[]>()

function buildHoles(board: BoardDef): Hole[] {
  return board.pins.map((pin) => ({
    pin: pin.id,
    label: pin.label,
    x: BOARD_X + pin.x * BOARD_SCALE,
    y: BOARD_Y + pin.y * BOARD_SCALE,
    connectable: pin.connectable,
    def: pin,
  }))
}

export function holesOf(board: BoardDef): Hole[] {
  let holes = holeCache.get(board.id)
  if (!holes) {
    holes = buildHoles(board)
    holeCache.set(board.id, holes)
  }
  return holes
}

/** Board the canvas and solver are currently working with. */
export function activeBoard(): BoardDef {
  return active
}

export function setActiveBoard(id: BoardId) {
  active = BOARDS[id] ?? BOARDS.uno
}

export function boardHoles(): Hole[] {
  return holesOf(active).map(h => ({ ...h, x: h.x + offset.x, y: h.y + offset.y }))
}

export function connectableHoles(): Hole[] {
  return boardHoles().filter((h) => h.connectable)
}

/** Artwork bounding box of the active board, in canvas units. */
export function boardBox(): { x: number; y: number; w: number; h: number } {
  const { w, h } = boardSize(active)
  return { x: BOARD_X + offset.x, y: BOARD_Y + offset.y, w, h }
}

/** Every pin id that is electrically ground on the active board. */
export function gndIdSet(): Set<string> {
  return new Set(active.pins.filter((p) => p.kind === 'gnd').map((p) => String(p.id)))
}

export function isGndPin(id: number | string): boolean {
  const pin = active.pins.find((p) => String(p.id) === String(id))
  return pin?.kind === 'gnd'
}

/** Nominal voltage of a power rail id, or null when it is not a rail. */
export function railVolts(id: number | string): number | null {
  const pin = active.pins.find((p) => String(p.id) === String(id))
  if (pin?.kind !== 'power') return null
  return pin.volts ?? active.logicVolts
}

/** Every powered header rail, including duplicate labels such as 5V2. */
export function powerRailPins(): BoardPin[] {
  return active.pins.filter((pin) => pin.kind === 'power' && typeof pin.volts === 'number')
}

/** Canonical rail label used by the simulator regardless of physical header id. */
export function canonicalRail(id: number | string): string | null {
  const volts = railVolts(id)
  return volts === null ? null : `${Number.isInteger(volts) ? volts : String(volts)}V`
}

/** Absolute board-space position of a pin hole, or undefined if unknown. */
export function getHoleXY(pin: number | string): { x: number; y: number } | undefined {
  const hole = boardHoles().find((h) => h.pin === pin)
  return hole ? { x: hole.x, y: hole.y } : undefined
}

/** Nearest connectable header hole to a point, within `radius` (canvas units). */
export function nearestHole(x: number, y: number, radius = HOLE_SNAP_RADIUS): Hole | undefined {
  let best: Hole | undefined
  let bestDist = radius * radius
  for (const h of connectableHoles()) {
    const dx = h.x - x
    const dy = h.y - y
    const d = dx * dx + dy * dy
    if (d <= bestDist) {
      bestDist = d
      best = h
    }
  }
  return best
}

/** True when the pin can be driven by analogWrite()/ledcWrite(). */
export function isPwmPin(pin: number | string): boolean {
  return Boolean(active.pins.find((p) => p.id === pin)?.pwm)
}
