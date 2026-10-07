import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, Group, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Texture,
  type Material, type Object3D,
} from 'three'
import type { BoardComponent, ComponentType } from '@kodyuno/types'
import { PART_SPECS, resistorBands, type PartSpec, type TerminalSpec } from '@kodyuno/lib/partSpecs'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { partArtwork } from './textures'
import { canvasTexture, disposeGroup } from './boardModels'
import { mm } from './units'

type State = Record<string, unknown>
const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export interface PartPick { kind: 'part'; id: string; zone?: 'cap' | 'knob' | 'switch' }

export interface PartObject {
  group: Group
  /** Height (mm, above the part's base surface) where a wire meets this terminal. */
  terminalHeight(role: string): number
  /** Highest point, used for the selection frame and labels. */
  height: number
  update(state: State): void
  dispose(): void
}

// ------------------------------------------------------------ shared bits

const metal = () => new MeshStandardMaterial({ color: '#cfd3da', metalness: 0.9, roughness: 0.28 })
const gold = () => new MeshStandardMaterial({ color: '#e5c56a', metalness: 0.9, roughness: 0.25 })
const plastic = (color: string, roughness = 0.6) => new MeshStandardMaterial({ color, roughness })

let glowTexture: Texture | null = null
function glow(): Texture {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new CanvasTexture(canvas)
  glowTexture.colorSpace = SRGBColorSpace
  return glowTexture
}

function glowSprite(size: number): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map: glow(), color: '#ffffff', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 10
  return sprite
}

function tag(object: Object3D, pick: PartPick) {
  object.traverse(child => { child.userData.pick = pick })
}

/** Local position of a terminal (mm), relative to the part's centre. */
function local(spec: PartSpec, t: Pick<TerminalSpec, 'dx' | 'dy'>) {
  return { x: mm(t.dx - spec.w / 2), z: mm(t.dy - spec.h / 2) }
}

function centroid(spec: PartSpec, terminals: TerminalSpec[]) {
  const points = terminals.map(t => local(spec, t))
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / Math.max(1, points.length),
    z: points.reduce((sum, p) => sum + p.z, 0) / Math.max(1, points.length),
  }
}

/** A straight lead from (x,top,z) down into the hole at the terminal. */
function lead(group: Group, x: number, z: number, top: number, radius = 0.25) {
  const leg = new Mesh(new CylinderGeometry(radius, radius, top + 1.5, 8), metal())
  leg.position.set(x, (top - 1.5) / 2, z)
  leg.castShadow = true
  group.add(leg)
}

/** Lead that leaves the body horizontally then bends down (resistor style). */
function bentLead(group: Group, fromX: number, toX: number, z: number, y: number) {
  const run = Math.abs(toX - fromX)
  if (run > 0.05) {
    const horizontal = new Mesh(new CylinderGeometry(0.25, 0.25, run, 8), metal())
    horizontal.rotation.z = Math.PI / 2
    horizontal.position.set((fromX + toX) / 2, y, z)
    group.add(horizontal)
  }
  lead(group, toX, z, y)
}

// ------------------------------------------------------------ modelled parts

function ledPart(spec: PartSpec, pick: PartPick): PartObject {
  const group = new Group()
  const legs = spec.terminals
  const c = centroid(spec, legs)
  const lift = 3.2
  legs.forEach(t => { const p = local(spec, t); lead(group, p.x, p.z, lift + 0.2) })
  const lens = new MeshPhysicalMaterial({ color: '#ef4444', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.88, emissive: '#000000' })
  const body = new Mesh(new CylinderGeometry(2.5, 2.5, 5.4, 28), lens)
  body.position.set(c.x, lift + 2.7 + 1, c.z)
  const dome = new Mesh(new SphereGeometry(2.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), lens)
  dome.position.set(c.x, lift + 5.4 + 1, c.z)
  const rim = new Mesh(new CylinderGeometry(2.9, 2.9, 1, 28), lens)
  rim.position.set(c.x, lift + 0.5, c.z)
  for (const mesh of [body, dome, rim]) { mesh.castShadow = true; group.add(mesh) }
  const halo = glowSprite(16)
  halo.position.set(c.x, lift + 5, c.z)
  group.add(halo)
  tag(group, pick)
  return {
    group, height: lift + 8.9,
    terminalHeight: () => 0.2,
    update(state) {
      const color = new Color().setStyle(typeof state.color === 'string' ? state.color : 'red')
      const on = state.on === true && !state.burned
      const brightness = on ? Math.max(0.15, Math.min(1, num(state.brightness, 1))) : 0
      lens.color.copy(state.burned ? new Color('#3f3f46') : color.clone().multiplyScalar(on ? 1 : 0.55))
      lens.emissive.copy(color)
      lens.emissiveIntensity = brightness * 5
      halo.material.color.copy(color)
      halo.material.opacity = brightness * 0.85
    },
    dispose: () => disposeGroup(group),
  }
}

