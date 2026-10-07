import { Vector3 } from 'three'
import { WORLD_UNITS_PER_MM } from '@kodyuno/lib/partSpecs'

/**
 * The engine keeps its circuit in the 2D canvas space (14 units = one 2.54 mm
 * hole pitch). The 3D scene works in millimetres on the XZ table plane:
 * canvas x → scene x, canvas y → scene z. Every placement, snap and solver
 * rule therefore stays the engine's own; the scene is only a projection.
 */
export const K = WORLD_UNITS_PER_MM

export const mm = (units: number) => units / K
export const units = (millimetres: number) => millimetres * K

export function toScene(x: number, y: number, height = 0, target = new Vector3()): Vector3 {
  return target.set(x / K, height, y / K)
}

export function toCanvas(point: { x: number; z: number }): { x: number; y: number } {
  return { x: point.x * K, y: point.z * K }
}

/** Heights of the physical stack, in mm above the table. */
export const HEIGHT = {
  /** Top face of the breadboard, where legs enter the holes. */
  breadboardTop: 9.5,
  /** Board PCB rests on standoffs. */
  boardStandoff: 3,
  pcb: 1.6,
  /** Female headers on Uno / Mega. */
  femaleHeader: 8.5,
  /** Male pins on Nano / ESP devkits (sticking up for jumpers). */
  malePin: 6,
}

export const boardPcbTop = () => HEIGHT.boardStandoff + HEIGHT.pcb
