export type CompilerTarget = 'uno' | 'nano' | 'mega' | 'nodemcu-esp8266'
export interface CompiledArtifact {
  target: CompilerTarget
  filename: string
  bytes: Uint8Array<ArrayBuffer>
  logs: string
}

/** Compile service could not be reached or refused for a non-sketch reason. */
export class CompilerUnavailableError extends Error {}

/** The compile did not finish inside the caller's time budget. */
export class CompilerTimeoutError extends CompilerUnavailableError {}

// Re-running an unchanged sketch must not go back to the server at all.
const sessionCache = new Map<string, CompiledArtifact>()

/**
 * Compile on the server (Cloud Run, behind the gateway). The token is
 * optional: guests compile under a per-IP limit. Identical sketches are
 * served from this tab's memory, then from the gateway's edge cache.
 */
export async function compileSketch(target: CompilerTarget, source: string | Record<string, string>, token: string | undefined, signal: AbortSignal): Promise<CompiledArtifact> {
  // A plain string is the sketch itself; a map adds headers/sources (multi-file).
  const files = typeof source === 'string' ? { 'sketch.ino': source } : source
  const cacheKey = `${target}|${JSON.stringify(files)}`
  const cached = sessionCache.get(cacheKey)
  if (cached) return cached
  let response: Response
  try {
    response = await fetch(import.meta.env.VITE_KODYUNO_COMPILER_URL || 'https://kodyuno-compiler-gateway.arilsaputra854.workers.dev/api/compiler/compile', {
      method: 'POST', credentials: 'omit', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ target, files }),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new CompilerUnavailableError('Server compile tidak terjangkau.')
  }
  if ([408, 504].includes(response.status)) {
    await response.body?.cancel().catch(() => {})
    throw new CompilerTimeoutError('Compile melewati batas waktu server.')
  }
  if ([401, 403, 429, 500, 502, 503].includes(response.status)) {
    await response.body?.cancel().catch(() => {})
    throw new CompilerUnavailableError(response.status === 429 ? 'Batas compile per menit tercapai.' : 'Server compile sedang tidak tersedia.')
  }
  if (!response.body) throw new Error('Compiler tidak mengirim respons.')
  const reader = response.body.getReader()
  let text = '', size = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 3000000) throw new Error('Respons compiler terlalu besar.')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally { await reader.cancel() }
  let result
  try { result = JSON.parse(text) } catch { throw new CompilerUnavailableError('Server compile mengirim respons yang tidak bisa dibaca.') }
  if (!result || typeof result !== 'object') throw new CompilerUnavailableError('Server compile mengirim respons yang tidak bisa dibaca.')
  if (!response.ok) throw new Error(`${typeof result.error === 'string' ? result.error : 'Compile gagal'}${typeof result.logs === 'string' ? `\n${result.logs.slice(0, 100000)}` : ''}`)
  const artifact = result.artifact
  const format = target === 'nodemcu-esp8266' ? 'bin' : 'hex'
  const fqbn = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano:cpu=atmega328', mega: 'arduino:avr:mega:cpu=atmega2560', 'nodemcu-esp8266': 'esp8266:esp8266:nodemcuv2' }[target]
  if (result.target !== target || result.fqbn !== fqbn ||
      artifact?.format !== format || artifact.encoding !== 'base64' || artifact.filename !== `sketch.ino.${format}` ||
      !Number.isInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 2097152 ||
      typeof artifact.data !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('Artifact compiler tidak valid.')
  const bytes = Uint8Array.from(atob(artifact.data), c => c.charCodeAt(0))
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  if (bytes.length !== artifact.bytes || digest !== artifact.sha256) throw new Error('Hash artifact compiler tidak cocok.')
  const compiled: CompiledArtifact = { target, filename: artifact.filename, bytes, logs: typeof result.logs === 'string' ? result.logs.slice(0, 100000) : '' }
  if (sessionCache.size >= 20) sessionCache.delete(sessionCache.keys().next().value!)
  sessionCache.set(cacheKey, compiled)
  return compiled
}