function rgbLedPart(spec: PartSpec, pick: PartPick): PartObject {
  const group = new Group()
  const c = centroid(spec, spec.terminals)
  const lift = 3.2
  spec.terminals.forEach(t => { const p = local(spec, t); lead(group, p.x, p.z, lift + 0.2) })
  const lens = new MeshPhysicalMaterial({ color: '#f1f5f9', roughness: 0.35, clearcoat: 1, transparent: true, opacity: 0.9, emissive: '#000000' })
  const body = new Mesh(new CylinderGeometry(2.5, 2.5, 5.4, 28), lens)
  body.position.set(c.x, lift + 3.7, c.z)
  const dome = new Mesh(new SphereGeometry(2.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), lens)
  dome.position.set(c.x, lift + 6.4, c.z)
  const rim = new Mesh(new CylinderGeometry(2.9, 2.9, 1, 28), lens)
  rim.position.set(c.x, lift + 0.5, c.z)
  for (const mesh of [body, dome, rim]) { mesh.castShadow = true; group.add(mesh) }
  const halo = glowSprite(16)
  halo.position.set(c.x, lift + 5, c.z)
  group.add(halo)
  tag(group, pick)
  return {
    group, height: lift + 8.9,
    terminalHeight: () => 0.2,
    update(state) {
      const r = num(state.red) / 255, g = num(state.green) / 255, b = num(state.blue) / 255
      const level = Math.max(r, g, b)
      const color = new Color(r, g, b)
      lens.emissive.copy(level > 0 ? color.clone().multiplyScalar(1 / level) : color)
      lens.emissiveIntensity = level * 5
      halo.material.color.copy(level > 0 ? color.clone().multiplyScalar(1 / level) : color)
      halo.material.opacity = level * 0.85
    },
    dispose: () => disposeGroup(group),
  }
}

function bandTexture(value: number): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 32
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d9c39a'
  ctx.fillRect(0, 0, 256, 32)
  const [a, b, c] = resistorBands(value)
  ;[[a, 62], [b, 98], [c, 134], ['#c9a227', 190]].forEach(([color, x]) => { ctx.fillStyle = color as string; ctx.fillRect(x as number, 0, 16, 32) })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function resistorPart(spec: PartSpec, pick: PartPick): PartObject {
  const group = new Group()
  const [t1, t2] = spec.terminals.map(t => local(spec, t))
  const y = 2.6
  const material = new MeshStandardMaterial({ roughness: 0.55 })
  const body = new Mesh(new CapsuleGeometry(1.15, 4.4, 6, 20), material)
  body.rotation.z = Math.PI / 2
  body.position.set((t1.x + t2.x) / 2, y, (t1.z + t2.z) / 2)
  body.castShadow = true
  group.add(body)
  bentLead(group, body.position.x - 2.9, t1.x, t1.z, y)
  bentLead(group, body.position.x + 2.9, t2.x, t2.z, y)
  tag(group, pick)
  let shown = -1
  return {
    group, height: y + 1.2,
    terminalHeight: () => 0.2,
    update(state) {
      const value = num(state.value, 220)
      if (value === shown) return
      shown = value
      material.map?.dispose()
      material.map = bandTexture(value)
      material.needsUpdate = true
    },
    dispose: () => disposeGroup(group),
  }
}

