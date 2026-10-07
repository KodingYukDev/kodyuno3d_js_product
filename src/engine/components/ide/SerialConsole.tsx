import { useEffect, useRef, useState } from 'react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { SerialPlotter } from './SerialPlotter'
import { baudMismatch, garble } from '@kodyuno/lib/serialBaud'

// The Arduino IDE's list; 9600 is its default.
const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000]
const BAUD_KEY = 'kodyuno.serialBaud'

function storedBaud() {
  try {
    const value = Number(localStorage.getItem(BAUD_KEY))
    return BAUD_RATES.includes(value) ? value : 9600
  } catch {
    return 9600
  }
}

const LINE_ENDINGS: { id: string; label: string; suffix: string }[] = [
  { id: 'none', label: 'Tanpa akhiran', suffix: '' },
  { id: 'nl', label: 'Newline', suffix: '\n' },
  { id: 'cr', label: 'Carriage return', suffix: '\r' },
  { id: 'crnl', label: 'NL + CR', suffix: '\r\n' },
]

/**
 * Serial monitor with a working input line: what you type is queued as bytes
 * the sketch reads back through Serial.available() / Serial.read().
 */
export function SerialConsole() {
  const serialLog = useKodyUnoStore((state) => state.serialLog)
  const serialPending = useKodyUnoStore((state) => state.serialPending)
  const clearSerial = useKodyUnoStore((state) => state.clearSerial)
  const sendSerialInput = useKodyUnoStore((state) => state.sendSerialInput)
  const runState = useKodyUnoStore((state) => state.runState)
  const sketchBaud = useKodyUnoStore((state) => state.sketchBaud)

  const [draft, setDraft] = useState('')
  const [baud, setBaudState] = useState(storedBaud)
  const setBaud = (value: number) => {
    setBaudState(value)
    try { localStorage.setItem(BAUD_KEY, String(value)) } catch { /* private mode */ }
  }
  const mismatch = baudMismatch(baud, sketchBaud)
  const shown = (text: string) => (mismatch && sketchBaud ? garble(text, baud, sketchBaud) : text)
  const rates = sketchBaud && !BAUD_RATES.includes(sketchBaud) ? [...BAUD_RATES, sketchBaud].sort((a, b) => a - b) : BAUD_RATES
  const [ending, setEnding] = useState(LINE_ENDINGS[1])
  const [autoScroll, setAutoScroll] = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [view, setView] = useState<'monitor' | 'plotter'>('monitor')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [serialLog, serialPending, autoScroll])

  const send = () => {
    if (!draft) return
    // At the wrong baud the sketch receives junk too, as on real hardware.
    sendSerialInput(mismatch && sketchBaud ? garble(draft + ending.suffix, baud, sketchBaud) : draft + ending.suffix)
    setDraft('')
  }

  const stamp = (ts: number) => new Date(ts).toLocaleTimeString('id-ID', { hour12: false })

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5">
        <div className="flex overflow-hidden rounded border border-slate-700" role="group" aria-label="Tampilan Serial">
          {(['monitor', 'plotter'] as const).map(mode => (
            <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}
              className={`px-2 py-0.5 font-mono text-[11px] font-semibold ${view === mode ? 'bg-emerald-600 text-white' : 'text-emerald-400 hover:bg-slate-800'}`}>
              {mode === 'monitor' ? 'Serial Monitor' : 'Plotter'}
            </button>
          ))}
        </div>
        <span className={`h-1.5 w-1.5 rounded-full ${runState === 'running' ? 'bg-emerald-400' : 'bg-slate-600'}`} />

        <select
          value={baud}
          onChange={(event) => setBaud(Number(event.target.value))}
          className="ml-auto rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300"
          title="Harus sama dengan Serial.begin() di sketch, seperti Serial Monitor Arduino"
        >
          {rates.map((rate) => (
            <option key={rate} value={rate}>{rate} baud</option>
          ))}
        </select>

        <select
          value={ending.id}
          onChange={(event) => setEnding(LINE_ENDINGS.find((item) => item.id === event.target.value) ?? LINE_ENDINGS[0])}
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300"
        >
          {LINE_ENDINGS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>

        <button
          onClick={() => setShowTimestamps((value) => !value)}
          className={`rounded px-1.5 py-0.5 text-[10px] ${showTimestamps ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          Waktu
        </button>
        <button
          onClick={() => setAutoScroll((value) => !value)}
          className={`rounded px-1.5 py-0.5 text-[10px] ${autoScroll ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          Auto-scroll
        </button>
        <button onClick={clearSerial} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700">
          Bersihkan
        </button>
      </div>

      {mismatch && sketchBaud && (
        <div className="flex items-center gap-2 border-b border-amber-700/50 bg-amber-950/60 px-3 py-1 text-[11px] text-amber-200">
          <span>Serial Monitor {baud} baud, sketch memakai <code>Serial.begin({sketchBaud})</code>. Di Arduino asli teksnya jadi acak seperti ini.</span>
          <button type="button" onClick={() => setBaud(sketchBaud)} className="ml-auto rounded bg-amber-600 px-2 py-0.5 font-semibold text-white hover:bg-amber-500">
            Pakai {sketchBaud} baud
          </button>
        </div>
      )}

      {view === 'plotter' ? <div className="min-h-0 flex-1"><SerialPlotter /></div> : <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-200">
        {serialLog.length === 0 && !serialPending ? (
          <span className="italic text-slate-600">// Belum ada keluaran Serial. Jalankan sketch untuk melihat hasilnya.</span>
        ) : (
          serialLog.map((line) => (
            <div key={line.id} className="whitespace-pre-wrap break-all">
              {showTimestamps && <span className="mr-2 text-slate-600">{stamp(line.ts)}</span>}
              {shown(line.text)}
            </div>
          ))
        )}
        {serialPending && (
          <div className="whitespace-pre-wrap break-all text-emerald-300/80">
            {showTimestamps && <span className="mr-2 text-slate-600">{stamp(Date.now())}</span>}
            {shown(serialPending)}
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-400 align-middle" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>}

      <div className="flex gap-2 border-t border-slate-800 px-3 py-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
          placeholder="Ketik untuk dikirim ke sketch (Serial.read)…"
          className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500"
        />
        <button
          onClick={send}
          className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          disabled={!draft}
        >
          Kirim
        </button>
      </div>
    </div>
  )
}
