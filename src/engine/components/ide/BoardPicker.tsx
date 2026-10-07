import { useState } from 'react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { BOARD_LIST, getBoard } from '@kodyuno/lib/boards'
import type { BoardType } from '@kodyuno/types'

const FAMILY_LABEL: Record<string, string> = {
  arduino: 'Arduino',
  esp32: 'ESP32',
  esp8266: 'ESP8266',
}

const FAMILY_ACCENT: Record<string, string> = {
  arduino: 'border-teal-300 bg-teal-50 text-teal-700',
  esp32: 'border-indigo-300 bg-indigo-50 text-indigo-700',
  esp8266: 'border-emerald-300 bg-emerald-50 text-emerald-700',
}

/**
 * Board selector. Changing the board clears the wiring on purpose: pin ids
 * differ between an Uno header and an ESP32 header, so keeping the old
 * wires would silently connect components to pins that no longer exist.
 */
export function BoardPicker({ onClose }: { onClose: () => void }) {
  const boardType = useKodyUnoStore((state) => state.boardType)
  const setBoardType = useKodyUnoStore((state) => state.setBoardType)
  const wireCount = useKodyUnoStore((state) => state.wires.length)
  const [pending, setPending] = useState<BoardType | null>(null)

  const current = getBoard(boardType)
  const families = [...new Set(BOARD_LIST.map((board) => board.family))]

  const choose = (id: BoardType) => {
    if (id === boardType) {
      onClose()
      return
    }
    if (wireCount > 0) {
      setPending(id)
      return
    }
    setBoardType(id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pilih papan</p>
          <h2 className="text-lg font-bold text-slate-800">Board KodyUno</h2>
          <p className="text-xs text-slate-500">
            Sekarang aktif: <span className="font-semibold text-slate-700">{current.name}</span> · {current.mcu} · logika {current.logicVolts}V
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {families.map((family) => (
            <section key={family}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{FAMILY_LABEL[family] ?? family}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {BOARD_LIST.filter((board) => board.family === family).map((board) => {
                  const active = board.id === boardType
                  return (
                    <button
                      key={board.id}
                      onClick={() => choose(board.id)}
                      className={`uno-btn text-left rounded-xl border p-3 transition ${
                        active
                          ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200'
                          : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-bold text-slate-800">{board.name}</span>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${FAMILY_ACCENT[board.family]}`}>
                          {board.shortName}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-slate-500">{board.blurb}</p>
                      <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                        <span>{board.cpuMHz} MHz</span>
                        <span>{board.ramKB} KB RAM</span>
                        <span>ADC {board.adcBits}-bit</span>
                        <span>{board.logicVolts}V</span>
                        {board.hasWiFi && <span className="text-indigo-500">WiFi</span>}
                        {board.hasBLE && <span className="text-indigo-500">BLE</span>}
                      </dl>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        {pending && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-3">
            <p className="text-xs text-amber-800">
              Ganti ke <b>{getBoard(pending).name}</b> akan menghapus {wireCount} kabel, karena nama pin di papan baru berbeda.
              Komponen di kanvas tetap ada.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  setBoardType(pending)
                  setPending(null)
                  onClose()
                }}
                className="uno-btn rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
              >
                Ganti papan
              </button>
              <button
                onClick={() => setPending(null)}
                className="uno-btn rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white"
              >
                Batal
              </button>
            </div>
          </div>
        )}

        <footer className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="uno-btn rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Tutup
          </button>
        </footer>
      </div>
    </div>
  )
}
