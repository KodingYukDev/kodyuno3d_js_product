// Logic analyzer, as in Wokwi: eight channels recorded at the CPU's cycle
// resolution while real firmware runs, viewed as waveforms in the inspector and
// saved as a VCD file for PulseView / GTKWave.

export const LOGIC_CHANNELS = 8
/** Enough for ~2 s of a busy SPI bus; recording stops (like a full buffer) after that. */
export const LOGIC_MAX_EVENTS = 400_000
const CPU_HZ = 16_000_000

export class LogicCapture {
  /** Cycle of each change and the 8-channel level mask after it (parallel arrays). */
  cycles: number[] = []
  masks: number[] = []
  start = 0
  last = 0
  full = false
  /** Arduino pin (0–19) watched by each channel, -1 when unconnected. */
  channels: number[] = new Array(LOGIC_CHANNELS).fill(-1)
  /** Channel labels for the viewer / VCD (Arduino pin names). */
  labels: string[] = new Array(LOGIC_CHANNELS).fill('')

  reset(cycle: number) {
    this.cycles = []; this.masks = []; this.full = false
    this.start = cycle; this.last = cycle
  }

  record(cycle: number, mask: number) {
    this.last = cycle
    const n = this.masks.length
    if (n && this.masks[n - 1] === mask) return
    if (n >= LOGIC_MAX_EVENTS) { this.full = true; return }
    this.cycles.push(cycle); this.masks.push(mask)
  }

  /** Level of every channel at `cycle` (binary search over the changes). */
  maskAt(cycle: number): number {
    let lo = 0, hi = this.cycles.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.cycles[mid] <= cycle) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found < 0 ? 0 : this.masks[found]
  }

  /** Changes inside [from, to), plus the level at `from`. */
  window(from: number, to: number): { cycle: number; mask: number }[] {
    const out = [{ cycle: from, mask: this.maskAt(from) }]
    let lo = 0, hi = this.cycles.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cycles[mid] <= from) lo = mid + 1; else hi = mid }
    for (let i = lo; i < this.cycles.length && this.cycles[i] < to; i++) out.push({ cycle: this.cycles[i], mask: this.masks[i] })
    return out
  }

  /** Value Change Dump with 1 ps resolution (one AVR cycle = 62.5 ns). */
  toVcd(date = new Date()): string {
    const ids = Array.from({ length: LOGIC_CHANNELS }, (_, i) => String.fromCharCode(33 + i))
    const lines = [
      `$date ${date.toISOString()} $end`, '$version KodyUno logic analyzer $end', '$timescale 1ps $end',
      '$scope module logic $end',
      ...ids.map((id, i) => `$var wire 1 ${id} D${i}${this.labels[i] ? `_${this.labels[i]}` : ''} $end`),
      '$upscope $end', '$enddefinitions $end',
    ]
    const ps = (cycle: number) => Math.round((cycle - this.start) * (1e12 / CPU_HZ))
    let previous = -1
    const emit = (cycle: number, mask: number) => {
      const changed = previous < 0 ? 0xff : mask ^ previous
      if (!changed) return
      lines.push(`#${ps(cycle)}`)
      for (let i = 0; i < LOGIC_CHANNELS; i++) if (changed & (1 << i)) lines.push(`${(mask >> i) & 1}${ids[i]}`)
      previous = mask
    }
    emit(this.start, this.masks.length && this.cycles[0] <= this.start ? this.masks[0] : 0)
    for (let i = 0; i < this.cycles.length; i++) if (this.cycles[i] > this.start) emit(this.cycles[i], this.masks[i])
    lines.push(`#${ps(Math.max(this.last, this.start))}`)
    return lines.join('\n') + '\n'
  }
}

/** Captures by part id; the firmware runner writes, the inspector reads. */
export const logicCaptures = new Map<string, LogicCapture>()

export function captureFor(id: string): LogicCapture {
  let capture = logicCaptures.get(id)
  if (!capture) { capture = new LogicCapture(); logicCaptures.set(id, capture) }
  return capture
}

export const cyclesToMs = (cycles: number) => cycles / (CPU_HZ / 1000)
