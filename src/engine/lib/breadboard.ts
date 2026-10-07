// ============================================================
// KodyUno — Breadboard Geometry
// Half-size breadboard drawn below the Arduino on the simulator
// canvas. 24 columns, rows a–e / f–j, power rails top & bottom.
//
// Electrical model (matches a real breadboard):
//  - each column in block a–e is one net; f–j separately
//  - each power rail row is one continuous net
//  - the center channel isolates the two blocks
// ============================================================

export const BB_COLS = 24
export const BB_PITCH = 14
export const BB_X0 = 106 // x of column 0 holes
export const BB_BODY = { x: 92, y: 456, w: BB_COLS * BB_PITCH + 16, h: 256 }

/**
 * How close a leg or wire endpoint must be to a hole to register as plugged
 * into it — half a hole pitch, on both breadboard and header holes, so a
 * component "looks plugged in" at the same distance it actually is. Shared
 * by boardGeometry.nearestHole, circuitSolver's leg-plug check, and the
 * canvas' own hole-hover test; kept as one constant so those three never
 * drift apart the way they used to (5 / 10 / 14 px, no relation to each
 * other or to BB_PITCH).
 */
export const HOLE_SNAP_RADIUS = BB_PITCH / 2

/** Row id → y coordinate (canvas space). */
export const BB_ROW_Y: Record<string, number> = {
  tp: 474, // top rail +
  tm: 490, // top rail −
  a: 520,
  b: 534,
  c: 548,
  d: 562,
  e: 576,
  f: 604,
  g: 618,
  h: 632,
  i: 646,
  j: 660,
  bm: 682, // bottom rail −
  bp: 698, // bottom rail +
}

export const BB_ROWS_TOP = ['a', 'b', 'c', 'd', 'e'] as const
export const BB_ROWS_BOT = ['f', 'g', 'h', 'i', 'j'] as const
export const BB_RAILS = ['tp', 'tm', 'bm', 'bp'] as const

export interface BBHole {
  id: string // "row:col"
  row: string
  col: number
  x: number
  y: number
  net: string
}

/** Net id for a hole. Rails span the whole row; columns split per block. */
export function bbNet(row: string, col: number): string {
  if (row === 'tp' || row === 'tm' || row === 'bm' || row === 'bp') return `rail:${row}`
  if ((BB_ROWS_TOP as readonly string[]).includes(row)) return `col:t:${col}`
  return `col:b:${col}`
}

function buildBBHoles(): BBHole[] {
  const holes: BBHole[] = []
  const allRows = [...BB_RAILS, ...BB_ROWS_TOP, ...BB_ROWS_BOT]
  for (const row of allRows) {
    for (let col = 0; col < BB_COLS; col++) {
      // real rails skip a hole every 5 — purely cosmetic, keep electrical row intact
      if ((row === 'tp' || row === 'tm' || row === 'bm' || row === 'bp') && col % 6 === 5) continue
      holes.push({
        id: `${row}:${col}`,
        row,
        col,
        x: BB_X0 + col * BB_PITCH,
        y: BB_ROW_Y[row],
        net: bbNet(row, col),
      })
    }
  }
  return holes
}

export const BB_HOLES: BBHole[] = buildBBHoles()
const BB_BY_ID = new Map(BB_HOLES.map((h) => [h.id, h]))
let offset = { x: 0, y: 0 }
export function setBreadboardOffset(value: { x: number; y: number }) { offset = { ...value } }
export function breadboardHoles(): BBHole[] {
  return BB_HOLES.map(h => ({ ...h, x: h.x + offset.x, y: h.y + offset.y }))
}

export function bbHole(id: string): BBHole | undefined {
  const hole = BB_BY_ID.get(id)
  return hole ? { ...hole, x: hole.x + offset.x, y: hole.y + offset.y } : undefined
}

/** Nearest breadboard hole to a point, within `radius`. */
export function nearestBBHole(x: number, y: number, radius = HOLE_SNAP_RADIUS): BBHole | undefined {
  let best: BBHole | undefined
  let bestDist = radius * radius
  for (const h of breadboardHoles()) {
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

/** All net ids on the breadboard (for solver initialization). */
export function allBBNets(): string[] {
  const nets = new Set<string>()
  for (const h of BB_HOLES) nets.add(h.net)
  return [...nets]
}
