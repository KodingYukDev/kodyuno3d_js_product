// Multi-part selection, as in Wokwi/Tinkercad: box-select parts, then move,
// delete, rotate or copy them together. A copied group keeps the wires that
// run between its own parts (with their bends); wires to the board or the
// breadboard stay behind, since the copy lands somewhere else.

import type { BoardComponent, NodeRef, Wire } from '@kodyuno/types'
import { PART_SPECS } from './partSpecs'

export interface Box { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }

/** A box from two corners in any order. */
export const boxFromCorners = (a: Point, b: Point): Box =>
  ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

/** World-space bounds of a part after its rotation (rotation is about its centre). */
export function partBounds(comp: BoardComponent): Box {
  const spec = PART_SPECS[comp.type]
  const pos = comp.pos ?? { x: 0, y: 0 }
  const rot = ((Math.round(comp.rot ?? 0) % 360) + 360) % 360
  const sideways = rot === 90 || rot === 270
  const w = sideways ? spec.h : spec.w, h = sideways ? spec.w : spec.h
  return { x: pos.x + (spec.w - w) / 2, y: pos.y + (spec.h - h) / 2, w, h }
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Parts touched by the selection box (Wokwi selects on overlap, not containment). */
export const partsInBox = (components: BoardComponent[], box: Box): string[] =>
  components.filter(comp => PART_SPECS[comp.type] && overlaps(partBounds(comp), box)).map(comp => comp.id)

const onPart = (ref: NodeRef, ids: Set<string>) => ref.type === 'term' && ids.has(ref.comp)

/** Wires whose both ends sit on parts of the group. */
export const internalWires = (wires: Wire[], ids: Iterable<string>): Wire[] => {
  const set = new Set(ids)
  return wires.filter(wire => onPart(wire.a, set) && onPart(wire.b, set))
}

export interface PartGroup { parts: BoardComponent[]; wires: Wire[] }

/** Snapshot of the selected parts and the wires between them, for the clipboard. */
export function copyGroup(components: BoardComponent[], wires: Wire[], ids: Iterable<string>): PartGroup {
  const set = new Set(ids)
  return structuredClone({ parts: components.filter(comp => set.has(comp.id)), wires: internalWires(wires, set) })
}

/**
 * Fresh copies of a group moved by `offset`: new part ids, wires re-pointed at
 * the new parts, bends shifted along. `newId` is injectable for tests.
 */
export function cloneGroup(group: PartGroup, offset: Point, newId: (source: BoardComponent) => string): PartGroup {
  const ids = new Map<string, string>()
  const parts = group.parts.map(part => {
    const id = newId(part)
    ids.set(part.id, id)
    const pos = part.pos ?? { x: 0, y: 0 }
    return { id, type: part.type, label: part.label, pins: [], pos: { x: pos.x + offset.x, y: pos.y + offset.y },
      ...(part.rot ? { rot: part.rot } : {}), state: structuredClone(part.state) } satisfies BoardComponent
  })
  const remap = (ref: NodeRef): NodeRef => ref.type === 'term' ? { ...ref, comp: ids.get(ref.comp) ?? ref.comp } : ref
  const wires = group.wires.map(wire => ({
    ...wire, id: crypto.randomUUID(), a: remap(wire.a), b: remap(wire.b),
    ...(wire.points ? { points: wire.points.map(p => ({ x: p.x + offset.x, y: p.y + offset.y })) } : {}),
  }))
  return { parts, wires }
}

/**
 * Positions and bends for a group dragged by `delta` from where it started.
 * Bends of wires inside the group travel with it so its wiring keeps shape.
 */
export function movedGroup(start: PartGroup, delta: Point) {
  const positions: Record<string, Point> = {}
  for (const part of start.parts) {
    const pos = part.pos ?? { x: 0, y: 0 }
    positions[part.id] = { x: pos.x + delta.x, y: pos.y + delta.y }
  }
  const bends: Record<string, Point[]> = {}
  for (const wire of start.wires) if (wire.points?.length) bends[wire.id] = wire.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y }))
  return { positions, bends }
}
