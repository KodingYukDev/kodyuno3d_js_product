import type { PartSpec } from '@kodyuno/lib/partSpecs'
import { PART_SPECS } from '@kodyuno/lib/partSpecs'
import type { ComponentType } from '@kodyuno/types'
import type { ReactNode } from 'react'
import { REALISTIC_RENDERERS } from './RealisticPart'

// ============================================================
// Canvas part renderers — each component drawn in its own local
// coordinate space (0..w, 0..h) matching PART_SPECS dimensions.
// Every part renders through REALISTIC_RENDERERS (RealisticPart.tsx):
// either the real vendored Wokwi element for that part, or — for the
// handful of modules Wokwi's own element set doesn't ship (relay, RFID,
// LM35, water sensor, LED matrix) — a hand-drawn stand-in there.
// Terminal positions come from PART_SPECS; the canvas draws the
// interactive terminal dots and wires on top.
// ============================================================

export interface PartMeta extends PartSpec {
  render: (state: Record<string, unknown>, uid: string) => ReactNode
}

export const PART_META: Record<ComponentType, PartMeta> = Object.fromEntries(
  (Object.keys(PART_SPECS) as ComponentType[]).map((type) => [
    type,
    { ...PART_SPECS[type], render: REALISTIC_RENDERERS[type] ?? (() => null) },
  ])
) as Record<ComponentType, PartMeta>
