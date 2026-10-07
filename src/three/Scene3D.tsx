import { useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping, AmbientLight, MOUSE, TOUCH, Box3, Box3Helper, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Plane, PlaneGeometry, PMREMGenerator, Raycaster,
  RepeatWrapping, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Intersection, type Object3D,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { getBoard } from '@kodyuno/lib/boards'
import { boardBox, connectableHoles, isGndPin, nearestHole as nearestArduinoHole, railVolts, setActiveBoard, setBoardOffset } from '@kodyuno/lib/boardGeometry'
import { BB_BODY, BB_HOLES, BB_PITCH, HOLE_SNAP_RADIUS, breadboardHoles, nearestBBHole } from '@kodyuno/lib/breadboard'
import { PART_SPECS, rotatedTerminal } from '@kodyuno/lib/partSpecs'
import { nodeKey, pinKey, termKey } from '@kodyuno/lib/circuitSolver'
import { endpointId } from '@kodyuno/lib/wireEndpoints'
import { ledAppearance, multimeterReadings } from '@kodyuno/lib/dcSolver'
import { boardLedOn } from '@kodyuno/lib/boardLed'
import { snapPoint } from '@kodyuno/lib/wireGeometry'
import type { BoardComponent, NodeRef, Wire } from '@kodyuno/types'
import { createBoard, createBreadboard, onTextureReady, setMaxAnisotropy, type BoardObject } from './boardModels'
import { createPart, type PartObject, type PartPick } from './partModels'
import { createNodeMarker, createWire, wirePath, type WireEnd, type WireObject } from './wireModels'
import { HEIGHT, K, boardPcbTop, mm, toCanvas } from './units'
import { renderSettings, setTextureQuality, type Quality } from './quality'

// ------------------------------------------------------------ node universe

interface Node {
  ref: NodeRef
  key: string
  x: number
  y: number
  label: string
}

const BASE_SNAP = 9 // canvas units: how close a click must be to a hole / terminal (fingers get 1.6×)

function partLabel(comp: BoardComponent, role: string) {
  return `${comp.label} · ${role}`
}

function buildNodes(components: BoardComponent[]): Node[] {
  const nodes: Node[] = []
  for (const h of connectableHoles()) nodes.push({ ref: { type: 'pin', pin: h.pin }, key: pinKey(h.pin), x: h.x, y: h.y, label: `Pin ${h.label}` })
  for (const h of breadboardHoles()) nodes.push({ ref: { type: 'hole', hole: h.id }, key: endpointId({ type: 'hole', hole: h.id }), x: h.x, y: h.y, label: holeLabel(h.row, h.col) })
  for (const comp of components) {
    const spec = PART_SPECS[comp.type]
    if (!spec || !comp.pos) continue
    for (const t of spec.terminals) {
      const off = rotatedTerminal(spec, t, comp.rot)
      nodes.push({ ref: { type: 'term', comp: comp.id, role: t.role }, key: termKey(comp.id, t.role), x: comp.pos.x + off.dx, y: comp.pos.y + off.dy, label: partLabel(comp, t.role) })
    }
  }
  return nodes
}

function holeLabel(row: string, col: number) {
  const rail: Record<string, string> = { tp: 'Rel + atas', tm: 'Rel − atas', bm: 'Rel − bawah', bp: 'Rel + bawah' }
  return rail[row] ? `${rail[row]} · ${col + 1}` : `Breadboard ${row}${col + 1}`
}

function nearest(nodes: Node[], x: number, y: number, radius: number, filter?: (node: Node) => boolean, exclude?: string): Node | undefined {
  let best: Node | undefined
  let bestD = radius * radius
  for (const node of nodes) {
    if (node.key === exclude || (filter && !filter(node))) continue
    const d = (node.x - x) ** 2 + (node.y - y) ** 2
    if (d <= bestD) { bestD = d; best = node }
  }
  return best
}

function wireColorFor(node: Node, components: BoardComponent[]): string {
  if (node.ref.type === 'pin') {
    if (isGndPin(node.ref.pin)) return '#1e293b'
    if (railVolts(node.ref.pin) !== null) return '#dc2626'
    return '#16a34a'
  }
  if (node.ref.type === 'term') {
    const { comp: id, role } = node.ref
    const comp = components.find(c => c.id === id)
    return (comp && PART_SPECS[comp.type].terminals.find(t => t.role === role)?.color) ?? '#16a34a'
  }
  const hole = BB_HOLES.find(h => h.id === (node.ref as { hole: string }).hole)
  if (hole?.row === 'tp' || hole?.row === 'bp') return '#dc2626'
  if (hole?.row === 'tm' || hole?.row === 'bm') return '#1e293b'
  return '#16a34a'
}

// ------------------------------------------------------------ physical placement

const FEMALE_BOARDS = new Set(['uno', 'mega'])

function inside(x: number, y: number, box: { x: number; y: number; w: number; h: number }) {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
}

function breadboardBox() {
  const { breadboardOffset: o } = useKodyUnoStore.getState()
  return { x: BB_BODY.x + o.x, y: BB_BODY.y + o.y, w: BB_BODY.w, h: BB_BODY.h }
}

/** Height (mm) of the surface a part rests on. */
function baseHeight(comp: BoardComponent): number {
  const spec = PART_SPECS[comp.type]
  if (!comp.pos || !spec) return 0
  const legs = spec.terminals.filter(t => t.leg)
  if (spec.pluggable && legs.length) {
    const leg = rotatedTerminal(spec, legs[0], comp.rot)
    const x = comp.pos.x + leg.dx, y = comp.pos.y + leg.dy
    if (nearestBBHole(x, y, HOLE_SNAP_RADIUS)) return HEIGHT.breadboardTop
    if (nearestArduinoHole(x, y, HOLE_SNAP_RADIUS)) return headerTop()
  }
  const cx = comp.pos.x + spec.w / 2, cy = comp.pos.y + spec.h / 2
  if (inside(cx, cy, breadboardBox())) return HEIGHT.breadboardTop
  if (inside(cx, cy, boardBox())) return headerTop()
  return 0
}

function headerTop() {
  const female = FEMALE_BOARDS.has(useKodyUnoStore.getState().boardType)
  return boardPcbTop() + (female ? HEIGHT.femaleHeader : HEIGHT.malePin)
}

/** Where wires plug into a header pin (inside the socket, or on the male pin tip). */
function pinAnchor() {
  const female = FEMALE_BOARDS.has(useKodyUnoStore.getState().boardType)
  return boardPcbTop() + (female ? HEIGHT.femaleHeader : 2.5)
}

// ------------------------------------------------------------ cutting mat

function matTexture(): CanvasTexture {
  // One tile = 50 mm: five 10 mm cells, major line on the tile edge.
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#14392f'
  ctx.fillRect(0, 0, size, size)
  const noise = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10
    noise.data[i] += n; noise.data[i + 1] += n; noise.data[i + 2] += n
  }
  ctx.putImageData(noise, 0, 0)
  ctx.strokeStyle = 'rgba(200,232,214,.10)'
  ctx.lineWidth = 2
  for (let i = 1; i < 5; i++) {
    const p = (i * size) / 5
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(200,232,214,.22)'
  ctx.lineWidth = 3
  ctx.strokeRect(0, 0, size, size)
  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 16
  return texture
}

function backdrop(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 512)
  g.addColorStop(0, '#1e293b')
  g.addColorStop(1, '#0b1220')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 512)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

