import type { NodeRef } from '../types'

/** Physical endpoint identity, deliberately distinct from electrical net identity. */
export function endpointId(ref: NodeRef): string {
  if (ref.type === 'pin') return `P:${ref.pin}`
  if (ref.type === 'hole') return `H:${ref.hole}`
  return `T:${ref.comp}:${ref.role}`
}
