// ============================================================
// KodyUno — Zustand Game Store
// Single source of truth: pins, components, serial, run state, progress
// ============================================================
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeInitialPins } from '@kodyuno/lib/interpreter/pins'
import { COMPONENT_DEFS, PERSISTENT_STATE_KEYS } from '@kodyuno/lib/interpreter/components'
import { solveCircuit } from '@kodyuno/lib/circuitSolver'
import { setActiveBoard, setBoardOffset } from '@kodyuno/lib/boardGeometry'
import { setBreadboardOffset } from '@kodyuno/lib/breadboard'
import { endpointId } from '@kodyuno/lib/wireEndpoints'
import { PART_SPECS, RESISTOR_VALUES, formatOhm } from '@kodyuno/lib/partSpecs'
import { WORLDS } from '@kodyuno/data/worlds'
import { LEVELS } from '@kodyuno/data/levels'
import { validateProjectFirmware, type ProjectFirmware } from '@kodyuno/lib/projectDocument'
import { cloneGroup, type PartGroup } from '@kodyuno/lib/partGroup'
import type {
  PinState,
  BoardComponent,
  SerialLine,
  PinEvent,
  RunState,
  GamePhase,
  WorldId,
  PlayerProgress,
  BoardType,
  Wire,
  NodeRef,
  CircuitFault,
} from '@kodyuno/types'

type ActivePanel = 'mission' | 'code' | 'serial' | 'simulator' | 'none'
interface CircuitSnapshot {
  breadboardOffset: { x: number; y: number }
  boardType: BoardType
  boardOffset: { x: number; y: number }
  components: BoardComponent[]
  wires: Wire[]
}

interface KodyUnoState {
  breadboardOffset: { x: number; y: number }
  moveBreadboard: (offset: { x: number; y: number }) => void
  undoStack: CircuitSnapshot[]
  redoStack: CircuitSnapshot[]
  checkpoint: () => void
  undo: () => void
  redo: () => void
  // Board config
  boardType: BoardType
  boardOffset: { x: number; y: number }
  moveBoard: (offset: { x: number; y: number }) => void
  pins: PinState[]
  components: BoardComponent[]
  wires: Wire[]
  /** circuit solver index: node key → net root, net root → members */
  circuitIndex: { netOf: Record<string, string>; members: Record<string, string[]> }
  circuitFaults: CircuitFault[]

  // Run state
  runState: RunState
  serialLog: SerialLine[]
  /** Baud of the running sketch's Serial, null until it prints. */
  sketchBaud: number | null
  /** Text printed since the last newline — shown as the in-progress line. */
  serialPending: string
  /** Bytes typed into the serial monitor, waiting for Serial.read(). */
  serialInput: number[]
  pinEvents: PinEvent[]
  errorMessage: string | null
  runSpeed: number

  // Game progress
  phase: GamePhase
  activeWorld: WorldId | null
  activeLevel: number | null
  playerProgress: PlayerProgress
  playerName: string

  // UI
  activePanel: ActivePanel
  notification: string | null
  notificationType: 'success' | 'error' | 'info' | null
  selectedComponentId: string | null

  // Generated code cache
  generatedCode: string

  // Actions — board
  updatePin: (pin: number | string, value: number, pwm?: number) => void
  setPinMode: (pin: number | string, mode: PinState['mode']) => void
  resetPins: () => void
  /** Swap the board on the canvas — clears wiring, keeps the parts bin. */
  setBoardType: (board: BoardType) => void
  addComponent: (c: Omit<BoardComponent, 'state'>) => void
  removeComponent: (id: string) => void
  /** Place a copy of `source` (state and rotation, not wires) at `pos`; returns the new id. */
  pasteComponent: (source: BoardComponent, pos: { x: number; y: number }) => string
  /** Multi-selection edits, each one undo step. */
  removeComponents: (ids: string[]) => void
  rotateComponents: (ids: string[]) => void
  /** Paste copies of a group (parts + the wires between them); returns the new part ids. */
  pasteGroup: (group: PartGroup, offset: { x: number; y: number }) => string[]
  /** Set several part positions and wire bends at once (group drag; no solve). */
  placeParts: (positions: Record<string, { x: number; y: number }>, bends?: Record<string, { x: number; y: number }[]>) => void
  updateComponentPin: (id: string, role: string, pin: number | string) => void
  updateComponentState: (id: string, patch: Record<string, unknown>) => void
  selectComponent: (id: string | null) => void
  moveComponent: (id: string, pos: { x: number; y: number }) => void
  /** rotate a component 90° clockwise around its center */
  rotateComponent: (id: string) => void
  addWire: (a: NodeRef, b: NodeRef, color: string, points?: Wire['points']) => void
  removeWire: (id: string) => void
  reconnectWire: (id: string, end: 'a' | 'b', target: NodeRef) => void
  updateWire: (id: string, patch: Pick<Partial<Wire>, 'color' | 'points' | 'style'>) => void
  cycleResistor: (id: string) => void
  /** re-run the net solver (call after any topology edit) */
  resolveCircuit: () => void

