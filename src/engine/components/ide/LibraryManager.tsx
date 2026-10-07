import { useEffect, useMemo, useRef, useState } from 'react'
import { searchLibraries, type SimLibrary, type UserLibrary } from '@kodyuno/lib/cpp/libs'
import { deleteUserLibrary, importLibraryZip, listUserLibraries, saveUserLibrary } from '@kodyuno/lib/libraryStore'

const SUPPORT_BADGE: Record<SimLibrary['support'], { label: string; className: string }> = {
  native: { label: 'Simulasi penuh', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  parsed: { label: 'Dari sumber', className: 'border-sky-300 bg-sky-50 text-sky-700' },
  stub: { label: 'Stub', className: 'border-slate-300 bg-slate-50 text-slate-600' },
}

const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`)

export interface LibraryManagerProps {
  onClose: () => void
  /** Insert an `#include` line at the top of the sketch. */
  onInclude: (header: string) => void
  onLibrariesChanged: (libraries: UserLibrary[]) => void
}

export function LibraryManager({ onClose, onInclude, onLibrariesChanged }: LibraryManagerProps) {
  const [tab, setTab] = useState<'search' | 'installed'>('search')
  const [query, setQuery] = useState('')
  const [installed, setInstalled] = useState<UserLibrary[]>([])
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const results = useMemo(() => searchLibraries(query), [query])

  const refresh = async () => {
    const libraries = await listUserLibraries()
    setInstalled(libraries)
    onLibrariesChanged(libraries)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setStatus(null)
    try {
      for (const file of Array.from(files)) {
        const result = await importLibraryZip(file)
        await saveUserLibrary(result.library)
        setStatus({
          tone: 'ok',
          text: `${result.library.name} ${result.library.version} terpasang — ${result.library.headers.length} header, ${result.files.length} berkas sumber.`,
        })
      }
      await refresh()
      setTab('installed')
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const remove = async (id: string) => {
    await deleteUserLibrary(id)
    await refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void handleFiles(event.dataTransfer.files)
        }}
      >
        <header className="border-b border-slate-100 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Library</p>
          <h2 className="text-lg font-bold text-slate-800">Library Manager</h2>
          <p className="text-xs text-slate-500">
            Semua library disimpan di perangkatmu. Tidak ada berkas yang dikirim ke server.
          </p>
          <nav className="mt-3 flex gap-1">
            {(['search', 'installed'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`uno-btn rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  tab === value ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {value === 'search' ? 'Cari library' : `Terpasang (${installed.length})`}
              </button>
            ))}
          </nav>
        </header>

        {tab === 'search' ? (
          <>
            <div className="px-5 py-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari: servo, oled, dht, wifi, neopixel…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:bg-white"
              />
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-4">
              {results.map((library) => {
                const badge = SUPPORT_BADGE[library.support]
                return (
                  <article key={library.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">{library.name}</h3>
                        <p className="text-[10px] text-slate-400">
                          {library.author} · v{library.version} · {library.category}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-slate-600">{library.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {library.headers.map((header) => (
                        <button
                          key={header}
                          onClick={() => onInclude(header)}
                          className="uno-btn rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600 hover:border-amber-400 hover:bg-amber-50"
                          title={`Sisipkan #include <${header}>`}
                        >
                          #include &lt;{header}&gt;
                        </button>
                      ))}
                    </div>
                  </article>
                )
              })}
              {results.length === 0 && (
                <p className="mt-6 text-center text-xs text-slate-400">
                  Tidak ada di katalog. Unggah ZIP-nya di tab “Terpasang” — KodyUno akan membaca sumbernya langsung.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-amber-400 hover:bg-amber-50/40">
              <input
                ref={fileInput}
                type="file"
                accept=".zip"
                multiple
                className="hidden"
                onChange={(event) => void handleFiles(event.target.files)}
              />
              <p className="text-sm font-semibold text-slate-700">{busy ? 'Membongkar ZIP…' : 'Tarik ZIP library ke sini'}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Atau klik untuk memilih berkas. Format sama seperti “Add .ZIP Library” di Arduino IDE.
              </p>
            </label>

            {status && (
              <p className={`rounded-lg px-3 py-2 text-[11px] ${status.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {status.text}
              </p>
            )}

            {installed.map((library) => (
              <article key={library.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{library.name}</h3>
                    <p className="text-[10px] text-slate-400">
                      {library.author} · v{library.version} · {formatSize(library.sizeBytes)}
                    </p>
                  </div>
                  <button
                    onClick={() => void remove(library.id)}
                    className="uno-btn rounded-md border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Hapus
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-600">{library.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {library.headers.slice(0, 8).map((header) => (
                    <button
                      key={header}
                      onClick={() => onInclude(header)}
                      className="uno-btn rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600 hover:border-amber-400 hover:bg-amber-50"
                    >
                      #include &lt;{header}&gt;
                    </button>
                  ))}
                </div>
                {library.types.length > 0 && (
                  <p className="mt-1.5 text-[10px] text-slate-400">
                    Kelas terdeteksi: {library.types.slice(0, 6).join(', ')}
                    {library.types.length > 6 ? ` +${library.types.length - 6}` : ''}
                  </p>
                )}
              </article>
            ))}

            {installed.length === 0 && !busy && (
              <p className="text-center text-xs text-slate-400">Belum ada library yang diunggah.</p>
            )}
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