function pushbuttonPart(spec: PartSpec, pick: PartPick): PartObject {
  const group = new Group()
  // A 12 mm tact switch centred in the artwork box; the two simulated legs sit
  // on the real diagonal pair, the other two are drawn for the look.
  const size = 12
  spec.terminals.forEach(t => { const p = local(spec, t); lead(group, p.x, p.z, 0.6) })
  const [a, b] = spec.terminals.map(t => local(spec, t))
  lead(group, a.x, b.z, 0.6)
  lead(group, b.x, a.z, 0.6)
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2
  const base = new Mesh(new BoxGeometry(size, 3.6, size), plastic('#26272b', 0.7))
  base.position.set(cx, 0.6 + 1.8, cz)
  const plate = new Mesh(new BoxGeometry(size - 0.6, 0.3, size - 0.6), metal())
  plate.position.set(cx, 0.6 + 3.75, cz)
  const capMaterial = plastic('#dc2626', 0.45)
  const cap = new Mesh(new CylinderGeometry(3.6, 3.8, 3.4, 32), capMaterial)
  cap.position.set(cx, 0.6 + 3.6 + 1.7, cz)
  for (const mesh of [base, plate, cap]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh) }
  tag(group, pick)
  tag(cap, { ...pick, zone: 'cap' })
  return {
    group, height: 9,
    terminalHeight: () => 0.2,
    update(state) {
      cap.position.y = 0.6 + 3.6 + 1.7 - (state.pressed === true ? 1.1 : 0)
      capMaterial.color.set(state.pressed === true ? '#b91c1c' : '#dc2626')
    },
    dispose: () => disposeGroup(group),
  }
}

function buzzerPart(spec: PartSpec, pick: PartPick): PartObject {
  const group = new Group()
  spec.terminals.forEach(t => { const p = local(spec, t); lead(group, p.x, p.z, 1) })
  const c = { x: 0, z: 0 }
  const shell = plastic('#151517', 0.55)
  const body = new Mesh(new CylinderGeometry(6, 6, 7.5, 40), shell)
  body.position.set(c.x, 1 + 3.75, c.z)
  const hole = new Mesh(new CylinderGeometry(1, 1, 0.1, 20), plastic('#000000', 1))
  hole.position.set(c.x, 1 + 7.55, c.z)
  const ring = new Mesh(new CylinderGeometry(4.2, 4.2, 0.08, 40), plastic('#2a2a2e', 0.4))
  ring.position.set(c.x, 1 + 7.52, c.z)
  for (const mesh of [body, hole, ring]) { mesh.castShadow = true; group.add(mesh) }
  tag(group, pick)
  return {
    group, height: 9,
    terminalHeight: () => 0.2,
    update(state) {
      // a buzzing part trembles slightly
      const active = num(state.frequency) > 0 || state.on === true || state.active === true
      body.position.x = active ? c.x + (Math.random() - 0.5) * 0.08 : c.x
    },
    dispose: () => disposeGroup(group),
  }
}

function to92Part(spec: PartSpec, pick: PartPick, label: string): PartObject {
  const group = new Group()
  const lift = 5
  spec.terminals.forEach(t => { const p = local(spec, t); lead(group, p.x, p.z, lift, 0.22) })
  const c = centroid(spec, spec.terminals)
  const body = new Mesh(new CylinderGeometry(2.4, 2.4, 4.5, 28, 1, false, 0, Math.PI), plastic('#18181b', 0.5))
  body.rotation.y = Math.PI / 2
  body.position.set(c.x, lift + 2.25, c.z - 0.6)
  const flat = new Mesh(new BoxGeometry(4.8, 4.5, 0.05), plastic('#232326', 0.5))
  flat.position.set(c.x, lift + 2.25, c.z - 0.6)
  for (const mesh of [body, flat]) { mesh.castShadow = true; group.add(mesh) }
  void label
  tag(group, pick)
  return { group, height: lift + 5, terminalHeight: () => 0.6, update() {}, dispose: () => disposeGroup(group) }
}

// ------------------------------------------------------------ textured modules

interface ModuleShape {
  /** Thickness of the textured block (mm). */
  thickness: number
  /** Block colour on the sides. */
  side: string
  /** Gap under the block (mm) — modules ride on their header pins. */
  standoff: number
  /** Male header pins under every terminal. */
  pins: boolean
}

