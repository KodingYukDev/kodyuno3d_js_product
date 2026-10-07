import { BOARDS } from './boards'
import { PART_SPECS } from './partSpecs'
import { BB_HOLES } from './breadboard'
import { parseUnoHex } from './firmware/avrUno.mjs'
import { validateExtraFiles } from './sketchFiles'
import type { BoardComponent, BoardType, NodeRef, Wire } from '@kodyuno/types'

export interface ProjectDocument {
  format: 'kodyuno-project'
  version: 1
  boardType: BoardType
  boardOffset?: { x: number; y: number }
  breadboardOffset?: { x: number; y: number }
  sketchCode: string
  /** Extra sketch files and libraries.txt (absent in projects saved before multi-file). */
  files?: Record<string, string>
  components: BoardComponent[]
  wires: Wire[]
  firmware?: ProjectFirmware
}

export interface ProjectFirmware {
  version: 1
  format: 'intel-hex'
  boardType: 'uno'
  name: string
  hex: string
}

export const MAX_FIRMWARE_BYTES = 100_000

/** HEX cannot identify its compilation target; require explicit Uno metadata. */
export function validateProjectFirmware(value: unknown, boardType: BoardType): ProjectFirmware {
  if (!object(value) || value.version !== 1 || value.format !== 'intel-hex'
    || value.boardType !== 'uno' || boardType !== 'uno'
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255
    || /[\u0000-\u001f\u007f]/.test(value.name) || typeof value.hex !== 'string') return fail()
  if (value.hex.length > MAX_FIRMWARE_BYTES || new TextEncoder().encode(value.hex).length > MAX_FIRMWARE_BYTES) {
    throw new Error('HEX melebihi batas 100 KB.')
  }
  parseUnoHex(value.hex)
  return { version: 1, format: 'intel-hex', boardType: 'uno', name: value.name, hex: value.hex }
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const point = (v: unknown): boolean => object(v) && typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y)
const fail = (): never => { throw new Error('Project KodyUno tidak valid atau versinya belum didukung.') }

/** Validate the entire document before replacing live state. Runtime state is discarded. */
export function parseProject(text: string): ProjectDocument {
  if (text.length > 5_000_000) throw new Error('Project melebihi batas 5 MB.')
  const input: unknown = JSON.parse(text)
  if (!object(input) || input.format !== 'kodyuno-project' || input.version !== 1
    || typeof input.boardType !== 'string' || !Object.hasOwn(BOARDS, input.boardType)
    || typeof input.sketchCode !== 'string' || !Array.isArray(input.components) || !Array.isArray(input.wires)
    || input.components.length > 500 || input.wires.length > 5000) return fail()
  const boardType = input.boardType as BoardType
  const firmware = input.firmware === undefined ? undefined : validateProjectFirmware(input.firmware, boardType)
  let files: Record<string, string> | undefined
  try { files = input.files === undefined ? undefined : validateExtraFiles(input.files) } catch { return fail() }
  if (input.boardOffset !== undefined && !point(input.boardOffset)) return fail()
  if (input.breadboardOffset !== undefined && !point(input.breadboardOffset)) return fail()
  const ids = new Set<string>()
  const components = input.components.map((c): BoardComponent => {
    if (!object(c) || typeof c.id !== 'string' || !c.id || ids.has(c.id)
      || typeof c.type !== 'string' || !Object.hasOwn(PART_SPECS, c.type)
      || typeof c.label !== 'string' || !object(c.state)
      || (c.pos !== undefined && !point(c.pos))
      || (c.rot !== undefined && ![0, 90, 180, 270].includes(Number(c.rot)))) return fail()
    ids.add(c.id)
    return { id: c.id, type: c.type as BoardComponent['type'], label: c.label, state: c.state,
      pins: [], pos: c.pos as BoardComponent['pos'], rot: c.rot === undefined ? 0 : Number(c.rot) }
  })
  const node = (value: unknown): NodeRef => {
    if (!object(value)) return fail()
    if (value.type === 'pin' && BOARDS[boardType].pins.some(p => p.id === value.pin && p.connectable)) return { type: 'pin', pin: value.pin as number | string }
    if (value.type === 'hole' && typeof value.hole === 'string' && BB_HOLES.some(h => h.id === value.hole)) return { type: 'hole', hole: value.hole }
    if (value.type === 'term' && typeof value.comp === 'string' && typeof value.role === 'string') {
      const component = components.find(c => c.id === value.comp)
      if (component && PART_SPECS[component.type].terminals.some(t => t.role === value.role)) return { type: 'term', comp: value.comp, role: value.role }
    }
    return fail()
  }
  const wireIds = new Set<string>()
  const wires = input.wires.map((w): Wire => {
    if (!object(w) || typeof w.id !== 'string' || !w.id || wireIds.has(w.id)
      || typeof w.color !== 'string' || !/^#[\da-f]{6}$/i.test(w.color)
      || (w.points !== undefined && (!Array.isArray(w.points) || w.points.length > 100 || !w.points.every(point)))
      || (w.style !== undefined && w.style !== 'orthogonal' && w.style !== 'straight' && w.style !== 'curved')) return fail()
    wireIds.add(w.id)
    return { id: w.id, a: node(w.a), b: node(w.b), color: w.color, points: w.points as Wire['points'],
      ...(w.style ? { style: w.style as Wire['style'] } : {}) }
  })
  return { format: 'kodyuno-project', version: 1, boardType,
    ...(input.boardOffset ? { boardOffset: input.boardOffset as { x: number; y: number } } : {}),
    ...(input.breadboardOffset ? { breadboardOffset: input.breadboardOffset as { x: number; y: number } } : {}),
    sketchCode: input.sketchCode, ...(files && Object.keys(files).length ? { files } : {}), components, wires, ...(firmware ? { firmware } : {}) }
}

export function serializeProject(state: Pick<ProjectDocument, 'boardType' | 'boardOffset' | 'breadboardOffset' | 'sketchCode' | 'files' | 'components' | 'wires' | 'firmware'>): string {
  if (state.firmware !== undefined) validateProjectFirmware(state.firmware, state.boardType)
  return JSON.stringify({ format: 'kodyuno-project', version: 1, ...state,
    components: state.components.map(c => ({ id: c.id, type: c.type, label: c.label, state: c.state, pos: c.pos, rot: c.rot })),
  }, null, 2)
}
