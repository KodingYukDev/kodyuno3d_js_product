import { useMemo } from 'react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { buildPlot } from '@kodyuno/lib/serialPlot'

const COLORS = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#f87171', '#22d3ee', '#a3e635']
const W = 600
const H = 240
const PAD = { left: 44, right: 8, top: 10, bottom: 18 }

/** Arduino-IDE-style Serial Plotter over the same serial log as the monitor. */
export function SerialPlotter() {
  const serialLog = useKodyUnoStore((state) => state.serialLog)
  const plot = useMemo(() => buildPlot(serialLog.map(line => line.text.replace(/\r$/, ''))), [serialLog])

  const values = plot.series.flatMap(series => series.values.filter((v): v is number => v !== null))
  if (!values.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px] italic text-slate-500">
        Kirim angka lewat Serial.println(nilai) — atau beberapa nilai dipisah spasi/koma, mis. "suhu:23.5 lembap:60" — untuk melihat grafik.
      </div>
    )
  }

  let min = Math.min(...values), max = Math.max(...values)
  if (min === max) { min -= 1; max += 1 }
  const span = max - min
  min -= span * 0.08; max += span * 0.08
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (plot.length <= 1 ? plotW : (i / (plot.length - 1)) * plotW)
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4)
  const fmt = (v: number) => Math.abs(v) >= 1000 || Number.isInteger(Math.round(v * 100) / 100) ? String(Math.round(v)) : v.toFixed(2)

  return (
    <div className="flex h-full flex-col px-2 py-1">
      <div className="flex flex-wrap gap-3 px-1 pb-1 font-mono text-[10px]">
        {plot.series.map((series, i) => {
          const last = [...series.values].reverse().find(v => v !== null)
          return (
            <span key={series.label} className="flex items-center gap-1 text-slate-300">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: COLORS[i] }} />
              {series.label}{last !== undefined && last !== null ? `: ${fmt(last)}` : ''}
            </span>
          )
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="min-h-0 flex-1" role="img" aria-label="Grafik Serial Plotter">
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#1e293b" strokeWidth="1" />
            <text x={PAD.left - 4} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="monospace">{fmt(tick)}</text>
          </g>
        ))}
        {plot.series.map((series, i) => {
          const points = series.values.map((v, index) => v === null ? null : `${x(index).toFixed(1)},${y(v).toFixed(1)}`)
          // Break the line where a series had no value on that row.
          const runs: string[][] = [[]]
          for (const point of points) { if (point) runs[runs.length - 1].push(point); else if (runs[runs.length - 1].length) runs.push([]) }
          return runs.filter(run => run.length).map((run, r) => (
            <polyline key={`${series.label}-${r}`} points={run.join(' ')} fill="none" stroke={COLORS[i]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          ))
        })}
      </svg>
    </div>
  )
}
