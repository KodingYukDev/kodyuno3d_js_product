// Share links, like Wokwi's: the whole project (circuit + sketch, not the
// compiled HEX) travels inside the URL fragment, deflated and base64url
// encoded. Fragments never reach a server, so sharing needs no storage and
// costs nothing.

import { parseProject, serializeProject, type ProjectDocument } from './projectDocument'

export const SHARE_PARAM = 'share'
/** Keep links pasteable into chat apps; ~32KB of URL is a generous project. */
export const MAX_SHARE_CHARS = 32_000

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

export async function encodeShare(project: Pick<ProjectDocument, 'boardType' | 'boardOffset' | 'breadboardOffset' | 'sketchCode' | 'files' | 'components' | 'wires'>): Promise<string> {
  const json = serializeProject({ ...project, firmware: undefined })
  const code = toBase64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')))
  if (code.length > MAX_SHARE_CHARS) throw new Error('Proyek terlalu besar untuk link. Gunakan Simpan project.')
  return code
}

export async function decodeShare(code: string): Promise<ProjectDocument> {
  if (!/^[\w-]+$/.test(code) || code.length > MAX_SHARE_CHARS) throw new Error('Link proyek rusak.')
  let json: string
  try {
    json = new TextDecoder().decode(await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw')))
  } catch {
    throw new Error('Link proyek rusak.')
  }
  return parseProject(json)
}

/** The share code in a URL fragment such as `#share=…`, if any. */
export function shareCodeFromHash(hash: string): string | null {
  const match = new RegExp(`(?:^#|&)${SHARE_PARAM}=([\\w-]+)`).exec(hash)
  return match ? match[1] : null
}
