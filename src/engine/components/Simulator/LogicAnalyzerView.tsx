import { useEffect, useRef, useState } from 'react'
import { captureFor, cyclesToMs, LOGIC_CHANNELS } from '@kodyuno/lib/logicAnalyzer'

const WINDOWS: [string, number][] = [['0,1 ms', 1_600], ['1 ms', 16_000], ['10 ms', 160_000], ['100 ms', 1_600_000], ['1 s', 16_000_000]]
const COLORS = ['#a16207', '#dc2626', '#f97316', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#6b7280']
const W = 260, ROW = 18

/** Waveforms of the part's capture; `events` (from the part state) triggers redraws. */
export function LogicAnalyzerView({ id, events, recording }: { id: string; events: number; recording: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [span, setSpan] = useState(160_000)
  const capture = captureFor(id)
  const used = capture.channels.map((pin, ch) => ({ pin, ch })).filter(entry => entry.pin >= 0)

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const rows = Math.max(1, used.length)
    context.clearRect(0, 0, W, rows * ROW)
    const to = capture.last, from = Math.max(capture.start, to - span)
    const list = capture.window(from, to)
    used.forEach(({ ch }, row) => {
      const high = row * ROW + 3, low = row * ROW + ROW - 3
      context.strokeStyle = COLORS[ch]
      context.lineWidth = 1.2
      context.beginPath()
      let level = (list[0].mask >> ch) & 1
      context.moveTo(0, level ? high : low)
      for (const { cycle, mask } of list) {
        const next = (mask >> ch) & 1
        if (next === level) continue
        const x = ((cycle - from) / span) * W
        context.lineTo(x, level ? high : low)
        context.lineTo(x, next ? high : low)
        level = next
      }
      context.lineTo(W, level ? high : low)
      context.stroke()
    })
  }, [capture, events, span, used])

  const download = () => {
    const url = URL.createObjectURL(new Blob([capture.toVcd()], { type: 'text/plain' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'kodyuno-logic.vcd' })
    link.click()
    URL.revokeObjectURL(url)
  }

  return <div>
    <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Logic analyzer {recording && <span className="text-red-500">● merekam</span>}</p>
    {used.length === 0 ? <p className="text-[10px] text-slate-500">Hubungkan D0–D{LOGIC_CHANNELS - 1} ke pin Arduino lalu Jalankan dengan mesin firmware asli.</p> : <>
      <div className="flex gap-1">
        <div className="flex flex-col text-[9px] font-bold text-slate-500">{used.map(({ pin, ch }) => <span key={ch} style={{ height: ROW, lineHeight: `${ROW}px`, color: COLORS[ch] }}>D{ch}·{capture.labels[ch] || pin}</span>)}</div>
        <canvas ref={canvas} width={W} height={Math.max(1, used.length) * ROW} className="min-w-0 flex-1 rounded border border-slate-200 bg-slate-950" style={{ width: '100%', height: used.length * ROW }} aria-label="Grafik sinyal logic analyzer" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {WINDOWS.map(([label, cycles]) => <button key={label} type="button" aria-pressed={span === cycles} onClick={() => setSpan(cycles)}
          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${span === cycles ? 'border-sky-400 bg-sky-50 text-sky-700' : 'bg-slate-50 text-slate-600'}`}>{label}</button>)}
        <button type="button" onClick={download} disabled={!events} className="ml-auto rounded border border-emerald-400 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 disabled:opacity-40">Unduh .vcd</button>
      </div>
      <p className="mt-1 text-[9px] text-slate-400">{events} perubahan · {cyclesToMs(capture.last - capture.start).toFixed(1)} ms direkam{capture.full ? ' · buffer penuh' : ''} · buka .vcd di PulseView</p>
    </>}
  </div>
}