  // Actions — run
  setRunState: (s: RunState) => void
  setErrorMessage: (msg: string | null) => void
  setRunSpeed: (speed: number) => void
  appendSerial: (text: string) => void
  clearSerial: () => void
  /** Queue text from the monitor input box for the sketch to read. */
  sendSerialInput: (text: string) => void
  /** Sketch source for the KodyUno IDE. */
  sketchCode: string
  /** Extra sketch files (headers/sources) and libraries.txt, by name. */
  extraFiles: Record<string, string>
  setExtraFile: (name: string, content: string) => void
  removeExtraFile: (name: string) => void
  firmware: ProjectFirmware | undefined
  setFirmware: (firmware: ProjectFirmware | undefined) => void
  setSketchCode: (code: string) => void
  appendPinEvent: (evt: PinEvent) => void
  clearPinEvents: () => void

  // Actions — progress
  startLevel: (levelId: number) => void
  completeLevel: () => void
  setPhase: (phase: GamePhase) => void
  setPlayerName: (name: string) => void
  isWorldUnlocked: (worldId: WorldId) => boolean
  isLevelUnlocked: (levelId: number) => boolean

  // Actions — UI
  setPanel: (panel: ActivePanel) => void
  setNotification: (msg: string | null, type?: 'success' | 'error' | 'info') => void
  setGeneratedCode: (code: string) => void
  resetGame: () => void
}

const DEFAULT_BOARD: BoardType = 'uno'

// The circuit solver and canvas snapping read the board through module state
// in boardGeometry, so it has to move in lockstep with the store.
setActiveBoard(DEFAULT_BOARD)

// Size-aware packing below the breadboard. Real-size parts vary from a small
// LED to a keypad nearly as wide as the complete breadboard.
function slotPos(items: Pick<BoardComponent, 'type'>[], nextType: BoardComponent['type']): { x: number; y: number } {
  const left = 24
  const right = 536
  const gapX = 28
  const gapY = 46
  let x = left
  let y = 745
  let rowH = 0
  let nextPos = { x, y }

  for (const type of [...items.map((item) => item.type), nextType]) {
    const spec = PART_SPECS[type]
    if (x > left && x + spec.w > right) {
      x = left
      y += rowH + gapY
      rowH = 0
    }
    nextPos = { x, y }
    x += spec.w + gapX
    rowH = Math.max(rowH, spec.h)
  }
  return nextPos
}

function withPositions<T extends Pick<BoardComponent, 'type'> & { pos?: { x: number; y: number } }>(items: T[]): T[] {
  const placed: T[] = []
  for (const item of items) {
    placed.push(item.pos ? item : { ...item, pos: slotPos(placed, item.type) })
  }
  return placed
}

const term = (comp: string, role: string): NodeRef => ({ type: 'term', comp, role })
const pinRef = (pin: number | string): NodeRef => ({ type: 'pin', pin })
const mkWire = (a: NodeRef, b: NodeRef, color: string): Wire => ({ id: crypto.randomUUID(), a, b, color })

const SIGNAL_COLORS = ['#16a34a', '#2563eb', '#f97316', '#9333ea', '#eab308']

