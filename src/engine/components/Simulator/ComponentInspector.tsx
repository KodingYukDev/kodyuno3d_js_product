import type { ComponentType } from '@kodyuno/types'
import { LogicAnalyzerView } from './LogicAnalyzerView'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { catalogPart } from '@kodyuno/lib/componentCatalog'

interface RangeControl { key: string; label: string; min: number; max: number; step?: number; unit?: string }

const RANGES: Partial<Record<ComponentType, RangeControl[]>> = {
  servo: [{ key: 'angle', label: 'Sudut', min: 0, max: 180, unit: '°' }],
  potentiometer: [{ key: 'value', label: 'Nilai analog', min: 0, max: 1023 }],
  ldr: [
    { key: 'level', label: 'Intensitas cahaya', min: 0, max: 1023 },
    { key: 'threshold', label: 'Ambang digital', min: 0, max: 1023 },
  ],
  sound_sensor: [
    { key: 'level', label: 'Tingkat suara', min: 0, max: 1023 },
    { key: 'threshold', label: 'Ambang digital', min: 0, max: 1023 },
  ],
  dht11: [
    { key: 'temperature', label: 'Suhu', min: -10, max: 80, unit: '°C' },
    { key: 'humidity', label: 'Kelembapan', min: 0, max: 100, unit: '%' },
  ],
  ds18b20: [{ key: 'temperature', label: 'Suhu', min: -55, max: 125, step: 0.1, unit: '°C' }],
  lm35: [{ key: 'temperature', label: 'Suhu', min: -20, max: 100, unit: '°C' }],
  ultrasonic: [{ key: 'distanceCm', label: 'Jarak objek', min: 2, max: 400, unit: ' cm' }],
  water_sensor: [{ key: 'level', label: 'Ketinggian air', min: 0, max: 1023 }],
  gas_sensor: [
    { key: 'level', label: 'Konsentrasi gas', min: 0, max: 1023 },
    { key: 'threshold', label: 'Ambang digital', min: 0, max: 1023 },
  ],
  flame_sensor: [
    { key: 'level', label: 'Intensitas api', min: 0, max: 1023 },
    { key: 'threshold', label: 'Ambang digital', min: 0, max: 1023 },
  ],
  joystick: [
    { key: 'x', label: 'Sumbu X', min: 0, max: 1023 },
    { key: 'y', label: 'Sumbu Y', min: 0, max: 1023 },
  ],
  rotary_encoder: [{ key: 'value', label: 'Posisi', min: -100, max: 100 }],
  seven_segment: [{ key: 'value', label: 'Angka', min: 0, max: 9 }],
  stepper: [{ key: 'angle', label: 'Sudut poros', min: 0, max: 359, unit: '°' }],
  dht22: [
    { key: 'temperature', label: 'Suhu', min: -40, max: 80, unit: '°C' },
    { key: 'humidity', label: 'Kelembapan', min: 0, max: 100, unit: '%' },
  ],
  ntc_temp: [{ key: 'temperature', label: 'Suhu', min: -20, max: 120, unit: '°C' }],
  heart_sensor: [
    { key: 'bpm', label: 'Detak per menit', min: 40, max: 200, unit: ' BPM' },
    { key: 'level', label: 'Sinyal analog', min: 0, max: 1023 },
  ],
  hx711: [{ key: 'weightGram', label: 'Beban', min: 0, max: 5000, step: 10, unit: ' g' }],
  slide_switch: [{ key: 'value', label: 'Posisi sakelar', min: 0, max: 1 }],
  mpu6050: [
    { key: 'ax', label: 'Akselerasi X', min: -2, max: 2, step: 0.05, unit: ' g' },
    { key: 'ay', label: 'Akselerasi Y', min: -2, max: 2, step: 0.05, unit: ' g' },
    { key: 'az', label: 'Akselerasi Z', min: -2, max: 2, step: 0.05, unit: ' g' },
  ],
}

const TOGGLES: Partial<Record<ComponentType, { key: string; label: string }[]>> = {
  pushbutton: [{ key: 'pressed', label: 'Tombol ditekan' }, { key: 'noBounce', label: 'Tanpa bouncing (tombol ideal)' }],
  pir: [{ key: 'detected', label: 'Gerakan terdeteksi' }],
  joystick: [{ key: 'pressed', label: 'Tombol joystick' }],
  rotary_encoder: [{ key: 'pressed', label: 'Tombol encoder' }],
  tilt_switch: [{ key: 'tilted', label: 'Sensor dimiringkan' }],
  microsd: [{ key: 'mounted', label: 'Kartu SD terpasang' }],
}

