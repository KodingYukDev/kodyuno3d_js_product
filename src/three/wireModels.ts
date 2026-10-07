import { CatmullRomCurve3, Color, Group, Mesh, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3, CylinderGeometry } from 'three'
import { wireRoute, type WireStyle } from '@kodyuno/lib/wireGeometry'
import { mm } from './units'

export interface WireEnd {
  /** canvas coordinates */
  x: number
  y: number
  /** height of the attach point (mm) */
  h: number
}

export interface WirePick { kind: 'wire'; id: string }

/**
 * 3D path of a jumper: straight up out of each hole, then along the engine's
 * own 2D route (so bends and styles match the 2D canvas) at a height that
 * clears whatever the endpoints sit on.
 */
export function wirePath(a: WireEnd, b: WireEnd, bends: { x: number; y: number }[] = [], style: WireStyle = 'orthogonal'): Vector3[] {
  const route = wireRoute(a, b, bends, style)
  const span = Math.hypot(mm(b.x - a.x), mm(b.y - a.y))
  const lift = Math.max(a.h, b.h) + Math.min(14, 4 + span * 0.12)
  const points: Vector3[] = [new Vector3(mm(a.x), a.h, mm(a.y)), new Vector3(mm(a.x), a.h + 2.5, mm(a.y))]
  const inner = route.slice(1, -1)
  if (inner.length === 0) points.push(new Vector3(mm((a.x + b.x) / 2), lift, mm((a.y + b.y) / 2)))
  for (const p of inner) points.push(new Vector3(mm(p.x), lift, mm(p.y)))
  points.push(new Vector3(mm(b.x), b.h + 2.5, mm(b.y)), new Vector3(mm(b.x), b.h, mm(b.y)))
  return points
}

const RADIUS = 0.62

export interface WireObject {
  group: Group
  material: MeshStandardMaterial
  setHot(hot: boolean, time: number): void
  setSelected(selected: boolean): void
  dispose(): void
}

export function createWire(id: string, color: string, points: Vector3[], curved: boolean): WireObject {
  const group = new Group()
  const curve = new CatmullRomCurve3(points, false, curved ? 'catmullrom' : 'centripetal', 0.5)
  const segments = Math.max(24, Math.round(curve.getLength() * 1.5))
  const material = new MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05, emissive: '#000000' })
  const tube = new Mesh(new TubeGeometry(curve, segments, RADIUS, 10, false), material)
  tube.castShadow = true
  tube.userData.pick = { kind: 'wire', id } satisfies WirePick
  group.add(tube)
  // Dupont housings at both ends
  const housing = new MeshStandardMaterial({ color: '#111114', roughness: 0.6 })
  for (const [tip, above] of [[points[0], points[1]], [points[points.length - 1], points[points.length - 2]]]) {
    const plug = new Mesh(new CylinderGeometry(1.05, 1.05, 3.2, 12), housing)
    plug.position.copy(tip).lerp(above, 0.6)
    plug.userData.pick = { kind: 'wire', id } satisfies WirePick
    group.add(plug)
  }
  const base = new Color(color)
  let selected = false
  const halo = new Mesh(new TubeGeometry(curve, segments, RADIUS * 2, 8, false), new MeshStandardMaterial({ color: '#38bdf8', transparent: true, opacity: 0.35, depthWrite: false }))
  halo.visible = false
  group.add(halo)
  return {
    group, material,
    setHot(hot, time) {
      if (hot) {
        material.emissive.copy(base)
        material.emissiveIntensity = 0.25 + 0.2 * Math.sin(time * 6)
      } else material.emissiveIntensity = 0
    },
    setSelected(value) {
      if (value === selected) return
      selected = value
      halo.visible = value
    },
    dispose() {
      group.traverse(object => {
        const mesh = object as Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        ;(mesh.material as MeshStandardMaterial).dispose()
      })
    },
  }
}

/** Marker drawn on the node under the cursor while wiring. */
export function createNodeMarker(): Mesh {
  const marker = new Mesh(new SphereGeometry(1.1, 16, 12), new MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 0.8, transparent: true, opacity: 0.85, depthTest: false }))
  marker.renderOrder = 20
  marker.visible = false
  return marker
}