// ------------------------------------------------------------ component

export interface Scene3DHandle {
  resetView(): void
  topView(): void
  pan(right: number, forward: number): void
  zoom(factor: number): void
  turn(angle: number): void
}

interface Props {
  quality: Quality
  onReady?: (handle: Scene3DHandle) => void
}

interface Hover { text: string; x: number; y: number }

export function Scene3D({ quality, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const qualityRef = useRef(quality)
  setTextureQuality(quality)
  const [hover, setHover] = useState<Hover | null>(null)
  const [wiringActive, setWiringActive] = useState(false)
  const [selectedWire, setSelectedWire] = useState<string | null>(null)
  const selectedWireRef = useRef<string | null>(null)
  const wires = useKodyUnoStore(s => s.wires)
  const circuitFaults = useKodyUnoStore(s => s.circuitFaults)
  const updateWire = useKodyUnoStore(s => s.updateWire)
  const removeWire = useKodyUnoStore(s => s.removeWire)
  useEffect(() => { qualityRef.current = quality }, [quality])
  useEffect(() => { selectedWireRef.current = selectedWire }, [selectedWire])
  const cancelWiringRef = useRef<() => void>(() => {})

  useEffect(() => {
    const host = hostRef.current!
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    // shadows are re-rendered only on frames that need them (see loop)
    renderer.shadowMap.autoUpdate = false
    renderer.domElement.className = 'block h-full w-full touch-none'
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy())
    host.append(renderer.domElement)

    const scene = new Scene()
    scene.background = backdrop()
    const pmrem = new PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.4

    const camera = new PerspectiveCamera(38, 1, 2, 5000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 25
    controls.maxDistance = 900
    controls.screenSpacePanning = false
    controls.zoomToCursor = true
    controls.panSpeed = 1.1
    controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
    controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }

    scene.add(new HemisphereLight('#e0f2fe', '#1e293b', 0.4), new AmbientLight('#ffffff', 0.15))
    const sun = new DirectionalLight('#fff7ed', 1.5)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    sun.shadow.radius = 3
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.4
    const shadowCam = sun.shadow.camera
    shadowCam.left = -220; shadowCam.right = 220; shadowCam.top = 220; shadowCam.bottom = -220; shadowCam.near = 10; shadowCam.far = 900
    scene.add(sun, sun.target)

    const mat = matTexture()
    mat.repeat.set(32, 32)
    const table = new Mesh(new PlaneGeometry(1600, 1600), new MeshStandardMaterial({ map: mat, roughness: 0.92 }))
    table.rotation.x = -Math.PI / 2
    table.receiveShadow = true
    table.userData.pick = { kind: 'table' }
    scene.add(table)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const aoPass = new GTAOPass(scene, camera, 512, 512)
    aoPass.updateGtaoMaterial({ radius: 6, distanceExponent: 1.2, thickness: 4, scale: 1 })
    aoPass.blendIntensity = 0.85
    composer.addPass(aoPass)
    const bloomPass = new UnrealBloomPass(new Vector2(256, 256), 0.6, 0.3, 1.6)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    // ---------------------------------------------------------- objects
    const world = new Group()
    scene.add(world)
    const breadboard = createBreadboard()
    world.add(breadboard)
    let board: BoardObject | null = null
    let boardType = ''
    interface PartEntry { object: PartObject; comp: BoardComponent; base: number; lookKey: string }
    const parts = new Map<string, PartEntry>()
    /** Last store snapshot the scene was synced to (identity checks skip unchanged work). */
    let seen: Partial<ReturnType<typeof useKodyUnoStore.getState>> = {}
    /** Part being dragged: drawn here, written to the store once on release. */
    let ghost: { id: string; pos: { x: number; y: number } } | null = null
    const wireObjects = new Map<string, { object: WireObject; key: string }>()
    const selection = new Box3Helper(new Box3(), new Color('#f59e0b'))
    selection.visible = false
    scene.add(selection)
    const marker = createNodeMarker()
    scene.add(marker)
    let pending: WireObject | null = null

    let dirty = true
    let nodes: Node[] = []
    const markDirty = () => { dirty = true }
    controls.addEventListener('change', markDirty)

    const syncBoard = () => {
      const state = useKodyUnoStore.getState()
      setActiveBoard(state.boardType)
      setBoardOffset(state.boardOffset)
      const def = getBoard(state.boardType)
      if (state.boardType !== boardType) {
        if (board) { world.remove(board.group); board.dispose() }
        board = createBoard(def)
        board.group.traverse(o => { o.userData.onArt = markDirty })
        world.add(board.group)
        boardType = state.boardType
      }
      board!.group.position.set(mm(state.boardOffset.x), 0, mm(state.boardOffset.y))
      if (state.pins !== seen.pins || state.runState !== seen.runState || state.boardType !== seen.boardType) {
        const powered = state.runState === 'running' || state.runState === 'paused'
        board!.setLeds(boardLedOn(def, state.pins, powered), state.runState === 'running')
      }
      breadboard.position.set(mm(state.breadboardOffset.x), 0, mm(state.breadboardOffset.y))
    }

    /** Where a part is drawn: the drag ghost wins over the store while dragging. */
    const posOf = (comp: BoardComponent) => (ghost?.id === comp.id ? ghost.pos : comp.pos)

    const placePart = (entry: PartEntry, comp: BoardComponent) => {
      const spec = PART_SPECS[comp.type]
      const pos = posOf(comp) ?? { x: 0, y: 0 }
      entry.base = baseHeight({ ...comp, pos })
      entry.object.group.position.set(mm(pos.x + spec.w / 2), entry.base, mm(pos.y + spec.h / 2))
      entry.object.group.rotation.y = -((comp.rot ?? 0) * Math.PI) / 180
    }

    const frameSelection = () => {
      const id = useKodyUnoStore.getState().selectedComponentId
      const selected = id ? parts.get(id) : undefined
      if (selected) {
        selection.box.setFromObject(selected.object.group).expandByScalar(1.2)
        selection.visible = true
      } else selection.visible = false
    }

    let looks: Record<string, Record<string, unknown>> = {}
    let meters: Record<string, number | null> = {}
    const syncParts = () => {
      const state = useKodyUnoStore.getState()
      const circuitChanged = state.components !== seen.components || state.pins !== seen.pins || state.circuitIndex !== seen.circuitIndex
      if (circuitChanged) {
        looks = ledAppearance(state.components, state.circuitIndex.netOf, state.pins)
        meters = state.components.some(c => c.type === 'multimeter') ? multimeterReadings(state.components, state.circuitIndex.netOf, state.pins) : {}
      }
      const offsetsChanged = state.boardOffset !== seen.boardOffset || state.breadboardOffset !== seen.breadboardOffset || state.boardType !== seen.boardType
      const alive = new Set<string>()
      for (const comp of state.components) {
        alive.add(comp.id)
        let entry = parts.get(comp.id)
        if (!entry) {
          entry = { object: createPart(comp), comp, base: -1, lookKey: '' }
          parts.set(comp.id, entry)
          world.add(entry.object.group)
          placePart(entry, comp)
        } else if (entry.comp.pos !== comp.pos || entry.comp.rot !== comp.rot || offsetsChanged) placePart(entry, comp)
        const led = looks[comp.id]
        const lookKey = comp.type === 'multimeter' ? String(meters[comp.id]) : led ? JSON.stringify(led) : ''
        if (entry.comp.state !== comp.state || entry.lookKey !== lookKey || entry.base < 0) {
          const look = comp.type === 'multimeter' ? { ...comp.state, reading: meters[comp.id] } : led ? { ...comp.state, ...led } : comp.state
          entry.object.update(look)
          entry.lookKey = lookKey
        }
        entry.comp = comp
      }
      for (const [id, entry] of parts) {
        if (alive.has(id)) continue
        world.remove(entry.object.group)
        entry.object.dispose()
        parts.delete(id)
      }
      frameSelection()
    }

    const endpoint = (ref: NodeRef): WireEnd | null => {
      if (ref.type === 'pin') {
        const hole = connectableHoles().find(h => h.pin === ref.pin)
        return hole ? { x: hole.x, y: hole.y, h: pinAnchor() } : null
      }
      if (ref.type === 'hole') {
        const hole = breadboardHoles().find(h => h.id === ref.hole)
        return hole ? { x: hole.x, y: hole.y, h: HEIGHT.breadboardTop } : null
      }
      const entry = parts.get(ref.comp)
      const comp = entry?.comp
      const pos = comp && posOf(comp)
      if (!entry || !comp || !pos) return null
      const spec = PART_SPECS[comp.type]
      const t = spec.terminals.find(term => term.role === ref.role)
      if (!t) return null
      const off = rotatedTerminal(spec, t, comp.rot)
      return { x: pos.x + off.dx, y: pos.y + off.dy, h: entry.base + entry.object.terminalHeight(ref.role) }
    }

    const hotRoots = () => {
      const state = useKodyUnoStore.getState()
      const roots = new Set<string>()
      for (const [key, root] of Object.entries(state.circuitIndex.netOf)) {
        if (!key.startsWith('P:')) continue
        const id = key.slice(2)
        if (railVolts(id) !== null) { roots.add(root); continue }
        const pin = state.pins.find(p => String(p.pin) === id)
        if (pin && (pin.value === 1 || pin.pwm > 0)) roots.add(root)
      }
      return roots
    }
    let hot = new Set<string>()

    const syncWires = () => {
      const state = useKodyUnoStore.getState()
      const alive = new Set<string>()
      for (const wire of state.wires) {
        const a = endpoint(wire.a), b = endpoint(wire.b)
        if (!a || !b) continue
        alive.add(wire.id)
        const key = JSON.stringify([a, b, wire.points, wire.style, wire.color])
        const existing = wireObjects.get(wire.id)
        if (existing?.key === key) continue
        if (existing) { world.remove(existing.object.group); existing.object.dispose() }
        const object = createWire(wire.id, wire.color, wirePath(a, b, wire.points, wire.style), wire.style === 'curved')
        world.add(object.group)
        wireObjects.set(wire.id, { object, key })
      }
      for (const [id, entry] of wireObjects) {
        if (alive.has(id)) continue
        world.remove(entry.object.group)
        entry.object.dispose()
        wireObjects.delete(id)
      }
      if (state.pins === seen.pins && state.circuitIndex === seen.circuitIndex && state.wires === seen.wires) {
        for (const [id, entry] of wireObjects) entry.object.setSelected(id === selectedWireRef.current)
        return
      }
      const roots = hotRoots()
      hot = new Set(state.wires.filter(w => { const k = nodeKey(w.a); return k ? roots.has(state.circuitIndex.netOf[k] ?? k) : false }).map(w => w.id))
      for (const [id, entry] of wireObjects) entry.object.setSelected(id === selectedWireRef.current)
    }

    const syncAll = () => {
      const state = useKodyUnoStore.getState()
      syncBoard()
      syncParts()
      syncWires()
      if (state.components !== seen.components || state.boardOffset !== seen.boardOffset || state.breadboardOffset !== seen.breadboardOffset || state.boardType !== seen.boardType) {
        nodes = buildNodes(state.components)
      }
      seen = state
      dirty = true
    }

    /** Drag frame: move only the dragged part and the wires on it. */
    const syncGhost = () => {
      if (!ghost) return
      const entry = parts.get(ghost.id)
      if (!entry) return
      placePart(entry, entry.comp)
      frameSelection()
      syncWires()
      dirty = true
    }

    let pendingSync = true
    let ghostMoved = false
    let pendingOffset: { kind: 'board' | 'breadboard'; at: { x: number; y: number } } | null = null
    const unsubscribe = useKodyUnoStore.subscribe(() => { pendingSync = true })

    // ---------------------------------------------------------- camera framing
    const frame = (top: boolean) => {
      const bb = breadboardBox(), bx = boardBox()
      const minX = Math.min(bb.x, bx.x), maxX = Math.max(bb.x + bb.w, bx.x + bx.w)
      const minY = Math.min(bb.y, bx.y), maxY = Math.max(bb.y + bb.h, bx.y + bx.h)
      const center = new Vector3(mm((minX + maxX) / 2), 0, mm((minY + maxY) / 2))
      const size = Math.max(mm(maxX - minX), mm(maxY - minY))
      controls.target.copy(center)
      const distance = size * 1.9 + 40
      if (top) camera.position.set(center.x, distance * 1.05, center.z + 0.01)
      else camera.position.set(center.x - distance * 0.12, distance * 0.78, center.z + distance * 0.72)
      sun.position.set(center.x - 120, 320, center.z + 160)
      sun.target.position.copy(center)
      controls.update()
      dirty = true
    }
    const pan = (right: number, forward: number) => {
      const distance = camera.position.distanceTo(controls.target)
      const step = distance * 0.12
      const ahead = new Vector3().subVectors(controls.target, camera.position).setY(0)
      if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1)
      ahead.normalize()
      const side = new Vector3(-ahead.z, 0, ahead.x)
      const move = side.multiplyScalar(right * step).add(ahead.multiplyScalar(forward * step))
      controls.target.add(move)
      camera.position.add(move)
      dirty = true
    }
    const zoom = (factor: number) => {
      const offset = new Vector3().subVectors(camera.position, controls.target)
      const length = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor))
      camera.position.copy(controls.target).add(offset.setLength(length))
      dirty = true
    }
    const turn = (angle: number) => {
      const offset = new Vector3().subVectors(camera.position, controls.target)
      offset.applyAxisAngle(new Vector3(0, 1, 0), angle)
      camera.position.copy(controls.target).add(offset)
      dirty = true
    }
    onReady?.({ resetView: () => frame(false), topView: () => frame(true), pan, zoom, turn })
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__kodyuno3d = { camera, renderer, toScreen: (x: number, y: number, h: number) => { const v = new Vector3(mm(x), h, mm(y)).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height } } }

    // ---------------------------------------------------------- picking
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const pickables = () => [world, table]

    const cast = (event: PointerEvent | MouseEvent): Intersection<Object3D> | undefined => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObjects(pickables(), true).find(hit => hit.object.userData.pick && hit.object.visible)
    }
    const castPlane = (event: PointerEvent, height: number): Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      return raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -height), new Vector3())
    }

    if (import.meta.env.DEV) Object.assign((window as unknown as { __kodyuno3d: object }).__kodyuno3d, { pickAt: (x: number, y: number) => cast({ clientX: x, clientY: y } as MouseEvent)?.object.userData.pick })

    /** Node a hit refers to: only holes/terminals on the surface that was hit. */
    let touchScale = 1
    const nodeAt = (hit: Intersection<Object3D>, exclude?: string): Node | undefined => {
      const pick = hit.object.userData.pick as { kind: string; id?: string }
      const p = toCanvas(hit.point)
      const SNAP = BASE_SNAP * touchScale
      if (pick.kind === 'part') return nearest(nodes, p.x, p.y, SNAP * 0.75, n => n.ref.type === 'term' && n.ref.comp === pick.id, exclude)
      if (pick.kind === 'breadboard') return nearest(nodes, p.x, p.y, SNAP, n => n.ref.type !== 'pin', exclude)
      if (pick.kind === 'board') return nearest(nodes, p.x, p.y, SNAP, n => n.ref.type === 'pin', exclude)
      return undefined
    }

    // ---------------------------------------------------------- interaction state
    type Drag =
      | { kind: 'part'; id: string; height: number; off: { x: number; y: number }; moved: boolean }
      | { kind: 'board' | 'breadboard'; height: number; off: { x: number; y: number } }
      | { kind: 'press'; id: string }
      | { kind: 'knob'; id: string; startX: number; startY: number; start: Record<string, unknown> }
    let drag: Drag | null = null
    let wiring: { from: Node; color: string; points: { x: number; y: number }[]; cursor: { x: number; y: number; h: number } } | null = null
    let down: { x: number; y: number } | null = null

    const showPending = () => {
      if (pending) { world.remove(pending.group); pending.dispose(); pending = null }
      if (!wiring) return
      const a = endpoint(wiring.from.ref)
      if (!a) return
      const b = { ...wiring.cursor, h: wiring.cursor.h }
      pending = createWire('pending', wiring.color, wirePath(a, b, wiring.points, 'orthogonal'), false)
      pending.material.transparent = true
      pending.material.opacity = 0.7
      pending.group.traverse(o => { delete o.userData.pick })
      world.add(pending.group)
      dirty = true
    }
    const endWiring = () => {
      wiring = null
      marker.visible = false
      showPending()
      setWiringActive(false)
      dirty = true
    }
    cancelWiringRef.current = endWiring

    const snapBend = (p: { x: number; y: number }, free: boolean) => {
      if (free) return p
      const origin = breadboardHoles()[0] ?? { x: 0, y: 0 }
      return snapPoint(p, BB_PITCH / 2, origin)
    }

    const snapTarget = (comp: BoardComponent): { x: number; y: number } | null => {
      const spec = PART_SPECS[comp.type]
      if (!spec?.pluggable || !comp.pos) return null
      const legs = spec.terminals.filter(t => t.leg).map(t => rotatedTerminal(spec, t, comp.rot))
      if (!legs.length) return null
      const l0 = legs[0]
      const ax = comp.pos.x + l0.dx, ay = comp.pos.y + l0.dy
      const target = nearestBBHole(ax, ay, 12) ?? nearestArduinoHole(ax, ay, 12)
      if (!target) return null
      const nx = target.x - l0.dx, ny = target.y - l0.dy
      const ok = legs.slice(1).every(t => nearestBBHole(nx + t.dx, ny + t.dy, HOLE_SNAP_RADIUS) || nearestArduinoHole(nx + t.dx, ny + t.dy, HOLE_SNAP_RADIUS))
      return ok ? { x: nx, y: ny } : null
    }

    const knobPatch = (comp: BoardComponent, dx: number, dy: number, start: Record<string, unknown>): Record<string, unknown> => {
      const n = (v: unknown, f: number) => (typeof v === 'number' ? v : f)
      const clamp = (v: number) => Math.max(0, Math.min(1023, Math.round(v)))
      if (comp.type === 'potentiometer') return { value: clamp(n(start.value, 512) + (dx - dy) * 4) }
      if (comp.type === 'joystick') return { x: clamp(512 + dx * 6), y: clamp(512 + dy * 6) }
      return {}
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      touchScale = event.pointerType === 'touch' ? 1.6 : 1
      down = { x: event.clientX, y: event.clientY }
      const hit = cast(event)
      const store = useKodyUnoStore.getState()
      if (!hit) return
      const pick = hit.object.userData.pick as { kind: string; id?: string; zone?: PartPick['zone'] }
      if (wiring) {
        // wiring: a node finishes the wire, anything else drops a bend
        const node = nodeAt(hit, wiring.from.key)
        controls.enabled = false
        if (node) {
          if (node.key !== wiring.from.key) store.addWire(wiring.from.ref, node.ref, wiring.color, wiring.points)
          endWiring()
        } else {
          const p = snapBend(toCanvas(hit.point), event.altKey)
          wiring.points.push(p)
          showPending()
        }
        return
      }
      if (pick.kind === 'wire') {
        controls.enabled = false
        setSelectedWire(current => (current === pick.id ? null : pick.id!))
        store.selectComponent(null)
        return
      }
      const running = store.runState === 'running'
      if (pick.kind === 'part' && running && pick.zone) {
        const comp = store.components.find(c => c.id === pick.id)
        if (comp) {
          controls.enabled = false
          if (pick.zone === 'cap') { store.updateComponentState(comp.id, { pressed: true }); drag = { kind: 'press', id: comp.id } }
          else if (pick.zone === 'switch') store.updateComponentState(comp.id, { value: Number(comp.state.value ?? 0) ? 0 : 1 })
          else drag = { kind: 'knob', id: comp.id, startX: event.clientX, startY: event.clientY, start: { ...comp.state } }
          renderer.domElement.setPointerCapture(event.pointerId)
          return
        }
      }
      const node = nodeAt(hit)
      if (node) {
        controls.enabled = false
        setSelectedWire(null)
        const p = toCanvas(hit.point)
        wiring = { from: node, color: wireColorFor(node, store.components), points: [], cursor: { ...p, h: hit.point.y } }
        setWiringActive(true)
        marker.visible = false
        showPending()
        return
      }
      setSelectedWire(null)
      if (pick.kind === 'part') {
        const comp = store.components.find(c => c.id === pick.id)
        if (!comp?.pos) return
        controls.enabled = false
        store.checkpoint()
        store.selectComponent(comp.id)
        const height = hit.point.y
        const p = toCanvas(hit.point)
        drag = { kind: 'part', id: comp.id, height, off: { x: p.x - comp.pos.x, y: p.y - comp.pos.y }, moved: false }
        renderer.domElement.setPointerCapture(event.pointerId)
        return
      }
      if (pick.kind === 'board' || pick.kind === 'breadboard') {
        controls.enabled = false
        store.checkpoint()
        store.selectComponent(null)
        const p = toCanvas(hit.point)
        const offset = pick.kind === 'board' ? store.boardOffset : store.breadboardOffset
        drag = { kind: pick.kind, height: hit.point.y, off: { x: p.x - offset.x, y: p.y - offset.y } }
        renderer.domElement.setPointerCapture(event.pointerId)
        return
      }
      store.selectComponent(null)
    }

    const onPointerMove = (event: PointerEvent) => {
      const store = useKodyUnoStore.getState()
      if (event.pointerType === 'touch' && !drag && !wiring) return
      if (drag?.kind === 'part' || drag?.kind === 'board' || drag?.kind === 'breadboard') {
        const point = castPlane(event, drag.height)
        if (!point) return
        const p = toCanvas(point)
        if (drag.kind === 'part') {
          drag.moved = true
          ghost = { id: drag.id, pos: { x: p.x - drag.off.x, y: p.y - drag.off.y } }
          ghostMoved = true
        } else pendingOffset = { kind: drag.kind, at: { x: p.x - drag.off.x, y: p.y - drag.off.y } }
        return
      }
      if (drag?.kind === 'knob') {
        const comp = store.components.find(c => c.id === (drag as { id: string }).id)
        if (comp) store.updateComponentState(comp.id, knobPatch(comp, event.clientX - drag.startX, event.clientY - drag.startY, drag.start))
        return
      }
      if (drag) return
      const hit = cast(event)
      const node = hit ? nodeAt(hit, wiring?.from.key) : undefined
      if (wiring) {
        const target = node ? endpoint(node.ref) : null
        if (target) wiring.cursor = target
        else if (hit) wiring.cursor = { ...toCanvas(hit.point), h: hit.point.y + 0.5 }
        showPending()
      }
      if (node) {
        const end = endpoint(node.ref)
        if (end) { marker.position.set(mm(end.x), end.h + 0.6, mm(end.y)); marker.visible = true; dirty = true }
        const rect = host.getBoundingClientRect()
        setHover({ text: node.label, x: event.clientX - rect.left, y: event.clientY - rect.top })
      } else {
        if (marker.visible) { marker.visible = false; dirty = true }
        setHover(null)
      }
      renderer.domElement.style.cursor = node ? 'crosshair' : hit && (hit.object.userData.pick as { kind: string }).kind !== 'table' ? 'grab' : 'default'
    }

    const flushOffset = () => {
      if (!pendingOffset) return
      const store = useKodyUnoStore.getState()
      if (pendingOffset.kind === 'board') store.moveBoard(pendingOffset.at)
      else store.moveBreadboard(pendingOffset.at)
      pendingOffset = null
    }

    const onPointerUp = (event: PointerEvent) => {
      const store = useKodyUnoStore.getState()
      if (drag?.kind === 'part') {
        if (ghost) store.moveComponent(ghost.id, ghost.pos)
        ghost = null
        ghostMoved = false
        const comp = useKodyUnoStore.getState().components.find(c => c.id === (drag as { id: string }).id)
        const snapped = comp && snapTarget(comp)
        if (comp && snapped) store.moveComponent(comp.id, snapped)
        store.resolveCircuit()
      } else if (drag?.kind === 'board' || drag?.kind === 'breadboard') {
        flushOffset()
        store.resolveCircuit()
      }
      else if (drag?.kind === 'press') store.updateComponentState(drag.id, { pressed: false })
      else if (wiring && down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) {
        // drag-and-release wiring, as in the 2D canvas
        const hit = cast(event)
        const node = hit ? nodeAt(hit, wiring.from.key) : undefined
        if (node) { store.addWire(wiring.from.ref, node.ref, wiring.color, wiring.points); endWiring() }
      }
      drag = null
      down = null
      controls.enabled = true
      try { renderer.domElement.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    }

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) return
      const store = useKodyUnoStore.getState()
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      if (key === 'escape') { endWiring(); setSelectedWire(null); store.selectComponent(null); return }
      if (mod && (key === 'z' || key === 'y')) { event.preventDefault(); endWiring(); if (event.shiftKey || key === 'y') store.redo(); else store.undo(); return }
      if (wiring && (key === 'backspace' || key === 'delete')) { event.preventDefault(); wiring.points.pop(); showPending(); return }
      if (selectedWireRef.current && (key === 'delete' || key === 'backspace')) { event.preventDefault(); store.removeWire(selectedWireRef.current); setSelectedWire(null); return }
      const id = store.selectedComponentId
      if (!id || mod || event.altKey) return
      if (key === 'r') { event.preventDefault(); store.rotateComponent(id) }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); store.removeComponent(id) }
    }

    const onContext = (event: MouseEvent) => { if (wiring) { event.preventDefault(); endWiring() } }

    renderer.domElement.addEventListener('pointerdown', onPointerDown, { capture: true })
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)
    renderer.domElement.addEventListener('contextmenu', onContext)
    renderer.domElement.addEventListener('pointerleave', () => setHover(null))
    window.addEventListener('keydown', onKey)

    // ---------------------------------------------------------- resize & loop
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      bloomPass.resolution.set(w / 2, h / 2)
      aoPass.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      dirty = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    syncAll()
    frame(false)

    let settings = renderSettings(qualityRef.current)
    let applied: Quality | null = null
    const applyQuality = (next: Quality) => {
      applied = next
      settings = renderSettings(next)
      renderer.setPixelRatio(settings.pixelRatio)
      composer.setPixelRatio(settings.pixelRatio)
      if (sun.shadow.mapSize.x !== settings.shadowMap) {
        sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap)
        sun.shadow.map?.dispose()
        sun.shadow.map = null
      }
      aoPass.enabled = settings.postprocess
      resize()
    }
    applyQuality(qualityRef.current)
    const stopTextures = onTextureReady(markDirty)

    let raf = 0
    let lastSync = 0
    let glowing = false
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop)
      if (applied !== qualityRef.current) applyQuality(qualityRef.current)
      if (ghostMoved) { ghostMoved = false; syncGhost() }
      flushOffset()
      // Running sketches change state thousands of times a second; a few
      // dozen scene syncs per second is all the eye can see.
      if (pendingSync && time - lastSync > settings.syncInterval) {
        pendingSync = false
        lastSync = time
        syncAll()
      }
      if (controls.update()) dirty = true
      const running = useKodyUnoStore.getState().runState === 'running'
      const live = hot.size > 0 && running
      if (live && settings.animateWires) {
        for (const [id, entry] of wireObjects) entry.object.setHot(hot.has(id), time / 1000)
        dirty = true
      } else if (live !== glowing || live) {
        // steady glow, painted only when the set of live wires changes
        for (const [id, entry] of wireObjects) entry.object.setHot(live && hot.has(id), 0)
      }
      glowing = live
      if (!dirty) return
      dirty = false
      // On the light tier a drag skips shadow passes; they catch up on release.
      renderer.shadowMap.needsUpdate = settings.postprocess || !(drag && (drag.kind === 'part' || drag.kind === 'board' || drag.kind === 'breadboard'))
      if (settings.postprocess) composer.render()
      else renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      stopTextures()
      unsubscribe()
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
      controls.dispose()
      for (const entry of parts.values()) entry.object.dispose()
      for (const entry of wireObjects.values()) entry.object.dispose()
      board?.dispose()
      composer.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wire: Wire | undefined = wires.find(w => w.id === selectedWire)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" role="application" aria-label="Meja kerja 3D: board, breadboard, komponen dan kabel" />
      {hover && (
        <div className="pointer-events-none absolute z-20 rounded-md bg-slate-900/90 px-2 py-1 text-[11px] font-medium text-white shadow" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          {hover.text}
        </div>
      )}
      {circuitFaults.length > 0 && (
        <div role="alert" className="absolute left-1/2 top-3 z-20 max-w-[80%] -translate-x-1/2 rounded-lg border border-red-300 bg-red-50/95 px-3 py-2 text-[11px] font-semibold text-red-800 shadow-lg">
          ⚠ {circuitFaults[0].message}
        </div>
      )}
      {wiringActive && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1.5 text-[11px] font-semibold text-white shadow-lg">
          Pasang kabel: klik lubang / pin / kaki tujuan · klik meja = belokan · Backspace hapus belokan · Esc batal
          <button className="ml-3 rounded bg-white/20 px-2 py-0.5" onClick={() => cancelWiringRef.current()}>Batal</button>
        </div>
      )}
      {wire && (
        <div role="toolbar" aria-label="Pengaturan kabel" className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl">
          <label className="flex items-center gap-1.5">Warna
            <input aria-label="Warna kabel" type="color" value={wire.color} onChange={e => updateWire(wire.id, { color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
          </label>
          <div className="flex overflow-hidden rounded-md border border-slate-600" role="group" aria-label="Bentuk kabel">
            {([['orthogonal', 'Siku'], ['straight', 'Lurus'], ['curved', 'Lengkung']] as const).map(([style, label]) => (
              <button key={style} aria-pressed={(wire.style ?? 'orthogonal') === style}
                className={`px-2 py-1 ${(wire.style ?? 'orthogonal') === style ? 'bg-sky-600 text-white' : 'hover:bg-slate-800'}`}
                onClick={() => { useKodyUnoStore.getState().checkpoint(); updateWire(wire.id, { style }) }}>{label}</button>
            ))}
          </div>
          <button className="rounded-md px-2 py-1 hover:bg-slate-800" onClick={() => { useKodyUnoStore.getState().checkpoint(); updateWire(wire.id, { points: [] }) }}>Reset jalur</button>
          <button className="rounded-md bg-rose-600 px-2 py-1 font-semibold text-white hover:bg-rose-500" onClick={() => { removeWire(wire.id); setSelectedWire(null) }}>Hapus kabel</button>
        </div>
      )}
    </div>
  )
}