/** Common 21-key "Car MP3" NEC remote from Arduino starter kits (address 0x00). */
const IR_REMOTE: Array<[string, number]> = [
  ['CH−', 0x45], ['CH', 0x46], ['CH+', 0x47], ['⏮', 0x44], ['⏭', 0x40], ['⏯', 0x43], ['−', 0x07], ['+', 0x15], ['EQ', 0x09],
  ['0', 0x16], ['100+', 0x19], ['200+', 0x0d], ['1', 0x0c], ['2', 0x18], ['3', 0x5e], ['4', 0x08], ['5', 0x1c], ['6', 0x5a],
  ['7', 0x42], ['8', 0x52], ['9', 0x4a],
]

/** A key is held briefly and then released, like a finger on a real keypad. */
function pressKey(id: string, key: string) {
  const store = useKodyUnoStore.getState()
  store.updateComponentState(id, { key })
  window.setTimeout(() => {
    const current = useKodyUnoStore.getState().components.find(c => c.id === id)
    if (current?.state.key === key) useKodyUnoStore.getState().updateComponentState(id, { key: '' })
  }, 250)
}

/** Send one NEC frame: firmware sees the pulse train, the interpreter a short pulse. */
function sendIr(id: string, command: number) {
  const store = useKodyUnoStore.getState()
  const current = store.components.find(c => c.id === id)
  store.updateComponentState(id, { code: command, address: 0, sendSeq: Number(current?.state.sendSeq ?? 0) + 1, active: true })
  window.setTimeout(() => useKodyUnoStore.getState().updateComponentState(id, { active: false }), 120)
}

/** Save one file from the simulated SD card to the computer. */
function downloadSdFile(file: { name: string; content: string }) {
  const bytes = Uint8Array.from(file.content, c => c.charCodeAt(0) & 0xff)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click()
  URL.revokeObjectURL(url)
}

/** Cards to hold on the RC522, as in Wokwi's card picker. Each keeps its own memory. */
const RFID_CARDS: [string, string][] = [
  ['Kartu putih', 'DE AD BE EF'],
  ['Gantungan biru', 'A3 5F 21 9C'],
  ['Kartu siswa', '7B 12 C4 08'],
  ['NTAG (7 byte)', '04 A2 2B 3C 4D 5E 80'],
]

