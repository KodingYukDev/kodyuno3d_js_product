import { useEffect, useRef } from 'react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { TerminalIcon } from '@kodyuno/components/icons/Icons'

export function SerialMonitor() {
  const serialLog = useKodyUnoStore((s) => s.serialLog)
  const clearSerial = useKodyUnoStore((s) => s.clearSerial)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest line
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [serialLog])

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400 font-mono"><TerminalIcon size={14} /> Serial Monitor</span>
        <button
          onClick={clearSerial}
          className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
        >
          Bersihkan
        </button>
      </div>

      <div className="serial-monitor flex-1 overflow-y-auto">
        {serialLog.length === 0 ? (
          <span className="text-slate-600 italic">// Tidak ada output Serial...</span>
        ) : (
          serialLog.map((line) => (
            <div key={line.id} className="leading-relaxed whitespace-pre-wrap break-all">
              {line.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
