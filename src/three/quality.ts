/**
 * Two render tiers. "hemat" is the default on tablets, phones and low-end
 * laptops: no post-processing, smaller shadow map and textures, lower pixel
 * ratio, and frames only when something changed. "hd" adds ambient occlusion,
 * LED bloom and animated current on live wires.
 */
export type Quality = 'hemat' | 'hd'

const KEY = 'kodyuno3d-quality'

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches)
}

export function defaultQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'hemat' || saved === 'hd') return saved
  } catch { /* storage unavailable */ }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const cores = navigator.hardwareConcurrency ?? 8
  return isTouchDevice() || memory <= 4 || cores <= 4 ? 'hemat' : 'hd'
}

export function saveQuality(quality: Quality) {
  try { localStorage.setItem(KEY, quality) } catch { /* storage unavailable */ }
}

/** Texture pixels per css px for part and board artwork. */
let textureScale = 8
export function setTextureQuality(quality: Quality) { textureScale = quality === 'hd' ? 8 : 4.5 }
export function textureScaleFor(): number { return textureScale }

export interface RenderSettings {
  pixelRatio: number
  shadowMap: number
  postprocess: boolean
  animateWires: boolean
  /** Minimum ms between scene syncs while a sketch runs. */
  syncInterval: number
}

export function renderSettings(quality: Quality): RenderSettings {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return quality === 'hd'
    ? { pixelRatio: Math.min(dpr, 2), shadowMap: 4096, postprocess: true, animateWires: true, syncInterval: 24 }
    : { pixelRatio: Math.min(dpr, 1.25), shadowMap: 1024, postprocess: false, animateWires: false, syncInterval: 40 }
}
