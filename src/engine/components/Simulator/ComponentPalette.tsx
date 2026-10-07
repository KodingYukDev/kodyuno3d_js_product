import { useState } from 'react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { COMPONENT_CATALOG, type CatalogPart } from '@kodyuno/lib/componentCatalog'

export function ComponentPalette() {
  const addComponent = useKodyUnoStore((s) => s.addComponent)
  const [query, setQuery] = useState('')

  const handleAdd = (item: CatalogPart) => {
    const id = crypto.randomUUID()
    addComponent({
      id,
      type: item.type,
      label: item.label,
      pins: item.pins.map((p) => ({ ...p })),
    })
    // Select the new part, as Wokwi does, so R / Ctrl+D / Delete act on it.
    useKodyUnoStore.getState().selectComponent(id)
  }

  const q = query.trim().toLowerCase()
  const filtered = COMPONENT_CATALOG.filter((item) =>
    `${item.label} ${item.category} ${item.description}`.toLowerCase().includes(q),
  )
  const categories = [...new Set(filtered.map((item) => item.category))]

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-3 pt-3 pb-2 border-b border-slate-100">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Komponen</p>
        <p className="text-sm font-bold text-slate-700">Starter Kit Lengkap</p>
        <p className="text-[10px] text-slate-400">{COMPONENT_CATALOG.length} komponen interaktif</p>
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari sensor atau komponen"
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-amber-400 focus:bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {categories.map((category) => (
          <section key={category} className="mb-3">
            <p className="sticky top-0 z-10 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-white/95">{category}</p>
            <div className="grid grid-cols-2 gap-2">
              {filtered.filter((item) => item.category === category).map((item) => (
                <button
                  key={item.type}
                  onClick={() => handleAdd(item)}
                  className="uno-btn min-h-20 flex flex-col items-center justify-center gap-1 bg-white border border-slate-200 text-slate-700 hover:border-amber-400 hover:bg-amber-50 hover:shadow-sm rounded-xl p-2"
                  title={`${item.description} — klik untuk menambahkan`}
                >
                  <span className="text-2xl leading-none" aria-hidden>{item.emoji}</span>
                  <span className="text-[9px] font-semibold text-center leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {filtered.length === 0 && <p className="text-[11px] text-slate-400 text-center mt-4">Komponen tidak ditemukan.</p>}
      </div>
    </div>
  )
}