// Turn a level's legacy pin assignments into real wires so old content keeps
// working on the circuit-net simulator. LEDs get a proper series resistor so
// kids always see a correct example circuit.
function autoWireLevel(components: BoardComponent[]): { components: BoardComponent[]; wires: Wire[] } {
  const wires: Wire[] = []
  const extra: BoardComponent[] = []
  let colorIdx = 0
  const nextColor = () => SIGNAL_COLORS[colorIdx++ % SIGNAL_COLORS.length]

  for (const comp of components) {
    const spec = PART_SPECS[comp.type]
    if (!spec) continue

    if (comp.type === 'led') {
      const anodePin = comp.pins.find((p) => p.role === 'anode')?.pin
      if (anodePin !== undefined && anodePin !== '') {
        const res: BoardComponent = {
          id: `${comp.id}-r`,
          type: 'resistor',
          label: 'Resistor 220Ω',
          pins: [],
          state: { value: 220 },
          pos: { x: (comp.pos?.x ?? 70) + 8, y: (comp.pos?.y ?? 745) - 42 },
        }
        extra.push(res)
        wires.push(mkWire(pinRef(anodePin), term(res.id, 't1'), nextColor()))
        wires.push(mkWire(term(res.id, 't2'), term(comp.id, 'anode'), '#dc2626'))
      }
      wires.push(mkWire(term(comp.id, 'cathode'), pinRef('GND'), '#1e293b'))
      continue
    }

    // signal wires from the legacy pin mapping
    for (const p of comp.pins) {
      if (p.pin === '' || p.pin === undefined) continue
      if (!spec.terminals.some((t) => t.role === p.role)) continue
      wires.push(mkWire(term(comp.id, p.role), pinRef(p.pin), nextColor()))
    }
    // power for modules / ground for buzzer
    if (spec.terminals.some((t) => t.role === 'vcc')) {
      wires.push(mkWire(term(comp.id, 'vcc'), pinRef('5V'), '#dc2626'))
    }
    if (spec.terminals.some((t) => t.role === 'gnd')) {
      wires.push(mkWire(term(comp.id, 'gnd'), pinRef('GND'), '#1e293b'))
    }
  }

  return { components: [...components, ...extra], wires }
}