const MODULE_SHAPES: Partial<Record<ComponentType, Partial<ModuleShape>>> = {
  seven_segment: { thickness: 7, side: '#e5e7eb', standoff: 0.5, pins: false },
  led_bar: { thickness: 8, side: '#e5e7eb', standoff: 0.5, pins: false },
  multimeter: { thickness: 14, side: '#b45309', standoff: 0, pins: false },
  logic_analyzer: { thickness: 9, side: '#111827', standoff: 0, pins: false },
  keypad: { thickness: 0.8, side: '#1f2937', standoff: 0, pins: false },
  dht22: { thickness: 7.5, side: '#e5e7eb', standoff: 0.5, pins: false },
  dht11: { thickness: 7.5, side: '#60a5fa', standoff: 0.5, pins: false },
  neopixel: { thickness: 1.6, side: '#f8fafc', standoff: 0.5, pins: false },
  stepper: { thickness: 19, side: '#9ca3af', standoff: 0, pins: false },
  slide_switch: { thickness: 4, side: '#1f2937', standoff: 0.5, pins: false },
  dip_switch: { thickness: 4, side: '#b91c1c', standoff: 0.5, pins: false },
  tilt_switch: { thickness: 4, side: '#111827', standoff: 0.5, pins: false },
  ntc_temp: { pins: true },
  microsd: { pins: true },
  ir_receiver: { pins: true },
}

const ZONE: Partial<Record<ComponentType, PartPick['zone']>> = { slide_switch: 'switch', dip_switch: 'switch' }

function texturedPart(type: ComponentType, spec: PartSpec, pick: PartPick, id: string, extras?: (group: Group, top: number) => ((state: State) => void) | void): PartObject {
  const shape: ModuleShape = { thickness: 1.6, side: '#1f6f5c', standoff: 2.6, pins: true, ...MODULE_SHAPES[type] }
  const group = new Group()
  const w = mm(spec.w), d = mm(spec.h)
  const top = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, transparent: true, alphaTest: 0.04 })
  const side = plastic(shape.side, 0.7)
  const block = new Mesh(new RoundedBoxGeometry(w, shape.thickness, d, 2, Math.min(0.6, shape.thickness / 2 - 0.05)), [side, side, top, side, side, side])
  block.position.y = shape.standoff + shape.thickness / 2
  block.castShadow = true
  block.receiveShadow = true
  group.add(block)
  const blockTop = shape.standoff + shape.thickness
  if (shape.pins) {
    for (const t of spec.terminals) {
      const p = local(spec, t)
      const pin = new Mesh(new BoxGeometry(0.64, 6, 0.64), gold())
      pin.position.set(p.x, blockTop + 0.6, p.z)
      const collar = new Mesh(new BoxGeometry(2.54, 2.5, 2.54), plastic('#18181b'))
      collar.position.set(p.x, blockTop + 1.25, p.z)
      group.add(pin, collar)
    }
  }
  const animate = extras?.(group, blockTop)
  tag(group, pick)
  const zone = ZONE[type]
  if (zone) tag(block, { ...pick, zone })

  let key = ''
  let busy = false
  let queued: State | null = null
  const paint = (state: State) => {
    const art = partArtwork(type, state, id)
    if (!art || art.key === key) return
    if (busy) { queued = state; return }
    key = art.key
    busy = true
    void art.draw().then(canvas => {
      top.map?.dispose()
      top.map = canvasTexture(canvas)
      top.needsUpdate = true
    }).catch(() => {}).finally(() => {
      busy = false
      if (queued) { const next = queued; queued = null; paint(next) }
    })
  }

  return {
    group,
    height: blockTop + (shape.pins ? 3.6 : 0),
    // jumpers seat on the plastic collar and cover the pin, like a real dupont
    terminalHeight: () => (shape.pins ? blockTop + 2.5 : blockTop),
    update(state) { paint(state); animate?.(state) },
    dispose: () => disposeGroup(group),
  }
}

