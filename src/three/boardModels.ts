import {
  BoxGeometry, CanvasTexture, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, SRGBColorSpace,
  type Material, type Texture,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BB_BODY, BB_COLS, BB_HOLES, BB_PITCH, BB_ROW_Y, BB_X0 } from '@kodyuno/lib/breadboard'
import { BOARD_X, BOARD_Y, boardSize, type BoardDef } from '@kodyuno/lib/boards'
import { holesOf } from '@kodyuno/lib/boardGeometry'
import { HEIGHT, mm } from './units'
import { boardArtwork } from './textures'
import { textureScaleFor } from './quality'

export interface Pickable { kind: 'board' | 'breadboard' }

let maxAnisotropy = 8
/** Renderer limit, set once the WebGL context exists. */
export function setMaxAnisotropy(value: number) { maxAnisotropy = Math.max(1, value) }

const textureListeners = new Set<() => void>()
/** Called whenever an async artwork texture lands, so on-demand renderers repaint. */
export function onTextureReady(listener: () => void): () => void {
  textureListeners.add(listener)
  return () => { textureListeners.delete(listener) }
}

function canvasTexture(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  queueMicrotask(() => { for (const listener of textureListeners) listener() })
  return texture
}

function disposeGroup(group: Group) {
  group.traverse(object => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials as Material[]) {
      for (const value of Object.values(material)) if (value && (value as Texture).isTexture) (value as Texture).dispose()
      material.dispose()
    }
  })
}

// ---------------------------------------------------------------- breadboard

function breadboardTop(): HTMLCanvasElement {
  const s = textureScaleFor() >= 8 ? 11 : 6 // px per canvas unit (≈ 3870 px wide in HD)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(BB_BODY.w * s)
  canvas.height = Math.round(BB_BODY.h * s)
  const ctx = canvas.getContext('2d')!
  ctx.scale(s, s)
  ctx.translate(-BB_BODY.x, -BB_BODY.y)
  ctx.fillStyle = '#f4f0e6'
  ctx.fillRect(BB_BODY.x, BB_BODY.y, BB_BODY.w, BB_BODY.h)
  // centre channel
  const gradient = ctx.createLinearGradient(0, 583, 0, 597)
  gradient.addColorStop(0, '#cfc6b2'); gradient.addColorStop(0.5, '#e4ddcf'); gradient.addColorStop(1, '#cfc6b2')
  ctx.fillStyle = gradient
  ctx.fillRect(BB_BODY.x, 583, BB_BODY.w, 14)
  const railEnd = BB_X0 + (BB_COLS - 1) * BB_PITCH
  const line = (y: number, color: string) => { ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(BB_X0 - 8, y); ctx.lineTo(railEnd + 8, y); ctx.stroke() }
  line(466, '#dc2626'); line(498, '#2563eb'); line(674, '#2563eb'); line(706, '#dc2626')
  ctx.font = 'bold 9px sans-serif'
  ctx.fillStyle = '#dc2626'; ctx.fillText('+', BB_BODY.x + 5, 478); ctx.fillText('+', BB_BODY.x + 5, 702)
  ctx.fillStyle = '#2563eb'; ctx.fillText('−', BB_BODY.x + 5, 494); ctx.fillText('−', BB_BODY.x + 5, 686)
  ctx.font = '7px monospace'
  ctx.fillStyle = '#a39a85'
  for (const row of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) ctx.fillText(row, BB_BODY.x + 4, BB_ROW_Y[row] + 3)
  ctx.textAlign = 'center'
  ctx.font = '6.5px monospace'
  for (let col = 0; col < BB_COLS; col++) if (col === 0 || (col + 1) % 5 === 0) ctx.fillText(String(col + 1), BB_X0 + col * BB_PITCH, 512)
  for (const hole of BB_HOLES) {
    ctx.fillStyle = '#4b4b52'
    ctx.fillRect(hole.x - 3.2, hole.y - 3.2, 6.4, 6.4)
    ctx.fillStyle = '#0f0f12'
    ctx.fillRect(hole.x - 1.9, hole.y - 1.9, 3.8, 3.8)
  }
  return canvas
}

/** Breadboard in base canvas coordinates; move it with `group.position`. */
export function createBreadboard(): Group {
  const group = new Group()
  group.name = 'breadboard'
  const w = mm(BB_BODY.w), d = mm(BB_BODY.h), h = HEIGHT.breadboardTop
  const side = new MeshStandardMaterial({ color: '#ebe5d6', roughness: 0.7 })
  const top = new MeshStandardMaterial({ map: canvasTexture(breadboardTop()), roughness: 0.65 })
  const body = new Mesh(new RoundedBoxGeometry(w, h, d, 3, 1.2), [side, side, top, side, side, side])
  body.position.set(mm(BB_BODY.x) + w / 2, h / 2, mm(BB_BODY.y) + d / 2)
  body.castShadow = true
  body.receiveShadow = true
  body.userData.pick = { kind: 'breadboard' } satisfies Pickable
  group.add(body)
  return group
}

// ---------------------------------------------------------------- board

export interface BoardObject {
  group: Group
  setLeds(ledOn: boolean, powerOn: boolean): void
  dispose(): void
}

const FEMALE = new Set(['uno', 'mega'])