export function ComponentInspector() {
  const selectedId = useKodyUnoStore((state) => state.selectedComponentId)
  const component = useKodyUnoStore((state) => state.components.find((item) => item.id === selectedId))
  const update = useKodyUnoStore((state) => state.updateComponentState)
  const select = useKodyUnoStore((state) => state.selectComponent)
  if (!component) return null

  const catalog = catalogPart(component.type)
  const ranges = RANGES[component.type] ?? []
  const toggles = TOGGLES[component.type] ?? []
  const hasControls = ranges.length > 0 || toggles.length > 0 || component.type === 'rfid' || component.type === 'microsd' || component.type === 'logic_analyzer' || component.type === 'multimeter' || component.type === 'ir_receiver' || component.type === 'keypad' || component.type === 'led_matrix' || component.type === 'dip_switch'

  return (
    <aside className="absolute right-3 top-3 z-20 w-72 max-h-[70%] overflow-y-auto rounded-xl border border-slate-200 bg-white/95 backdrop-blur shadow-xl">
      <header className="sticky top-0 z-10 flex items-start gap-2 px-3 py-2 border-b border-slate-100 bg-white/95">
        <span className="text-xl" aria-hidden>{catalog?.emoji ?? '🔧'}</span>
        <div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800 truncate">{component.label}</p><p className="text-[9px] text-slate-400">{catalog?.description}</p></div>
        <button onClick={() => select(null)} className="text-slate-400 hover:text-slate-700" aria-label="Tutup">×</button>
      </header>
      <div className="p-3 space-y-3">
        {ranges.map((control) => {
          const value = Number(component.state[control.key] ?? control.min)
          return <label key={control.key} className="block"><span className="mb-1 flex justify-between text-[10px] font-semibold text-slate-600"><span>{control.label}</span><output className="font-mono text-amber-700">{value}{control.unit}</output></span><input type="range" min={control.min} max={control.max} step={control.step ?? 1} value={value} onChange={(event) => update(component.id, { [control.key]: Number(event.target.value) })} className="w-full accent-amber-500" /></label>
        })}
        {toggles.map((control) => {
          const active = component.state[control.key] === true
          return <button key={control.key} onClick={() => update(component.id, { [control.key]: !active })} className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold ${active ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{active ? '● ' : '○ '}{control.label}</button>
        })}
        {component.type === 'logic_analyzer' && <LogicAnalyzerView id={component.id} events={Number(component.state.events ?? 0)} recording={component.state.recording === true} />}
        {component.type === 'microsd' && (() => {
          const files = (Array.isArray(component.state.files) ? component.state.files : []) as { name: string; content: string }[]
          return <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Isi kartu SD (FAT16)</p>
            {files.length === 0 ? <p className="text-[10px] text-slate-500">Kosong. File yang ditulis sketch muncul di sini.</p>
              : <ul className="space-y-0.5">{files.map(file => <li key={file.name} className="flex items-center gap-1 text-[10px]">
                <span className="min-w-0 flex-1 truncate font-mono text-slate-700" title={file.content.slice(0, 200)}>{file.name}</span>
                <span className="text-slate-400">{file.content.length} B</span>
                <button type="button" onClick={() => downloadSdFile(file)} className="rounded border px-1 text-[9px] font-bold text-emerald-700">Unduh</button>
                <button type="button" onClick={() => update(component.id, { files: files.filter(entry => entry.name !== file.name) })} className="rounded border px-1 text-[9px] font-bold text-red-600" aria-label={`Hapus ${file.name}`}>✕</button>
              </li>)}</ul>}
          </div>
        })()}
        {component.type === 'rfid' && <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Tempelkan kartu</p><div className="grid grid-cols-2 gap-1">{RFID_CARDS.map(([label, uid]) => {
          const on = component.state.cardPresent === true && component.state.uid === uid
          return <button key={uid} aria-pressed={on} onClick={() => update(component.id, on ? { cardPresent: false } : { cardPresent: true, uid })} title={`UID ${uid}`}
            className={`rounded border py-1 text-[10px] font-bold ${on ? 'border-violet-400 bg-violet-50 text-violet-700' : 'bg-slate-50 text-slate-700'}`}>{label}</button>
        })}</div><p className="mt-1 text-[9px] text-slate-400">{component.state.cardPresent ? `UID ${String(component.state.uid)} · klik lagi untuk mengangkat` : 'Tidak ada kartu di atas pembaca'}</p></div>}
        {component.type === 'ir_receiver' && <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Remote IR (NEC)</p><div className="grid grid-cols-3 gap-1">{IR_REMOTE.map(([label, command]) => <button key={label} onClick={() => sendIr(component.id, command)} className={`rounded border py-1 text-[10px] font-bold ${component.state.code === command ? 'border-red-400 bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'}`}>{label}</button>)}</div><p className="mt-1 text-[9px] text-slate-400">Kode terakhir: 0x{Number(component.state.code ?? 0).toString(16).toUpperCase().padStart(2, '0')}</p></div>}
        {component.type === 'multimeter' && <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Mode ukur</p><div className="grid grid-cols-3 gap-1">{([['V', 'Tegangan V'], ['mA', 'Arus mA'], ['ohm', 'Hambatan Ω']] as const).map(([mode, label]) => <button key={mode} onClick={() => update(component.id, { mode })} className={`rounded border py-1.5 text-[10px] font-bold ${(component.state.mode ?? 'V') === mode ? 'border-amber-500 bg-amber-500 text-white' : 'bg-slate-50 text-slate-700'}`}>{label}</button>)}</div><p className="mt-1 text-[9px] leading-relaxed text-slate-400">Probe merah (V) dan hitam (COM). Mode mA dipasang seri di jalur arus; mode Ω dipakai saat rangkaian tidak diberi daya.</p></div>}
        {component.type === 'keypad' && <div className="grid grid-cols-4 gap-1">{'123A456B789C*0#D'.split('').map((key) => <button key={key} onClick={() => pressKey(component.id, key)} className={`rounded border py-1.5 text-xs font-bold ${component.state.key === key ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-700'}`}>{key}</button>)}</div>}
        {component.type === 'dip_switch' && <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">DIP 1–8</p><div className="grid grid-cols-8 gap-1">{Array.from({ length: 8 }, (_, index) => { const values = Array.isArray(component.state.values) ? [...component.state.values] : Array(8).fill(0); const active = Boolean(values[index]); return <button key={index} onClick={() => { values[index] = active ? 0 : 1; update(component.id, { values }) }} className={`rounded border py-1 text-[9px] font-bold ${active ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{index + 1}</button> })}</div></div>}
        {component.type === 'led_matrix' && <div className="flex gap-2"><button onClick={() => update(component.id, { pixels: [0,7,9,14,18,21,27,28,35,36,42,45,49,54,56,63] })} className="flex-1 rounded-lg bg-red-500 px-2 py-1.5 text-[10px] font-bold text-white">Pola hati</button><button onClick={() => update(component.id, { pixels: [] })} className="rounded-lg border px-2 py-1.5 text-[10px]">Hapus</button></div>}
        {!hasControls && <p className="text-[10px] leading-relaxed text-slate-400">Komponen output ini bereaksi otomatis terhadap kode dan rangkaian.</p>}
        <div className="pt-2 border-t border-slate-100"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">Terminal</p><div className="flex flex-wrap gap-1">{Object.keys(component.circuit?.rolePins ?? {}).map((role) => <span key={role} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">{role}: {String(component.circuit?.rolePins[role] || '—')}</span>)}</div></div>
      </div>
    </aside>
  )
}