/** Servo: cable on the flat artwork, SG90 body and a horn that really turns. */
function servoExtras(spec: PartSpec) {
  // body rect and output shaft, from the servo artwork (170.08 × 119.55 css px)
  const sx = mm(spec.w) / 170.08, sz = mm(spec.h) / 119.55
  const ox = -mm(spec.w) / 2, oz = -mm(spec.h) / 2
  return (group: Group, top: number) => {
    const bodyW = 90.24 * sx, bodyD = 43.72 * sz
    const body = new Mesh(new BoxGeometry(bodyW, 22, bodyD), new MeshPhysicalMaterial({ color: '#2563eb', roughness: 0.35, transmission: 0.15, transparent: true, opacity: 0.94 }))
    body.position.set(ox + (64.26 + 90.24 / 2) * sx, top + 11, oz + (37.91 + 43.72 / 2) * sz)
    const ear = new Mesh(new BoxGeometry(bodyW + 9, 2.5, bodyD), body.material)
    ear.position.set(body.position.x, top + 16, body.position.z)
    const pivot = new Group()
    pivot.position.set(ox + 91.47 * sx, top + 22, oz + 59.77 * sz)
    const shaft = new Mesh(new CylinderGeometry(2.4, 2.4, 3, 24), plastic('#f1f5f9', 0.5))
    shaft.position.y = 1.5
    const arm = new Mesh(new CapsuleGeometry(2, 14, 6, 16), plastic('#f8fafc', 0.45))
    arm.rotation.z = Math.PI / 2
    arm.position.set(7, 3.4, 0)
    pivot.add(shaft, arm)
    for (const mesh of [body, ear, shaft, arm]) mesh.castShadow = true
    group.add(body, ear, pivot)
    return (state: State) => { pivot.rotation.y = -num(state.angle) * Math.PI / 180 }
  }
}

function potExtras(spec: PartSpec, pick: PartPick) {
  // knob centre (9.95, 8.06) of the 20 × 20 mm artwork
  const kx = -mm(spec.w) / 2 + mm(spec.w) * 9.95 / 20, kz = -mm(spec.h) / 2 + mm(spec.h) * 8.06 / 20
  return (group: Group, top: number) => {
    const knob = new Group()
    knob.position.set(kx, top, kz)
    const base = new Mesh(new CylinderGeometry(5.6, 5.8, 3, 40), plastic('#1e3a8a', 0.5))
    base.position.y = 1.5
    const cap = new Mesh(new CylinderGeometry(3.6, 3.9, 6, 24), plastic('#d4d4d8', 0.35))
    cap.position.y = 6
    const notch = new Mesh(new BoxGeometry(0.7, 0.3, 3), plastic('#111827'))
    notch.position.set(0, 9.05, -1.6)
    knob.add(base, cap, notch)
    for (const mesh of [base, cap]) mesh.castShadow = true
    group.add(knob)
    queueMicrotask(() => tag(knob, { ...pick, zone: 'knob' }))
    return (state: State) => { knob.rotation.y = -((num(state.value, 512) / 1023) * 270 - 135) * Math.PI / 180 }
  }
}

function ultrasonicExtras(spec: PartSpec) {
  const sx = mm(spec.w) / 45, sz = mm(spec.h) / 25
  return (group: Group, top: number) => {
    for (const cx of [8.98, 36.02]) {
      const can = new Mesh(new CylinderGeometry(8 * sx, 8 * sx, 12, 40, 1, true), metal())
      const x = -mm(spec.w) / 2 + cx * sx, z = -mm(spec.h) / 2 + 10 * sz
      can.position.set(x, top + 6, z)
      const mesh = new Mesh(new CylinderGeometry(7.6 * sx, 7.6 * sx, 0.2, 40), plastic('#3f3f46', 0.9))
      mesh.position.set(x, top + 11.5, z)
      can.castShadow = true
      group.add(can, mesh)
    }
  }
}

