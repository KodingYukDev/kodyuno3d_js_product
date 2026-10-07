import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useKodyUnoStore } from '@kodyuno/store/useKodyUnoStore'
import { getBoard } from '@kodyuno/lib/boards'
import { SimulatorCanvas } from '@kodyuno/components/Simulator/SimulatorCanvas'
import { Scene3D, type Scene3DHandle } from '../three/Scene3D'
import { startBuzzerAudio } from '../three/buzzerAudio'
import { defaultQuality, isTouchDevice, saveQuality, type Quality } from '../three/quality'
import { ComponentPalette } from '@kodyuno/components/Simulator/ComponentPalette'
import { ComponentInspector } from '@kodyuno/components/Simulator/ComponentInspector'
import { PlayIcon, StopIcon, ChipIcon } from '@kodyuno/components/icons/Icons'
import { BoardPicker } from '@kodyuno/components/ide/BoardPicker'
import { LibraryManager } from '@kodyuno/components/ide/LibraryManager'
import { SerialConsole } from '@kodyuno/components/ide/SerialConsole'
import { createSimulatorHardware } from '@kodyuno/lib/interpreter/hardwareBridge'
import { CompileError, runSketch, type SketchRun } from '@kodyuno/lib/cpp/sketch'
import type { UserLibrary } from '@kodyuno/lib/cpp/libs'
import { listUserLibraries } from '@kodyuno/lib/libraryStore'
import { BLANK_SKETCH, examplesForBoard, type SketchExample } from '@kodyuno/lib/examples'
import { COMPONENT_CATALOG } from '@kodyuno/lib/componentCatalog'
import { MAX_FIRMWARE_BYTES, parseProject, serializeProject, validateProjectFirmware } from '@kodyuno/lib/projectDocument'
import { startProjectAutosave } from '@kodyuno/lib/projectAutosave'
import { createHardwareSession } from '@kodyuno/lib/hardwareSession'
import { startAvrFirmware } from '@kodyuno/lib/firmware/browserRun'
import { LIBRARIES_FILE, MAIN_FILE, checkFileName, compileFiles, missingLibraries } from '@kodyuno/lib/sketchFiles'
import { CompilerTimeoutError, CompilerUnavailableError, compileSketch, type CompiledArtifact } from '@kodyuno/lib/compilerClient'
import { decodeShare, encodeShare, SHARE_PARAM, shareCodeFromHash } from '@kodyuno/lib/projectShare'

const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 5, label: '5×' },
  { value: 10, label: '10×' },
]

/**
 * KodyUno IDE. On an Uno, Jalankan works like Wokwi: the sketch is compiled
 * on the server (Cloud Run, cached) and the real firmware runs on avr8js in
 * the browser. Other boards, or no reachable compiler, use the educational
 * C++ interpreter.
 */