/** The board in base canvas coordinates (offset 0); move it with `group.position`. */
export function createBoard(board: BoardDef): BoardObject {
  const group = new Group()
  group.name = `board:${board.id}`
  const size = boardSize(board)
  const w = mm(size.w), d = mm(size.h)
  const pcbColor = board.family === 'arduino' ? '#0f6e8c' : board.artwork.kind === 'generic' ? board.artwork.theme.pcb : '#1f2937'
  const edge = new MeshStandardMaterial({ color: pcbColor, roughness: 0.55 })
  const top = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.05, transparent: true, alphaTest: 0.02 })
  const bottom = new MeshStandardMaterial({ color: pcbColor, roughness: 0.8 })
  const pcb = new Mesh(new RoundedBoxGeometry(w, HEIGHT.pcb, d, 2, 0.5), [edge, edge, top, bottom, edge, edge])
  pcb.position.set(mm(BOARD_X) + w / 2, HEIGHT.boardStandoff + HEIGHT.pcb / 2, mm(BOARD_Y) + d / 2)
  pcb.castShadow = true
  pcb.receiveShadow = true
  pcb.userData.pick = { kind: 'board' } satisfies Pickable
  group.add(pcb)

  // standoffs at the corners
  const feet = new InstancedMesh(new BoxGeometry(2.4, HEIGHT.boardStandoff, 2.4), new MeshStandardMaterial({ color: '#d4d4d8', roughness: 0.4 }), 4)
  const m = new Matrix4()
  ;[[0.06, 0.08], [0.94, 0.08], [0.06, 0.92], [0.94, 0.92]].forEach(([fx, fz], i) => {
    m.makeTranslation(mm(BOARD_X) + w * fx, HEIGHT.boardStandoff / 2, mm(BOARD_Y) + d * fz)
    feet.setMatrixAt(i, m)
  })
  group.add(feet)

  // headers
  const holes = holesOf(board)
  const female = FEMALE.has(board.id)
  const pcbTop = HEIGHT.boardStandoff + HEIGHT.pcb
  const pitch = 2.54
  if (female) {
    const socket = new InstancedMesh(new BoxGeometry(pitch, HEIGHT.femaleHeader, pitch), new MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.75 }), holes.length)
    const mouth = new InstancedMesh(new BoxGeometry(1.1, 0.05, 1.1), new MeshStandardMaterial({ color: '#000000', roughness: 1 }), holes.length)
    holes.forEach((hole, i) => {
      m.makeTranslation(mm(hole.x), pcbTop + HEIGHT.femaleHeader / 2, mm(hole.y))
      socket.setMatrixAt(i, m)
      m.makeTranslation(mm(hole.x), pcbTop + HEIGHT.femaleHeader + 0.03, mm(hole.y))
      mouth.setMatrixAt(i, m)
    })
    socket.castShadow = true
    socket.userData.pick = { kind: 'board' } satisfies Pickable
    group.add(socket, mouth)
  } else {
    const base = new InstancedMesh(new BoxGeometry(pitch, 2.5, pitch), new MeshStandardMaterial({ color: '#18181b', roughness: 0.75 }), holes.length)
    const pin = new InstancedMesh(new BoxGeometry(0.64, HEIGHT.malePin, 0.64), new MeshStandardMaterial({ color: '#e5c56a', metalness: 0.9, roughness: 0.25 }), holes.length)
    holes.forEach((hole, i) => {
      m.makeTranslation(mm(hole.x), pcbTop + 1.25, mm(hole.y))
      base.setMatrixAt(i, m)
      m.makeTranslation(mm(hole.x), pcbTop + HEIGHT.malePin / 2, mm(hole.y))
      pin.setMatrixAt(i, m)
    })
    base.userData.pick = { kind: 'board' } satisfies Pickable
    pin.userData.pick = { kind: 'board' } satisfies Pickable
    pin.castShadow = true
    group.add(base, pin)
  }

  // USB connector & power jack: physical bulk the artwork can only suggest
  const metal = new MeshStandardMaterial({ color: '#c7cad1', metalness: 0.85, roughness: 0.3 })
  if (board.id === 'uno' || board.id === 'mega') {
    const usb = new Mesh(new BoxGeometry(16, 11, 12), metal)
    usb.position.set(mm(BOARD_X) + 4.5, pcbTop + 5.5, mm(BOARD_Y) + d * 0.2)
    const jack = new Mesh(new BoxGeometry(14, 11, 9), new MeshStandardMaterial({ color: '#111114', roughness: 0.6 }))
    jack.position.set(mm(BOARD_X) + 4, pcbTop + 5.5, mm(BOARD_Y) + d * 0.82)
    for (const item of [usb, jack]) { item.castShadow = true; item.userData.pick = { kind: 'board' } satisfies Pickable; group.add(item) }
  }

  let key = ''
  let generation = 0
  const setLeds = (ledOn: boolean, powerOn: boolean) => {
    const art = boardArtwork(board, ledOn, powerOn)
    if (art.key === key) return
    key = art.key
    const mine = ++generation
    void art.draw().then(canvas => {
      if (mine !== generation) return
      top.map?.dispose()
      top.map = canvasTexture(canvas)
      top.needsUpdate = true
    }).catch(() => {})
  }
  setLeds(false, false)
  return { group, setLeds, dispose: () => { generation++; disposeGroup(group) } }
}

export { disposeGroup, canvasTexture }
