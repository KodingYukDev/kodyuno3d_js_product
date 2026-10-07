import '@kodyuno/vendor/kody-elements'

/**
 * Turns the vendored kody-* artwork into bitmaps for 3D textures. Every part
 * keeps exactly the look it has in the 2D canvas because the pixels come from
 * the same Lit element, rendered off-screen and flattened to an SVG image.
 */

const MAX_CACHE = 240
const cache = new Map<string, Promise<HTMLCanvasElement>>()

let host: HTMLDivElement | null = null
function offscreenHost(): HTMLDivElement {
  if (host?.isConnected) return host
  host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: '0', height: '0', overflow: 'hidden', pointerEvents: 'none' })
  document.body.append(host)
  return host
}

function remember(key: string, make: () => Promise<HTMLCanvasElement>): Promise<HTMLCanvasElement> {
  const hit = cache.get(key)
  if (hit) {
    // refresh LRU position
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const job = make()
  job.catch(() => cache.delete(key))
  cache.set(key, job)
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  return job
}

function loadSvg(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG artwork could not be decoded')) }
    image.src = url
  })
}

async function paint(markup: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  const image = await loadSvg(markup)
  // WebGL textures stop at 4096 px on most GPUs
  scale = Math.min(scale, 4096 / width, 4096 / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(width * scale))
  canvas.height = Math.max(2, Math.round(height * scale))
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

function shadowStyles(element: HTMLElement): string {
  const ctor = element.constructor as { elementStyles?: Array<{ cssText?: string } | CSSStyleSheet> }
  const parts: string[] = []
  for (const style of ctor.elementStyles ?? []) {
    if ('cssText' in style && typeof style.cssText === 'string') parts.push(style.cssText)
    else if (style instanceof CSSStyleSheet) parts.push(Array.from(style.cssRules, rule => rule.cssText).join('\n'))
  }
  return parts.join('\n').replace(/:host[^{]*\{[^}]*\}/g, '')
}

/** Stable key for a props object (arrays of numbers stay cheap). */
export function propsKey(props: Record<string, unknown>): string {
  return JSON.stringify(props, (_key, value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value))
}

/** Rasterize a kody-* element with the given props at `scale` px per css px. */
export function rasterizeElement(tag: string, props: Record<string, unknown>, cssW: number, cssH: number, scale = 4): Promise<HTMLCanvasElement> {
  return remember(`${tag}|${scale}|${propsKey(props)}`, async () => {
    const element = document.createElement(tag) as HTMLElement & { updateComplete?: Promise<unknown> }
    Object.assign(element, props)
    offscreenHost().append(element)
    try {
      await element.updateComplete
      const svg = element.shadowRoot?.querySelector('svg')
      if (!svg) throw new Error(`${tag} rendered no SVG`)
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
      clone.removeAttribute('transform')
      const css = shadowStyles(element)
      if (css) {
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        style.textContent = css
        clone.insertBefore(style, clone.firstChild)
      }
      return await paint(new XMLSerializer().serializeToString(clone), cssW, cssH, scale)
    } finally {
      element.remove()
    }
  })
}

/** Rasterize plain SVG markup (React static markup, hand-drawn parts). */
export function rasterizeMarkup(key: string, markup: string, width: number, height: number, scale = 4): Promise<HTMLCanvasElement> {
  return remember(`svg|${scale}|${key}`, () => paint(markup, width, height, scale))
}
