export interface WirePoint { x: number; y: number }

/**
 * How a wire is drawn between its endpoints and user bends.
 * - orthogonal: horizontal/vertical runs with automatic elbows (Wokwi).
 * - straight: straight segments straight through each bend (Tinkercad).
 * - curved: a smooth curve through each bend (Tinkercad "curvy").
 * Crossings are visual only in every style — never electrical junctions.
 */
export type WireStyle = 'orthogonal' | 'straight' | 'curved'

export const WIRE_STYLES: WireStyle[] = ['orthogonal', 'straight', 'curved']

/** The user-controlled points of a wire: endpoint, bends, endpoint. */
function controls(a: WirePoint, b: WirePoint, bends: WirePoint[]) {
  return [a, ...bends, b]
}

/** Polyline the wire follows (for curved wires, the control polygon). */
export function wireRoute(a: WirePoint, b: WirePoint, bends: WirePoint[] = [], style: WireStyle = 'orthogonal'): WirePoint[] {
  if (style !== 'orthogonal') return controls(a, b, bends)
  if (bends.length === 0) {
    const mid = (a.y + b.y) / 2
    return [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]
  }
  const result = [a]
  for (const target of [...bends, b]) {
    const previous = result[result.length - 1]
    if (previous.x !== target.x && previous.y !== target.y) result.push({ x: target.x, y: previous.y })
    result.push(target)
  }
  return result
}

export function wireSvgPath(a: WirePoint, b: WirePoint, bends: WirePoint[] = [], style: WireStyle = 'orthogonal'): string {
  if (style === 'curved') return curvedPath(controls(a, b, bends))
  return wireRoute(a, b, bends, style).map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
}

/**
 * Catmull-Rom spline through every control point, written as cubic Beziers.
 * A bare two-point wire gets a gentle sag so it still reads as a cable.
 */
function curvedPath(points: WirePoint[]): string {
  if (points.length === 2) {
    const [a, b] = points
    const sag = Math.min(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.2)
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + sag} ${b.x} ${b.y + sag} ${b.x} ${b.y}`
  }
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`
  }
  return d
}

function distanceToSegment(p: WirePoint, a: WirePoint, b: WirePoint) {
  const dx = b.x - a.x, dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Where a new bend grabbed at `p` belongs in the wire's `points` array: the
 * index of the control span (endpoint/bend to next bend/endpoint) whose drawn
 * route passes closest to `p`. Inserting there keeps the other bends in order.
 */
export function bendInsertIndex(a: WirePoint, b: WirePoint, bends: WirePoint[], p: WirePoint, style: WireStyle = 'orthogonal'): number {
  const points = controls(a, b, bends)
  let best = 0, bestDistance = Infinity
  for (let span = 0; span < points.length - 1; span++) {
    // Curved wires are hit-tested against their control polygon: close enough
    // for picking a span, and the bend lands where the pointer is anyway.
    const spanRoute = style !== 'orthogonal' ? [points[span], points[span + 1]]
      : bends.length === 0 ? wireRoute(a, b, [], 'orthogonal')
      : elbow(points[span], points[span + 1])
    for (let i = 0; i < spanRoute.length - 1; i++) {
      const distance = distanceToSegment(p, spanRoute[i], spanRoute[i + 1])
      if (distance < bestDistance) { bestDistance = distance; best = span }
    }
  }
  return best
}

/** The single-elbow run wireRoute draws between two consecutive controls. */
function elbow(from: WirePoint, to: WirePoint): WirePoint[] {
  return from.x !== to.x && from.y !== to.y ? [from, { x: to.x, y: from.y }, to] : [from, to]
}

/** Point halfway along the drawn route — where the delete button sits. */
export function routeMidpoint(a: WirePoint, b: WirePoint, bends: WirePoint[] = [], style: WireStyle = 'orthogonal'): WirePoint {
  const route = wireRoute(a, b, bends, style)
  const lengths = route.slice(1).map((point, i) => Math.hypot(point.x - route[i].x, point.y - route[i].y))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const t = remaining / lengths[i]
      return { x: route[i].x + (route[i + 1].x - route[i].x) * t, y: route[i].y + (route[i + 1].y - route[i].y) * t }
    }
    remaining -= lengths[i]
  }
  return route[0]
}

/** Snap to the breadboard hole grid, like bends in Wokwi. */
export function snapPoint(p: WirePoint, pitch: number, origin: WirePoint = { x: 0, y: 0 }): WirePoint {
  return {
    x: origin.x + Math.round((p.x - origin.x) / pitch) * pitch,
    y: origin.y + Math.round((p.y - origin.y) / pitch) * pitch,
  }
}
