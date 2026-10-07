import { useEffect, useState } from 'react'
import { getBoard, type BoardId } from '@kodyuno/lib/boards'
import { boardArtwork } from './textures'

const thumbs = new Map<BoardId, Promise<string>>()

/** Small PNG of the board's own artwork, rendered once per board. */
function thumbFor(id: BoardId): Promise<string> {
  let job = thumbs.get(id)
  if (!job) {
    job = boardArtwork(getBoard(id), false, true).draw().then(source => {
      // tall devkits (ESP32-S3, C3 …) are turned on their side so they fill the slot
      const tall = source.height > source.width
      const w = tall ? source.height : source.width, h = tall ? source.width : source.height
      const width = 320
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = Math.round((h / w) * width)
      const ctx = canvas.getContext('2d')!
      if (tall) {
        ctx.translate(canvas.width, 0)
        ctx.rotate(Math.PI / 2)
        ctx.drawImage(source, 0, 0, canvas.height, canvas.width)
      } else ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png')
    })
    job.catch(() => thumbs.delete(id))
    thumbs.set(id, job)
  }
  return job
}

export function BoardThumb({ id, className }: { id: BoardId; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setSrc(null)
    void thumbFor(id).then(url => { if (alive) setSrc(url) }).catch(() => {})
    return () => { alive = false }
  }, [id])
  return src
    ? <img src={src} alt="" draggable={false} className={`object-contain ${className ?? ''}`} />
    : <span aria-hidden className={`block animate-pulse rounded bg-slate-200 ${className ?? ''}`} />
}
