import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { SimulatorCanvas } from './SimulatorCanvas'
import { SpeedSlowIcon, SpeedFastIcon } from '@kodyuno/components/icons/Icons'
import { ComponentInspector } from './ComponentInspector'

/**
 * Full-bleed simulator stage (Tinkercad-style): the canvas fills the
 * whole area; status, warnings and the speed control float on top.
 */
export function SimulatorPanel() {
  const runState         = useKodyUnoStore((s) => s.runState)
  const errorMessage     = useKodyUnoStore((s) => s.errorMessage)
  const components       = useKodyUnoStore((s) => s.components)
  const runSpeed         = useKodyUnoStore((s) => s.runSpeed)
  const setRunSpeed      = useKodyUnoStore((s) => s.setRunSpeed)

  const warnings = [...new Set(
    components
      .map((c) => (typeof c.state.warning === 'string' ? c.state.warning : null))
      .filter((w): w is string => w !== null),
  )]

  return (
    <div className="relative w-full h-full min-h-0 bg-slate-100 overflow-hidden">
      {/* subtle dot grid backdrop */}
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      <SimulatorCanvas />
      <ComponentInspector />

      {/* speed control — floating top-right */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-white/90 backdrop-blur border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
        <SpeedSlowIcon size={13} className="text-slate-400" />
        <input
          type="range" min={1} max={50} value={runSpeed}
          onChange={(e) => setRunSpeed(Number(e.target.value))}
          className="w-16 sm:w-20 accent-amber-500"
          title={`Kecepatan: ${runSpeed}x`}
        />
        <SpeedFastIcon size={13} className="text-amber-500" />
        <span className="text-[10px] font-mono font-bold text-amber-700 w-6">{runSpeed}x</span>
      </div>

      {/* error / circuit warnings — floating top-center */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 max-w-[70%] pointer-events-none">
        {runState === 'error' && errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className="text-xs text-red-700">⚠ {errorMessage}</span>
          </div>
        )}
        {warnings.slice(0, 3).map((w) => (
          <div key={w} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1 shadow-sm">
            <p className="text-[11px] text-amber-800">⚡ {w}</p>
          </div>
        ))}
        {warnings.length > 3 && (
          <p className="text-[10px] text-amber-600 bg-amber-50/80 rounded-full px-2">…dan {warnings.length - 3} masalah lain</p>
        )}
      </div>

      {/* empty-state hint */}
      {components.length === 0 && (
        <div className="absolute inset-x-0 top-1/2 z-10 flex justify-center pointer-events-none px-4">
          <p className="text-xs text-slate-400 bg-white/80 backdrop-blur rounded-full px-4 py-2 shadow-sm text-center">
            Belum ada komponen — pilih dari panel <span className="font-semibold">Komponen</span> di kanan.
          </p>
        </div>
      )}
    </div>
  )
}
