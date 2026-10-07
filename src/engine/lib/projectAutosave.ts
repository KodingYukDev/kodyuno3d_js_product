import { useKodyUnoStore } from '../store/useKodyUnoStore'
import { parseProject, serializeProject } from './projectDocument'

const KEY = 'kodyuno3d-project-autosave-v1'

/** Restore atomically after validation, then debounce document writes. */
export function startProjectAutosave(onError: (message: string) => void): () => void {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) {
      const project = parseProject(saved)
      const store = useKodyUnoStore.getState()
      store.setBoardType(project.boardType)
      store.moveBoard(project.boardOffset ?? { x: 0, y: 0 })
      store.moveBreadboard(project.breadboardOffset ?? { x: 0, y: 0 })
      useKodyUnoStore.setState({ components: project.components, wires: project.wires, sketchCode: project.sketchCode, extraFiles: project.files ?? {}, firmware: project.firmware, undoStack: [], redoStack: [] })
      store.resetPins()
      store.resolveCircuit()
    }
  } catch {
    onError('Autosave sebelumnya tidak dapat dibuka. Gunakan Buka project untuk memulihkan berkas cadangan.')
    return () => {}
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  const flush = () => {
    if (!pending) return
    clearTimeout(timer)
    try {
      const state = useKodyUnoStore.getState()
      localStorage.setItem(KEY, serializeProject({ boardType: state.boardType, boardOffset: state.boardOffset,
        breadboardOffset: state.breadboardOffset, sketchCode: state.sketchCode, files: state.extraFiles, components: state.components, wires: state.wires, firmware: state.firmware }))
      pending = false
    } catch { onError('Autosave gagal: penyimpanan browser penuh atau tidak tersedia. Simpan project ke berkas.') }
  }
  const unsubscribe = useKodyUnoStore.subscribe((state, previous) => {
    const stopped = previous.runState === 'running' && state.runState !== 'running'
    if (state.runState === 'running' || (!stopped && state.components === previous.components && state.wires === previous.wires
      && state.boardOffset === previous.boardOffset && state.breadboardOffset === previous.breadboardOffset
      && state.boardType === previous.boardType && state.sketchCode === previous.sketchCode && state.extraFiles === previous.extraFiles && state.firmware === previous.firmware)) return
    pending = true
    clearTimeout(timer)
    timer = setTimeout(flush, 500)
  })
  window.addEventListener('pagehide', flush)
  return () => { unsubscribe(); flush(); clearTimeout(timer); window.removeEventListener('pagehide', flush) }
}