function pirExtras() {
  return (group: Group, top: number) => {
    const dome = new Mesh(new SphereGeometry(11.5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new MeshPhysicalMaterial({ color: '#f8fafc', roughness: 0.6, transmission: 0.1 }))
    dome.position.y = top
    dome.scale.y = 0.85
    dome.castShadow = true
    group.add(dome)
  }
}

function relayExtras(spec: PartSpec) {
  const sx = mm(spec.w) / 80, sz = mm(spec.h) / 56
  return (group: Group, top: number) => {
    const cube = new Mesh(new BoxGeometry(42 * sx, 15, 31 * sz), new MeshPhysicalMaterial({ color: '#1d4ed8', roughness: 0.3, transmission: 0.1 }))
    cube.position.set(-mm(spec.w) / 2 + 29 * sx, top + 7.5, -mm(spec.h) / 2 + 22.5 * sz)
    cube.castShadow = true
    const terminal = new Mesh(new BoxGeometry(14 * sx, 9, 36 * sz), plastic('#2563eb', 0.5))
    terminal.position.set(-mm(spec.w) / 2 + 66 * sx, top + 4.5, -mm(spec.h) / 2 + 24 * sz)
    terminal.castShadow = true
    group.add(cube, terminal)
  }
}

function gasExtras() {
  return (group: Group, top: number) => {
    const can = new Mesh(new CylinderGeometry(9, 9, 9, 40), metal())
    can.position.y = top + 4.5
    can.castShadow = true
    const mesh = new Mesh(new CylinderGeometry(8, 8, 0.2, 40), plastic('#6b7280', 0.9))
    mesh.position.y = top + 9.1
    group.add(can, mesh)
  }
}

function joystickExtras(pick: PartPick) {
  return (group: Group, top: number) => {
    const stick = new Group()
    stick.position.y = top + 4
    const housing = new Mesh(new BoxGeometry(16, 8, 16), plastic('#1f2937', 0.6))
    housing.position.y = top
    const shaft = new Mesh(new CylinderGeometry(1.4, 1.4, 8, 16), plastic('#111827'))
    shaft.position.y = 4
    const thumb = new Mesh(new CylinderGeometry(7, 7.5, 4.5, 32), plastic('#18181b', 0.8))
    thumb.position.y = 9
    stick.add(shaft, thumb)
    for (const mesh of [housing, shaft, thumb]) mesh.castShadow = true
    group.add(housing, stick)
    queueMicrotask(() => tag(stick, { ...pick, zone: 'knob' }))
    return (state: State) => {
      stick.rotation.z = -((num(state.x, 512) - 512) / 512) * 0.4
      stick.rotation.x = ((num(state.y, 512) - 512) / 512) * 0.4
    }
  }
}

function matrixExtras(spec: PartSpec, box: { x: number; y: number; w: number; h: number; sw: number; sh: number }) {
  return (group: Group, top: number) => {
    const sx = mm(spec.w) / box.sw, sz = mm(spec.h) / box.sh
    const frame = new Mesh(new BoxGeometry(box.w * sx, 6, box.h * sz), plastic('#0b0f19', 0.4))
    frame.position.set(-mm(spec.w) / 2 + (box.x + box.w / 2) * sx, top + 3, -mm(spec.h) / 2 + (box.y + box.h / 2) * sz)
    frame.material = Object.assign(frame.material as MeshStandardMaterial, { transparent: true, opacity: 0.35 })
    group.add(frame)
  }
}

// ------------------------------------------------------------ factory

export function createPart(comp: BoardComponent): PartObject {
  const spec = PART_SPECS[comp.type]
  const pick: PartPick = { kind: 'part', id: comp.id }

  let part: PartObject
  switch (comp.type) {
    case 'led': part = ledPart(spec, pick); break
    case 'rgb_led': part = rgbLedPart(spec, pick); break
    case 'resistor': part = resistorPart(spec, pick); break
    case 'pushbutton': part = pushbuttonPart(spec, pick); break
    case 'buzzer': part = buzzerPart(spec, pick); break
    case 'lm35': part = to92Part(spec, pick, 'LM35'); break
    case 'ds18b20': part = to92Part(spec, pick, 'DS18B20'); break
    case 'servo': part = texturedPart('servo', spec, pick, comp.id, servoExtras(spec)); break
    case 'potentiometer': part = texturedPart('potentiometer', spec, pick, comp.id, potExtras(spec, pick)); break
    case 'ultrasonic': part = texturedPart('ultrasonic', spec, pick, comp.id, ultrasonicExtras(spec)); break
    case 'pir': part = texturedPart('pir', spec, pick, comp.id, pirExtras()); break
    case 'relay': part = texturedPart('relay', spec, pick, comp.id, relayExtras(spec)); break
    case 'gas_sensor': part = texturedPart('gas_sensor', spec, pick, comp.id, gasExtras()); break
    case 'joystick': part = texturedPart('joystick', spec, pick, comp.id, joystickExtras(pick)); break
    case 'led_matrix': part = texturedPart('led_matrix', spec, pick, comp.id, matrixExtras(spec, { x: 8, y: 5, w: 66, h: 56, sw: 82, sh: 76 })); break
    default: part = texturedPart(comp.type, spec, pick, comp.id)
  }
  part.group.userData.partId = comp.id
  part.update(comp.state)
  return part
}

export function disposeMaterial(material: Material | Material[]) {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose()
}