export default function KodyUnoIdePage() {
  const boardType = useKodyUnoStore((state) => state.boardType)
  const runState = useKodyUnoStore((state) => state.runState)
  const setRunState = useKodyUnoStore((state) => state.setRunState)
  const errorMessage = useKodyUnoStore((state) => state.errorMessage)
  const setErrorMessage = useKodyUnoStore((state) => state.setErrorMessage)
  const sketchCode = useKodyUnoStore((state) => state.sketchCode)
  const setSketchCode = useKodyUnoStore((state) => state.setSketchCode)
  const extraFiles = useKodyUnoStore((state) => state.extraFiles)
  const setExtraFile = useKodyUnoStore((state) => state.setExtraFile)
  const removeExtraFile = useKodyUnoStore((state) => state.removeExtraFile)
  /** Tab shown in the editor: sketch.ino, a header/source, or libraries.txt. */
  const [activeFile, setActiveFile] = useState(MAIN_FILE)
  const [addingFile, setAddingFile] = useState<string | null>(null)
  const [fileNameError, setFileNameError] = useState<string | null>(null)
  const resetPins = useKodyUnoStore((state) => state.resetPins)
  const clearSerial = useKodyUnoStore((state) => state.clearSerial)
  const appendSerial = useKodyUnoStore((state) => state.appendSerial)
  const addComponent = useKodyUnoStore((state) => state.addComponent)
  const components = useKodyUnoStore((state) => state.components)

  const [showBoards, setShowBoards] = useState(false)
  const [menu, setMenu] = useState<'more' | 'examples' | null>(null)
  const [view, setView] = useState<'3d' | '2d'>(() => (localStorage.getItem('kodyuno3d-view') === '2d' ? '2d' : '3d'))
  const [quality, setQuality] = useState<Quality>(defaultQuality)
  const [touch] = useState(isTouchDevice)
  const [showParts, setShowParts] = useState(false)
  useEffect(() => saveQuality(quality), [quality])
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(muted)
  const sceneRef = useRef<Scene3DHandle | null>(null)
  useEffect(() => { try { localStorage.setItem('kodyuno3d-view', view) } catch { /* storage unavailable */ } }, [view])
  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => startBuzzerAudio(() => mutedRef.current), [])
  // Code docks beside the bench on wide screens; tablets start with the bench alone.
  const [showCode, setShowCode] = useState(() => window.innerWidth >= 1280)
  const [showSerial, setShowSerial] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const undoCount = useKodyUnoStore(state => state.undoStack.length)
  const redoCount = useKodyUnoStore(state => state.redoStack.length)
  const [showLibraries, setShowLibraries] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [userLibraries, setUserLibraries] = useState<UserLibrary[]>([])
  const [rightTab, setRightTab] = useState<'parts' | 'pins'>('parts')
  const [backend, setBackend] = useState<'auto' | 'sketch' | 'avr'>('auto')
  /** A compile started by Jalankan is in flight (auto mode). */
  const [preparing, setPreparing] = useState(false)
  const firmware = useKodyUnoStore(state => state.firmware)
  const setFirmware = useKodyUnoStore(state => state.setFirmware)
  const firmwareRef = useRef<{ stop(): void } | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [compileLogs, setCompileLogs] = useState('')
  const [compiledArtifact, setCompiledArtifact] = useState<CompiledArtifact | null>(null)
  /** The manual Compile button's request. Jalankan has its own (runCompile). */
  const compileRequest = useRef<AbortController | null>(null)
  const runCompile = useRef<AbortController | null>(null)

  useEffect(() => {
    const cancel = () => { compileRequest.current?.abort(); compileRequest.current = null }
    // Editing the sketch or board invalidates a finished artifact, but a run's
    // own compile is cancelled only by Stop/board change (see stop()).
    const unsubscribe = useKodyUnoStore.subscribe((state, previous) => {
      if (state.sketchCode !== previous.sketchCode || state.boardType !== previous.boardType ||
          state.firmware !== previous.firmware || state.extraFiles !== previous.extraFiles) {
        cancel(); setCompiling(false); setCompiledArtifact(null)
      }
    })
    return () => { cancel(); runCompile.current?.abort(); unsubscribe() }
  }, [])

  const compile = async () => {
    const token = undefined
    if (boardType !== 'uno' && boardType !== 'mega' && boardType !== 'esp8266') return
    compileRequest.current?.abort()
    const controller = new AbortController()
    compileRequest.current = controller
    setCompiling(true); setCompileLogs('Compile…'); setCompiledArtifact(null)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 150000)
    try {
      const artifact = await compileSketch(boardType === 'esp8266' ? 'nodemcu-esp8266' : boardType === 'mega' ? 'mega' : 'uno', compileFiles(sketchCode, extraFiles), token, controller.signal)
      if (controller.signal.aborted || !mountedRef.current) return
      if (artifact.target === 'uno') {
        const payload = validateProjectFirmware({ version: 1, format: 'intel-hex', boardType: 'uno', name: artifact.filename, hex: new TextDecoder().decode(artifact.bytes) }, 'uno')
        stop()
        setFirmware(payload)
        setBackend('avr')
      }
      setCompiledArtifact(artifact)
      setCompileLogs(`${artifact.logs}\n${artifact.target === 'uno' ? 'HEX siap. Klik Jalankan untuk AVR.' : artifact.target === 'mega' ? 'HEX Mega siap diunduh; mesin Otomatis menjalankannya langsung.' : 'BIN siap diunduh. Eksekusi firmware ESP belum didukung.'}`)
    } catch (error) {
      if (mountedRef.current && compileRequest.current === controller) setCompileLogs(timedOut ? 'Compile melewati batas waktu.' : controller.signal.aborted ? 'Compile dibatalkan.' : error instanceof Error ? error.message : 'Compile gagal.')
    } finally {
      clearTimeout(timeout)
      if (mountedRef.current && (compileRequest.current === controller || compileRequest.current === null)) setCompiling(false)
    }
  }

  const runRef = useRef<SketchRun | null>(null)
  const runGeneration = useRef(0)
  const hardwareRef = useRef<ReturnType<typeof createHardwareSession> | null>(null)
  const mountedRef = useRef(false)
  const fileGeneration = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const board = useMemo(() => getBoard(boardType), [boardType])
  /** Uno/Nano/Mega always run real firmware; the interpreter is only for boards without an emulator. */
  const isAvrBoard = boardType === 'uno' || boardType === 'nano' || boardType === 'mega'
  const examples = useMemo(() => examplesForBoard(boardType), [boardType])

  useEffect(() => {
    let active = true
    void listUserLibraries().then(libraries => { if (active) setUserLibraries(libraries) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = useCallback(() => {
    runGeneration.current++
    // The runner's own cleanup (SD flush, noTone, analyzer patch, PWM to 0)
    // writes through the session, so revoke only after it ran.
    runRef.current?.stop()
    runRef.current = null
    firmwareRef.current?.stop()
    firmwareRef.current = null
    hardwareRef.current?.revoke()
    hardwareRef.current = null
    runCompile.current?.abort()
    runCompile.current = null
    setPreparing(false)
    // Like Wokwi/Tinkercad: stopping leaves the parts in their power-on state,
    // so a pin the sketch left HIGH cannot raise a short on the next edit.
    resetPins()
    setRunState('idle')
  }, [setRunState, resetPins])

  // A sketch left running would keep touching the store after unmount.
  useEffect(() => {
    mountedRef.current = true
    const disposeAutosave = startProjectAutosave(message => {
      if (mountedRef.current) setSaveError(message)
    })
    // Read after restore; initial render may have captured an empty sketch.
    if (!useKodyUnoStore.getState().sketchCode) setSketchCode(BLANK_SKETCH)
    // A share link wins over the autosave: that is the project someone sent.
    const shared = shareCodeFromHash(window.location.hash)
    if (shared) {
      void decodeShare(shared).then(project => {
        if (!mountedRef.current) return
        const store = useKodyUnoStore.getState()
        store.checkpoint()
        store.setBoardType(project.boardType)
        store.moveBoard(project.boardOffset ?? { x: 0, y: 0 })
        store.moveBreadboard(project.breadboardOffset ?? { x: 0, y: 0 })
        useKodyUnoStore.setState({ components: project.components, wires: project.wires, sketchCode: project.sketchCode, extraFiles: project.files ?? {}, firmware: undefined, selectedComponentId: null, errorMessage: null })
        store.resetPins()
        store.resolveCircuit()
        store.appendSerial('[KodyUno] Proyek dari link dibuka. Tekan Jalankan untuk mencoba.\n')
      }).catch(error => {
        if (mountedRef.current) setErrorMessage(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        // Drop the fragment so a reload keeps the child's own edits.
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      })
    }
    return () => {
      mountedRef.current = false
      fileGeneration.current++
      stop()
      // Stop first so autosave observes running -> idle and flushes latest edits.
      disposeAutosave()
    }
  }, [setSketchCode, stop])

  useEffect(() => useKodyUnoStore.subscribe((state, previous) => {
    if (state.boardType !== previous.boardType) {
      fileGeneration.current++
      stop()
    } else if (state.runState === 'idle' && previous.runState !== 'idle' && (runRef.current || firmwareRef.current)) {
      // External reset may keep the same board, but must end its interpreter.
      stop()
    }
  }), [stop])

  const start = useCallback(() => {
    if (runRef.current || firmwareRef.current || preparing) {
      stop()
      return
    }
    // Judge the wiring against power-on pin states, not whatever the last run left.
    clearSerial()
    resetPins()
    const faults = useKodyUnoStore.getState().circuitFaults
    if (faults.length > 0) {
      const message = faults[0].message
      setErrorMessage(message)
      setRunState('error')
      appendSerial(`[Rangkaian] ${message}\n`)
      return
    }
    setErrorMessage(null)
    const generation = ++runGeneration.current
    const session = createHardwareSession(createSimulatorHardware)
    hardwareRef.current = session

    const fail = (message: string, prefix = '[Error]') => {
      session.revoke()
      if (runGeneration.current !== generation) return
      hardwareRef.current = null
      setErrorMessage(message)
      setRunState('error')
      appendSerial(`${prefix} ${message}\n`)
    }

    const runFirmware = (hex: string) => {
      firmwareRef.current = startAvrFirmware(hex, session.hardware, message => {
        if (runGeneration.current !== generation) return
        session.revoke()
        hardwareRef.current = null
        firmwareRef.current = null
        setErrorMessage(message)
        setRunState('error')
      })
      setRunState('running')
    }

    const runInterpreter = () => {
      const run = runSketch(sketchCode, {
        board,
        hardware: session.hardware,
        userLibraries,
        speed,
        onSerial: () => {
          // the hardware bridge already writes into the store's serial log
        },
        onWarning: (text) => {
          if (runGeneration.current === generation) appendSerial(`[KodyUno] ${text}\n`)
        },
        onError: (message) => {
          if (runGeneration.current !== generation) return
          setErrorMessage(message)
          setRunState('error')
          appendSerial(`\n[Error] ${message}\n`)
        },
        onFinished: () => {
          if (runGeneration.current !== generation) return
          session.revoke()
          hardwareRef.current = null
          runRef.current = null
          setRunState((useKodyUnoStore.getState().errorMessage ? 'error' : 'idle'))
        },
      })
      runRef.current = run
      setRunState('running')
    }

    try {
      if (backend === 'avr' && isAvrBoard) {
        if (boardType !== 'uno' || !firmware) throw new Error('Pilih Arduino Uno dan unggah HEX hasil kompilasi arduino:avr:uno.')
        runFirmware(firmware.hex)
        return
      }
      if (isAvrBoard && backend === 'auto') {
        // Wokwi flow: compile (cached), then run the real firmware.
        const missing = missingLibraries(extraFiles[LIBRARIES_FILE] ?? '')
        if (missing.length) {
          fail(`libraries.txt: ${missing.join(', ')} belum ada di server compile. Pilih library dari daftar yang tersedia (tombol Library).`, '[Compile]')
          return
        }
        const controller = new AbortController()
        runCompile.current?.abort()
        runCompile.current = controller
        let timedOut = false
        const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 150000)
        setPreparing(true)
        appendSerial('[KodyUno] Compile sketch…\n')
        void compileSketch(boardType === 'mega' ? 'mega' : 'uno', compileFiles(sketchCode, extraFiles), undefined, controller.signal)
          .then(artifact => {
            if (runGeneration.current !== generation || controller.signal.aborted) return
            runFirmware(new TextDecoder().decode(artifact.bytes))
            // After runFirmware: its state change must not clear the artifact.
            setCompiledArtifact(artifact)
          })
          .catch(error => {
            if (runGeneration.current !== generation) return
            if (controller.signal.aborted && !timedOut) return
            if (timedOut) error = new CompilerTimeoutError('Compile melewati batas waktu.')
            // Like Wokwi there is one engine: an unreachable compiler is an error
            // to retry, never a silent switch to the educational interpreter.
            // Standalone product: a compiler that cannot be reached falls back to
            // the in-browser interpreter so the sketch still runs offline.
            if (error instanceof CompilerUnavailableError) {
              appendSerial(`[KodyUno] ${error.message} Beralih ke interpreter C++ di browser.
`)
              runInterpreter()
              return
            }
            const message = error instanceof Error ? error.message : 'Compile gagal.'
            // A real compiler error: show gcc's diagnostics, as Wokwi does.
            setCompileLogs(message)
            fail(message.split('\n')[0], '[Compile]')
            appendSerial(`${message.split('\n').slice(1).join('\n')}\n`)
            const missing = /fatal error: ([\w./-]+\.h): No such file or directory/.exec(message)
            if (missing) appendSerial(`[KodyUno] Library ${missing[1]} belum ada di server compile. Tambahkan lewat libraries.txt atau hubungi admin.\n`)
          })
          .finally(() => {
            clearTimeout(timeout)
            if (runCompile.current === controller) runCompile.current = null
            if (runGeneration.current === generation) setPreparing(false)
          })
        return
      }
      runInterpreter()
    } catch (error) {
      fail(error instanceof CompileError ? error.message : String(error), '[Compile]')
    }
  }, [appendSerial, backend, board, boardType, firmware, isAvrBoard, clearSerial, preparing, resetPins, setErrorMessage, setRunState, sketchCode, extraFiles, speed, stop, userLibraries])

  const openFirmware = async (file?: File) => {
    if (!file) return
    const request = ++fileGeneration.current
    try {
      if (file.size > MAX_FIRMWARE_BYTES) throw new Error('HEX melebihi batas 100 KB.')
      const hex = await file.text()
      if (!mountedRef.current || fileGeneration.current !== request) return
      const payload = validateProjectFirmware({ version: 1, format: 'intel-hex', boardType: 'uno', name: file.name, hex }, useKodyUnoStore.getState().boardType)
      stop()
      setFirmware(payload)
      setErrorMessage(null)
    } catch (error) {
      if (mountedRef.current && fileGeneration.current === request) setErrorMessage(String(error))
    }
  }

  const loadExample = (example: SketchExample) => {
    setSketchCode(example.code)
    setShowExamples(false)
    stop()
    for (const type of example.parts) {
      if (components.some((item) => item.type === type)) continue
      const catalog = COMPONENT_CATALOG.find((item) => item.type === type)
      if (!catalog) continue
      addComponent({
        id: crypto.randomUUID(),
        type: catalog.type,
        label: catalog.label,
        pins: catalog.pins.map((pin) => ({ ...pin })),
      })
    }
  }

  const insertInclude = (header: string) => {
    const line = `#include <${header}>`
    if (sketchCode.includes(line)) return
    setSketchCode(`${line}\n${sketchCode}`)
    setShowLibraries(false)
  }

  const download = () => {
    const blob = new Blob([sketchCode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'kodyuno-sketch.ino'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const request = ++fileGeneration.current
    try {
      const code = await file.text()
      if (!mountedRef.current || fileGeneration.current !== request) return
      stop()
      setSketchCode(code)
      if (fileInput.current) fileInput.current.value = ''
    } catch (error) {
      if (mountedRef.current && fileGeneration.current === request) setErrorMessage(String(error))
    }
  }

  const saveProject = () => {
    const state = useKodyUnoStore.getState()
    const blob = new Blob([serializeProject({ boardType: state.boardType, boardOffset: state.boardOffset, breadboardOffset: state.breadboardOffset, sketchCode: state.sketchCode, files: state.extraFiles, components: state.components, wires: state.wires, firmware: state.firmware })], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'kodyuno-project.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openProject = async (file?: File) => {
    if (!file) return
    const request = ++fileGeneration.current
    try {
      if (file.size > 5_000_000) throw new Error('Project melebihi batas 5 MB.')
      const project = parseProject(await file.text())
      if (!mountedRef.current || fileGeneration.current !== request) return
      stop()
      const store = useKodyUnoStore.getState()
      store.setBoardType(project.boardType)
      store.moveBoard(project.boardOffset ?? { x: 0, y: 0 })
      store.moveBreadboard(project.breadboardOffset ?? { x: 0, y: 0 })
      useKodyUnoStore.setState({ components: project.components, wires: project.wires, sketchCode: project.sketchCode, extraFiles: project.files ?? {}, firmware: project.firmware, undoStack: [], redoStack: [], selectedComponentId: null, errorMessage: null })
      store.resetPins()
      store.clearSerial()
      store.resolveCircuit()
    } catch (error) {
      if (mountedRef.current && fileGeneration.current === request) setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const shareProject = async () => {
    try {
      const state = useKodyUnoStore.getState()
      const code = await encodeShare({ boardType: state.boardType, boardOffset: state.boardOffset, breadboardOffset: state.breadboardOffset,
        sketchCode: state.sketchCode, files: state.extraFiles, components: state.components, wires: state.wires })
      const url = `${window.location.origin}${window.location.pathname}#${SHARE_PARAM}=${code}`
      try {
        await navigator.clipboard.writeText(url)
        appendSerial('[KodyUno] Link proyek disalin. Tempel di chat untuk membagikan rangkaian dan kodenya.\n')
      } catch {
        window.prompt('Salin link proyek ini:', url)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const running = runState === 'running' || preparing

  const clearCanvas = () => {
    stop()
    useKodyUnoStore.getState().checkpoint()
    useKodyUnoStore.setState({ components: [], wires: [], selectedComponentId: null })
    useKodyUnoStore.getState().resolveCircuit()
  }

  return (
    <div className="flex h-full flex-col bg-slate-900">
      {/* ---------- top bar: run, board, examples; everything else in ⋯ ---------- */}
      <header className="relative z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2 sm:px-3">
        {menu && <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />}
        <a href="https://kodingyuk.id" className="flex shrink-0 items-center gap-2" title="KodingYuk">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-black text-white shadow">3D</span>
          <span className="hidden leading-tight md:block"><span className="block text-sm font-extrabold text-slate-800">KodyUno 3D</span><span className="block text-[10px] text-slate-500">Simulator Arduino</span></span>
        </a>

        <button
          onClick={start}
          disabled={!running && backend === 'avr' && (boardType !== 'uno' || !firmware)}
          className={`uno-btn ml-1 flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold text-white shadow ${running ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-600 hover:bg-emerald-700'}`}
        >
          {running ? <StopIcon size={15} /> : <PlayIcon size={15} />}
          {preparing ? 'Menyiapkan…' : running ? 'Stop' : 'Jalankan'}
        </button>
        <button onClick={() => setShowBoards(true)} className="uno-btn flex h-11 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-amber-50">
          <ChipIcon size={15} /><span className="hidden sm:inline">{board.shortName}</span>
        </button>
        <div className="relative z-40">
          <button onClick={() => setMenu(menu === 'examples' ? null : 'examples')} aria-expanded={menu === 'examples'} className="uno-btn h-11 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-amber-50">Contoh</button>
          {menu === 'examples' && (
            <div className="absolute left-0 top-full mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
              {examples.map((example) => (
                <button key={example.id} onClick={() => { loadExample(example); setMenu(null) }} className="uno-btn w-full rounded-xl px-3 py-2.5 text-left hover:bg-amber-50">
                  <p className="text-sm font-semibold text-slate-800">{example.title}</p>
                  <p className="text-[11px] leading-snug text-slate-500">{example.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button title="Undo" aria-label="Undo" disabled={!undoCount || runState === 'running'} onClick={() => useKodyUnoStore.getState().undo()} className="uno-btn grid h-11 w-11 place-items-center rounded-xl text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30">↶</button>
          <button onClick={() => setShowParts(value => !value)} aria-pressed={showParts} className={`uno-btn h-11 rounded-xl px-3 text-xs font-semibold ${showParts ? 'bg-amber-400 text-slate-900' : 'border border-slate-300 text-slate-700'}`}>Komponen</button>
          <button onClick={() => setShowCode(value => !value)} aria-pressed={showCode} className={`uno-btn h-11 rounded-xl px-3 text-xs font-semibold ${showCode ? 'bg-slate-800 text-white' : 'border border-slate-300 text-slate-700'}`}>Kode</button>
          <div className="relative z-40">
            <button onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-expanded={menu === 'more'} aria-label="Menu lainnya" className="uno-btn grid h-11 w-11 place-items-center rounded-xl border border-slate-300 text-lg text-slate-700 hover:bg-slate-50">⋯</button>
            {menu === 'more' && (
              <div className="absolute right-0 top-full mt-1 max-h-[80vh] w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 text-sm shadow-xl">
                <button onClick={() => { setMenu(null); void shareProject() }} className="w-full rounded-xl px-3 py-2.5 text-left font-semibold text-emerald-700 hover:bg-emerald-50">Bagikan link proyek</button>
                <button onClick={() => { setMenu(null); saveProject() }} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-slate-50">Simpan proyek</button>
                <label className="block w-full cursor-pointer rounded-xl px-3 py-2.5 hover:bg-slate-50">Buka proyek
                  <input type="file" accept=".json" className="hidden" onChange={e => { setMenu(null); void openProject(e.target.files?.[0]); e.target.value = '' }} />
                </label>
                <button onClick={() => { setMenu(null); download() }} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-slate-50">Unduh sketch (.ino)</button>
                <label className="block w-full cursor-pointer rounded-xl px-3 py-2.5 hover:bg-slate-50">Buka sketch (.ino)
                  <input ref={fileInput} type="file" accept=".ino,.txt,.cpp" className="hidden" onChange={(event) => { setMenu(null); void openFile(event.target.files) }} />
                </label>
                <button onClick={() => { setMenu(null); setShowLibraries(true) }} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-slate-50">Library</button>
                <button disabled={!redoCount || runState === 'running'} onClick={() => useKodyUnoStore.getState().redo()} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-40">Redo</button>
                {components.length > 0 && <button onClick={() => { setMenu(null); clearCanvas() }} className="w-full rounded-xl px-3 py-2.5 text-left text-rose-600 hover:bg-rose-50">Kosongkan meja</button>}

                <div className="my-2 h-px bg-slate-100" />
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tampilan</p>
                <div className="grid grid-cols-2 gap-1.5 px-1">
                  {(['3d', '2d'] as const).map(mode => (
                    <button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded-xl py-2 font-semibold ${view === mode ? 'bg-amber-400 text-slate-900' : 'bg-slate-100 text-slate-600'}`}>{mode.toUpperCase()}</button>
                  ))}
                  {(['hemat', 'hd'] as const).map(level => (
                    <button key={level} aria-pressed={quality === level} onClick={() => setQuality(level)} className={`rounded-xl py-2 font-semibold ${quality === level ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>{level === 'hd' ? 'Grafis HD' : 'Grafis ringan'}</button>
                  ))}
                </div>
                <button onClick={() => setMuted(value => !value)} className="mt-1.5 w-full rounded-xl px-3 py-2.5 text-left hover:bg-slate-50">Suara buzzer: {muted ? 'mati' : 'nyala'}</button>

                <div className="my-2 h-px bg-slate-100" />
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Simulasi</p>
                <div className="space-y-2 px-1">
                  <select aria-label="Mesin eksekusi" value={backend} onChange={event => { fileGeneration.current++; stop(); setBackend(event.target.value as 'auto' | 'sketch' | 'avr'); setErrorMessage(null) }} className="w-full rounded-xl border border-slate-300 px-2 py-2 text-xs">
                    <option value="auto">{isAvrBoard ? 'Firmware asli (otomatis)' : 'Otomatis'}</option>
                    <option value="sketch">Interpreter C++ (offline)</option>
                  </select>
                  <div className="flex overflow-hidden rounded-xl border border-slate-300 text-xs">
                    {SPEEDS.map((option) => (
                      <button key={option.value} onClick={() => { setSpeed(option.value); if (runRef.current) runRef.current.interpreter.speed = option.value }}
                        className={`flex-1 py-2 font-semibold ${speed === option.value ? 'bg-amber-100 text-amber-800' : 'text-slate-500'}`}>{option.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      {saveError && <div role="alert" className="bg-amber-50 px-3 py-2 text-xs text-amber-800">{saveError}</div>}
      {errorMessage && <div role="alert" className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</div>}

      <div className="relative flex min-h-0 flex-1">
        {/* ---------- workbench fills the screen ---------- */}
        <div className="relative min-h-0 min-w-0 flex-1">
          {view === '3d' ? <Scene3D quality={quality} onReady={handle => { sceneRef.current = handle }} /> : <SimulatorCanvas />}
          {view === '3d' && (
            <div aria-label="Kontrol kamera" className="absolute bottom-3 left-3 z-20 flex flex-col gap-1.5">
              <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-900/80 p-1.5 text-base font-bold text-slate-100 shadow-lg backdrop-blur">
                {([
                  ['＋', 'Perbesar', () => sceneRef.current?.zoom(0.8)],
                  ['▲', 'Geser ke depan', () => sceneRef.current?.pan(0, 1)],
                  ['－', 'Perkecil', () => sceneRef.current?.zoom(1.25)],
                  ['◀', 'Geser kiri', () => sceneRef.current?.pan(-1, 0)],
                  ['⌂', 'Kembali ke awal', () => sceneRef.current?.resetView()],
                  ['▶', 'Geser kanan', () => sceneRef.current?.pan(1, 0)],
                  ['⟲', 'Putar kiri', () => sceneRef.current?.turn(0.3)],
                  ['▼', 'Geser ke belakang', () => sceneRef.current?.pan(0, -1)],
                  ['⟳', 'Putar kanan', () => sceneRef.current?.turn(-0.3)],
                ] as const).map(([icon, label, action]) => (
                  <button key={label} title={label} aria-label={label} onClick={action} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-700 active:bg-slate-600">{icon}</button>
                ))}
              </div>
              <button onClick={() => sceneRef.current?.topView()} className="rounded-xl bg-slate-900/80 py-2 text-xs font-semibold text-slate-100 shadow-lg backdrop-blur">Lihat dari atas</button>
            </div>
          )}
          {view === '3d' && !touch && <p className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-slate-900/70 px-3 py-1 text-[10px] text-slate-300">
            Seret = geser · klik kanan seret = putar · scroll = zoom · klik pin/lubang/kaki = kabel · R putar · Delete hapus
          </p>}
          <ComponentInspector />
          {components.length === 0 && !showParts && (
            <button onClick={() => setShowParts(true)} className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg">+ Tambah komponen</button>
          )}
        </div>

        {/* ---------- parts drawer (over the workbench, left) ---------- */}
        {showParts && (
          <aside className="absolute inset-y-0 left-0 z-30 flex w-[min(320px,85vw)] flex-col border-r border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center border-b border-slate-100">
              {(['parts', 'pins'] as const).map((value) => (
                <button key={value} onClick={() => setRightTab(value)} className={`flex-1 py-3 text-xs font-semibold ${rightTab === value ? 'border-b-2 border-amber-400 text-amber-700' : 'text-slate-500'}`}>
                  {value === 'parts' ? 'Komponen' : 'Pinout'}
                </button>
              ))}
              <button aria-label="Tutup komponen" onClick={() => setShowParts(false)} className="grid h-11 w-11 place-items-center text-lg text-slate-500 hover:bg-slate-100">×</button>
            </div>
            {rightTab === 'parts' ? (
              <div className="min-h-0 flex-1 overflow-hidden" onClick={event => { if (touch && (event.target as HTMLElement).closest('button')) setShowParts(false) }}>
                <ComponentPalette />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{board.mcu}</p>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {board.pins.filter((pin) => pin.connectable).map((pin) => (
                      <tr key={String(pin.id)} className="border-b border-slate-50">
                        <td className="py-1 font-mono font-semibold text-slate-700">{pin.label}</td>
                        <td className="py-1 text-slate-400">
                          {[pin.kind === 'gnd' ? 'GND' : null, pin.kind === 'power' ? `${pin.volts ?? board.logicVolts}V` : null, pin.adc ?? null, pin.pwm ? 'PWM' : null, pin.dac ? 'DAC' : null, pin.touch ? 'Touch' : null, pin.inputOnly ? 'input-only' : null].filter(Boolean).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        )}

        {/* ---------- code drawer: docked on wide screens, over the bench on tablets ---------- */}
        {showCode && (
          <section className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-slate-700 bg-slate-950 shadow-2xl sm:w-[min(520px,70vw)] xl:static xl:z-auto xl:w-[480px] xl:shadow-none">
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-2">
              <div role="tablist" aria-label="Berkas sketch" className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {[MAIN_FILE, ...Object.keys(extraFiles)].map(name => (
                  <span key={name} className={`flex shrink-0 items-center rounded-lg text-xs font-semibold ${activeFile === name ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
                    <button role="tab" aria-selected={activeFile === name} onClick={() => setActiveFile(name)} className="px-2.5 py-1.5">{name}</button>
                    {name !== MAIN_FILE && <button aria-label={`Hapus ${name}`} onClick={() => { removeExtraFile(name); if (activeFile === name) setActiveFile(MAIN_FILE) }} className="pr-2 text-slate-400 hover:text-rose-400">×</button>}
                  </span>
                ))}
                {addingFile === null
                  ? <button aria-label="Tambah berkas" title="Tambah berkas (.h .cpp libraries.txt)" onClick={() => { setAddingFile(''); setFileNameError(null) }} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800">+</button>
                  : <input autoFocus value={addingFile} placeholder="nama.h" aria-label="Nama berkas baru" title={fileNameError ?? undefined}
                      onChange={event => { setAddingFile(event.target.value); setFileNameError(null) }}
                      onKeyDown={event => {
                        if (event.key === 'Escape') { setAddingFile(null); return }
                        if (event.key !== 'Enter') return
                        const name = addingFile.trim()
                        const check = checkFileName(name, Object.keys(extraFiles))
                        if (!check.ok) { setFileNameError(check.reason); return }
                        setExtraFile(name, name === LIBRARIES_FILE ? '# satu library per baris, mis.\n# Servo\n' : '')
                        setActiveFile(name); setAddingFile(null)
                      }}
                      onBlur={() => { if (!addingFile.trim()) setAddingFile(null) }}
                      className={`w-32 rounded border bg-slate-800 px-1.5 py-1 text-xs text-white ${fileNameError ? 'border-rose-400' : 'border-slate-600'}`} />}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button aria-expanded={showSerial} onClick={() => setShowSerial(value => !value)} className="rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Serial {showSerial ? '▾' : '▸'}</button>
                <button aria-label="Tutup kode" onClick={() => setShowCode(false)} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-slate-400 hover:bg-slate-800 xl:hidden">×</button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                path={activeFile}
                language={activeFile === LIBRARIES_FILE ? 'plaintext' : 'cpp'}
                theme="vs-dark"
                value={activeFile === MAIN_FILE ? sketchCode : extraFiles[activeFile] ?? ''}
                onChange={(value) => activeFile === MAIN_FILE ? setSketchCode(value ?? '') : setExtraFile(activeFile, value ?? '')}
                options={{ fontSize: touch ? 15 : 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, padding: { top: 10 }, automaticLayout: true, lineNumbersMinChars: 3 }}
              />
            </div>
            <div className={`${showSerial ? '' : 'hidden'} h-[38%] min-h-40 shrink-0 border-t border-slate-800`}>
              <SerialConsole />
            </div>
          </section>
        )}
      </div>


      {showBoards && <BoardPicker onClose={() => setShowBoards(false)} />}
      {showLibraries && (
        <LibraryManager
          onClose={() => setShowLibraries(false)}
          onInclude={insertInclude}
          onLibrariesChanged={setUserLibraries}
        />
      )}
    </div>
  )
}