export const useKodyUnoStore = create<KodyUnoState>()(
  persist(
    (set, get) => ({
      boardType: DEFAULT_BOARD,
      breadboardOffset: { x: 0, y: 0 },
      moveBreadboard: (breadboardOffset) => {
        if (!Number.isFinite(breadboardOffset.x) || !Number.isFinite(breadboardOffset.y)) return
        setBreadboardOffset(breadboardOffset)
        set({ breadboardOffset })
      },
      undoStack: [],
      redoStack: [],
      checkpoint: () => {
        const state = get()
        if (state.runState === 'running') return
        const snapshot = structuredClone({ boardType: state.boardType, boardOffset: state.boardOffset, breadboardOffset: state.breadboardOffset, components: state.components, wires: state.wires })
        set({ undoStack: [...state.undoStack.slice(-49), snapshot], redoStack: [] })
      },
      undo: () => {
        const state = get(), previous = state.undoStack.at(-1)
        if (!previous || state.runState === 'running') return
        const current = structuredClone({ boardType: state.boardType, boardOffset: state.boardOffset, breadboardOffset: state.breadboardOffset, components: state.components, wires: state.wires })
        setActiveBoard(previous.boardType)
        setBoardOffset(previous.boardOffset)
        setBreadboardOffset(previous.breadboardOffset)
        set({ ...structuredClone(previous), firmware: previous.boardType === state.boardType ? state.firmware : undefined, pins: makeInitialPins(previous.boardType), undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, current], selectedComponentId: null })
        get().resolveCircuit()
      },
      redo: () => {
        const state = get(), next = state.redoStack.at(-1)
        if (!next || state.runState === 'running') return
        const current = structuredClone({ boardType: state.boardType, boardOffset: state.boardOffset, breadboardOffset: state.breadboardOffset, components: state.components, wires: state.wires })
        setActiveBoard(next.boardType)
        setBoardOffset(next.boardOffset)
        setBreadboardOffset(next.breadboardOffset)
        set({ ...structuredClone(next), firmware: next.boardType === state.boardType ? state.firmware : undefined, pins: makeInitialPins(next.boardType), redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, current], selectedComponentId: null })
        get().resolveCircuit()
      },
      boardOffset: { x: 0, y: 0 },
      moveBoard: (boardOffset) => {
        if (!Number.isFinite(boardOffset.x) || !Number.isFinite(boardOffset.y)) return
        setBoardOffset(boardOffset)
        set({ boardOffset })
      },
      pins: makeInitialPins(DEFAULT_BOARD),
      components: [],
      wires: [],
      circuitIndex: { netOf: {}, members: {} },
      circuitFaults: [],

      runState: 'idle',
      serialLog: [],
      sketchBaud: null,
      serialPending: '',
      serialInput: [],
      pinEvents: [],
      errorMessage: null,
      runSpeed: 10,
      sketchCode: '',
      extraFiles: {},
      firmware: undefined,
      setFirmware: (firmware) => set({ firmware: firmware === undefined ? undefined : validateProjectFirmware(firmware, get().boardType) }),

      phase: 'title',
      activeWorld: null,
      activeLevel: null,
      playerProgress: { completedLevels: [], completedWorlds: [] },
      playerName: '',

      activePanel: 'none',
      notification: null,
      notificationType: null,
      selectedComponentId: null,
      generatedCode: '',

      // --- Board actions ---

      updatePin: (pin, value, pwm = 0) => {
        // A sketch can hammer the same pin thousands of times a second.
        // Re-rendering the canvas for a write that changes nothing is pure
        // waste, so identical writes stop here.
        const before = get().pins.find((p) => p.pin === pin)
        if (before && before.value === value && before.pwm === pwm) return

        set((state) => {
          const updatedPins = state.pins.map((p) =>
            p.pin === pin ? { ...p, value, pwm } : p
          )
          // Update component states based on new pin value
          const updatedComponents = state.components.map((comp) => {
            const def = COMPONENT_DEFS[comp.type]
            if (!def) return comp
            const patch = def.onPinChange(comp, pin, value, pwm)
            return { ...comp, state: { ...comp.state, ...patch } }
          })
          return { pins: updatedPins, components: updatedComponents }
        })
        // Pin events only exist so a level can check its objectives; the
        // free-form IDE has no objectives and does not need the history.
        if (get().activeLevel !== null) get().appendPinEvent({ pin, value, ts: Date.now() })
      },

      setPinMode: (pin, mode) => {
        set((state) => ({
          pins: state.pins.map((p) => (p.pin === pin ? { ...p, mode } : p)),
        }))
      },

      setBoardType: (boardType) => {
        get().checkpoint()
        setActiveBoard(boardType)
        set({
          boardType,
          firmware: undefined,
          pins: makeInitialPins(boardType),
          // header ids differ per board, so old wires would point at nothing
          wires: [],
          runState: 'idle',
          errorMessage: null,
          serialLog: [],
          sketchBaud: null,
          serialPending: '',
          serialInput: [],
          pinEvents: [],
        })
        get().resolveCircuit()
      },

      resetPins: () => {
        const { boardType, components, resolveCircuit } = get()
        setActiveBoard(boardType)
        const freshPins = makeInitialPins(boardType)
        const resetComponents = components.map((comp) => {
          const def = COMPONENT_DEFS[comp.type]
          const fresh = def ? def.makeState() : {}
          // keep user configuration (resistor value, LED color) across resets
          for (const key of PERSISTENT_STATE_KEYS) {
            if (key in comp.state) fresh[key] = comp.state[key]
          }
          return { ...comp, state: fresh }
        })
        set({ pins: freshPins, components: resetComponents })
        resolveCircuit()
      },

      addComponent: (c) => {
        get().checkpoint()
        const def = COMPONENT_DEFS[c.type]
        set((state) => {
          const pos = c.pos ?? slotPos(state.components, c.type)
          const newComp: BoardComponent = { ...c, pos, state: def ? def.makeState() : {} }
          return { components: [...state.components, newComp] }
        })
        get().resolveCircuit()
      },

      pasteComponent: (source, pos) => {
        get().checkpoint()
        const id = `${source.type}-${crypto.randomUUID().slice(0, 8)}`
        const copy: BoardComponent = {
          id, type: source.type, label: source.label, pins: [], pos, ...(source.rot ? { rot: source.rot } : {}),
          state: structuredClone(source.state),
        }
        set((state) => ({ components: [...state.components, copy], selectedComponentId: id }))
        get().resolveCircuit()
        return id
      },

      removeComponents: (ids) => {
        if (!ids.length) return
        get().checkpoint()
        const gone = new Set(ids)
        const attached = (ref: NodeRef) => ref.type === 'term' && gone.has(ref.comp)
        set((state) => ({
          components: state.components.filter((c) => !gone.has(c.id)),
          wires: state.wires.filter((w) => !attached(w.a) && !attached(w.b)),
          selectedComponentId: state.selectedComponentId && gone.has(state.selectedComponentId) ? null : state.selectedComponentId,
        }))
        get().resolveCircuit()
      },

      rotateComponents: (ids) => {
        if (!ids.length) return
        get().checkpoint()
        const turn = new Set(ids)
        set((state) => ({ components: state.components.map((c) => turn.has(c.id) ? { ...c, rot: ((c.rot ?? 0) + 90) % 360 } : c) }))
        get().resolveCircuit()
      },

      pasteGroup: (group, offset) => {
        if (!group.parts.length) return []
        get().checkpoint()
        const copy = cloneGroup(group, offset, (part) => `${part.type}-${crypto.randomUUID().slice(0, 8)}`)
        set((state) => ({
          components: [...state.components, ...copy.parts],
          wires: [...state.wires, ...copy.wires],
          selectedComponentId: copy.parts.length === 1 ? copy.parts[0].id : null,
        }))
        get().resolveCircuit()
        return copy.parts.map((part) => part.id)
      },

      placeParts: (positions, bends) => {
        set((state) => ({
          components: state.components.map((c) => positions[c.id] ? { ...c, pos: positions[c.id] } : c),
          ...(bends && Object.keys(bends).length ? { wires: state.wires.map((w) => bends[w.id] ? { ...w, points: bends[w.id] } : w) } : {}),
        }))
      },

      removeComponent: (id) => {
        get().checkpoint()
        set((state) => ({
          components: state.components.filter((c) => c.id !== id),
          // drop wires attached to the removed component's terminals
          wires: state.wires.filter(
            (w) => !(w.a.type === 'term' && w.a.comp === id) && !(w.b.type === 'term' && w.b.comp === id)
          ),
          selectedComponentId: state.selectedComponentId === id ? null : state.selectedComponentId,
        }))
        get().resolveCircuit()
      },

      updateComponentPin: (id, role, pin) => {
        set((state) => ({
          components: state.components.map((c) =>
            c.id === id
              ? { ...c, pins: c.pins.map((p) => (p.role === role ? { ...p, pin } : p)) }
              : c
          ),
        }))
      },

      updateComponentState: (id, patch) => {
        set((state) => {
          const components = state.components.map((component) =>
            component.id === id ? { ...component, state: { ...component.state, ...patch } } : component,
          )
          const target = components.find((component) => component.id === id)
          if (!target) return { components }
          const rolePin = (role: string) => target.circuit?.rolePins[role]
            || target.pins.find((entry) => entry.role === role)?.pin
          const digital: { role: string; value: number }[] = []
          if (target.type === 'pushbutton') {
            const signalPin = rolePin('signal')
            const pinState = state.pins.find((entry) => entry.pin === signalPin)
            // A button wired to GND pulls LOW; when released INPUT_PULLUP
            // returns HIGH, matching the standard Arduino/Wokwi circuit.
            digital.push({ role: 'signal', value: target.state.pressed ? 0 : pinState?.mode === 'INPUT_PULLUP' ? 1 : 0 })
          }
          if (target.type === 'pir') digital.push({ role: 'out', value: target.state.detected ? 1 : 0 })
          if (target.type === 'ldr' || target.type === 'sound_sensor' || target.type === 'gas_sensor' || target.type === 'flame_sensor') {
            digital.push({ role: 'do', value: Number(target.state.level ?? 0) >= Number(target.state.threshold ?? 600) ? 1 : 0 })
          }
          if (target.type === 'joystick' || target.type === 'rotary_encoder') digital.push({ role: 'sw', value: target.state.pressed ? 0 : 1 })
          if (target.type === 'ir_receiver') digital.push({ role: 'out', value: target.state.active ? 0 : 1 })
          const pins = state.pins.map((pinState) => {
            const update = digital.find((entry) => rolePin(entry.role) === pinState.pin)
            return update && (target.circuit?.powered ?? true) ? { ...pinState, value: update.value, pwm: 0 } : pinState
          })
          return { components, pins }
        })
        const type = get().components.find((component) => component.id === id)?.type
        if (type === 'pushbutton' || type === 'slide_switch' || type === 'dip_switch' || type === 'relay') {
          get().resolveCircuit()
        }
      },

      selectComponent: (selectedComponentId) => set({ selectedComponentId }),

      moveComponent: (id, pos) => {
        // solver NOT re-run here (fires every pointermove) — canvas calls
        // resolveCircuit() on drag end.
        set((state) => ({
          components: state.components.map((c) => (c.id === id ? { ...c, pos } : c)),
        }))
      },

      rotateComponent: (id) => {
        get().checkpoint()
        set((state) => ({
          components: state.components.map((c) =>
            c.id === id ? { ...c, rot: (((c.rot ?? 0) + 90) % 360) } : c
          ),
        }))
        get().resolveCircuit()
      },

      addWire: (a, b, color, points) => {
        if (endpointId(a) === endpointId(b)) return
        get().checkpoint()
        set((state) => ({ wires: [...state.wires, { ...mkWire(a, b, color), ...(points ? { points } : {}) }] }))
        get().resolveCircuit()
      },

      removeWire: (id) => {
        get().checkpoint()
        set((state) => ({ wires: state.wires.filter((w) => w.id !== id) }))
        get().resolveCircuit()
      },

      reconnectWire: (id, end, target) => {
        const wire = get().wires.find(entry => entry.id === id)
        if (!wire || endpointId(wire[end]) === endpointId(target) || endpointId(wire[end === 'a' ? 'b' : 'a']) === endpointId(target)) return
        get().checkpoint()
        set(state => ({ wires: state.wires.map(entry => entry.id === id ? { ...entry, [end]: target } : entry) }))
        get().resolveCircuit()
      },

      updateWire: (id, patch) => {
        const points = patch.points?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        set((state) => ({ wires: state.wires.map((wire) => wire.id === id
          ? { ...wire, ...patch, ...(points ? { points } : {}) } : wire) }))
      },

      cycleResistor: (id) => {
        set((state) => ({
          components: state.components.map((c) => {
            if (c.id !== id || c.type !== 'resistor') return c
            const cur = typeof c.state.value === 'number' ? c.state.value : 220
            const idx = RESISTOR_VALUES.indexOf(cur as (typeof RESISTOR_VALUES)[number])
            const next = RESISTOR_VALUES[(idx + 1) % RESISTOR_VALUES.length]
            return { ...c, label: `Resistor ${formatOhm(next)}`, state: { ...c.state, value: next } }
          }),
        }))
        get().resolveCircuit()
      },

      resolveCircuit: () => {
        const { components, wires, pins } = get()
        const res = solveCircuit(components, wires, pins)
        set({
          components: res.components,
          circuitIndex: { netOf: res.netOf, members: res.members },
          circuitFaults: res.faults,
        })
      },

      // --- Run actions ---

      setRunState: (runState) => set({ runState }),
      setErrorMessage: (errorMessage) => set({ errorMessage }),
      setRunSpeed: (runSpeed) => set({ runSpeed }),

      appendSerial: (text) => {
        // Serial is a byte stream: only a newline ends a line, so
        // `print("T="); println(t);` shows up as one line, like on a real board.
        set((state) => {
          const combined = state.serialPending + text
          const parts = combined.split('\n')
          const pending = parts.pop() ?? ''
          if (parts.length === 0) return { serialPending: pending }
          const ts = Date.now()
          const lines: SerialLine[] = parts.map((entry) => ({ id: crypto.randomUUID(), text: entry, ts }))
          return {
            serialLog: [...state.serialLog, ...lines].slice(-800),
            serialPending: pending,
          }
        })
      },

      // A new run must not inherit the last run's unread input or its baud.
      clearSerial: () => set({ serialLog: [], serialPending: '', serialInput: [], sketchBaud: null }),

      sendSerialInput: (text) => {
        const bytes = Array.from(new TextEncoder().encode(text))
        set((state) => ({ serialInput: [...state.serialInput, ...bytes] }))
      },

      setSketchCode: (sketchCode) => set({ sketchCode }),
      setExtraFile: (name, content) => set((state) => ({ extraFiles: { ...state.extraFiles, [name]: content } })),
      removeExtraFile: (name) => set((state) => {
        const { [name]: _removed, ...rest } = state.extraFiles
        return { extraFiles: rest }
      }),

      appendPinEvent: (evt) => {
        set((state) => ({
          pinEvents: [...state.pinEvents.slice(-999), evt],
        }))
      },

      clearPinEvents: () => set({ pinEvents: [] }),

      // --- Progress actions ---

      startLevel: (levelId) => {
        const level = LEVELS.find((l) => l.id === levelId)
        if (!level) return
        setActiveBoard(level.boardType)
        const freshPins = makeInitialPins(level.boardType)
        const placed = withPositions(
          level.initialComponents.map((c) => {
            const def = COMPONENT_DEFS[c.type]
            return { ...c, state: def ? def.makeState() : {} }
          })
        )
        // convert the level's legacy pin assignments into real wires
        const { components: initialComponents, wires } = autoWireLevel(placed)
        set({
          activeLevel: levelId,
          activeWorld: level.worldId,
          boardType: level.boardType,
          firmware: undefined,
          pins: freshPins,
          components: initialComponents,
          wires,
          phase: 'playing',
          runState: 'idle',
          serialLog: [],
          sketchBaud: null,
          serialPending: '',
          serialInput: [],
          pinEvents: [],
          errorMessage: null,
          generatedCode: '',
          activePanel: 'mission',
          selectedComponentId: null,
        })
        get().resolveCircuit()
      },

      completeLevel: () => {
        const { activeLevel, activeWorld, playerProgress } = get()
        if (!activeLevel) return
        const completedLevels = playerProgress.completedLevels.includes(activeLevel)
          ? playerProgress.completedLevels
          : [...playerProgress.completedLevels, activeLevel]

        // Check if world is complete
        const world = WORLDS.find((w) => w.id === activeWorld)
        const worldComplete =
          world && world.levelIds.every((id) => completedLevels.includes(id))
        const completedWorlds =
          worldComplete && !playerProgress.completedWorlds.includes(activeWorld!)
            ? [...playerProgress.completedWorlds, activeWorld!]
            : playerProgress.completedWorlds

        set({ phase: 'complete', playerProgress: { completedLevels, completedWorlds } })
      },

      setPhase: (phase) => set({ phase }),
      setPlayerName: (playerName) => set({ playerName }),

      isWorldUnlocked: (worldId) => {
        const { playerProgress } = get()
        if (worldId === 1) return true
        const world = WORLDS.find((w) => w.id === worldId - 1)
        if (!world) return false
        return world.levelIds.every((id) => playerProgress.completedLevels.includes(id))
      },

      isLevelUnlocked: (levelId) => {
        const { playerProgress, isWorldUnlocked } = get()
        const level = LEVELS.find((l) => l.id === levelId)
        if (!level) return false
        if (!isWorldUnlocked(level.worldId)) return false
        const worldLevels = LEVELS.filter((l) => l.worldId === level.worldId).sort(
          (a, b) => a.id - b.id
        )
        const idx = worldLevels.findIndex((l) => l.id === levelId)
        if (idx === 0) return true
        return playerProgress.completedLevels.includes(worldLevels[idx - 1].id)
      },

      // --- UI actions ---

      setPanel: (activePanel) => set({ activePanel }),

      setNotification: (notification, notificationType = 'info') =>
        set({ notification, notificationType }),

      setGeneratedCode: (generatedCode) => set({ generatedCode }),

      resetGame: () => {
        setActiveBoard(DEFAULT_BOARD)
        setBoardOffset({ x: 0, y: 0 })
        setBreadboardOffset({ x: 0, y: 0 })
        set({
          boardType: DEFAULT_BOARD,
          firmware: undefined,
          breadboardOffset: { x: 0, y: 0 },
          undoStack: [],
          redoStack: [],
          boardOffset: { x: 0, y: 0 },
          playerProgress: { completedLevels: [], completedWorlds: [] },
          activeLevel: null,
          activeWorld: null,
          phase: 'title',
          runState: 'idle',
          serialLog: [],
          sketchBaud: null,
          serialPending: '',
          serialInput: [],
          pinEvents: [],
          generatedCode: '',
          pins: makeInitialPins(DEFAULT_BOARD),
          components: [],
          wires: [],
          circuitIndex: { netOf: {}, members: {} },
          circuitFaults: [],
          selectedComponentId: null,
        })
      },
    }),
    {
      name: 'kodyuno-game-state',
      partialize: (s) => ({
        playerProgress: s.playerProgress,
        playerName: s.playerName,
        runSpeed: s.runSpeed,
        boardType: s.boardType,
        sketchCode: s.sketchCode,
      }),
      // The persisted board has to reach boardGeometry before anything reads
      // a pin table, otherwise a reload draws an ESP32 with Uno holes.
      onRehydrateStorage: () => (state) => {
        if (state) {
          setActiveBoard(state.boardType)
          state.pins = makeInitialPins(state.boardType)
        }
      },
    }
  )
)
