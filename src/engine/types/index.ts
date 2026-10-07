// ============================================================
// KodyUno — Global Types
// ============================================================

/**
 * Every board KodyUno can simulate. The full definition (pinout, MCU
 * traits, artwork) lives in lib/boards; this union is the id used across
 * the store, levels, and persisted sketches.
 */
export type BoardType =
  | 'uno'
  | 'nano'
  | 'mega'
  | 'esp32'
  | 'esp32-s3'
  | 'esp32-s2'
  | 'esp32-c3'
  | 'esp32-c6'
  | 'esp8266'
export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP'
export type ComponentType =
  | 'led' | 'rgb_led' | 'resistor' | 'buzzer' | 'servo' | 'lcd'
  | 'dht11' | 'ultrasonic' | 'pir' | 'sound_sensor' | 'ldr'
  | 'potentiometer' | 'lm35' | 'water_sensor' | 'gas_sensor' | 'flame_sensor'
  | 'pushbutton' | 'joystick' | 'relay' | 'ir_receiver' | 'rfid'
  | 'keypad' | 'seven_segment' | 'led_matrix' | 'stepper' | 'rotary_encoder'
  // element-backed parts added with the ESP32 line-up
  | 'ssd1306' | 'lcd2004' | 'tft_ili9341'
  | 'neopixel' | 'neopixel_matrix' | 'led_bar'
  | 'dht22' | 'mpu6050' | 'ds1307' | 'hx711'
  | 'ntc_temp' | 'heart_sensor' | 'tilt_switch'
  | 'slide_switch' | 'dip_switch' | 'microsd'
  | 'ds18b20' | 'led_matrix4'
  // measurement tools
  | 'multimeter' | 'logic_analyzer'
export type RunState = 'idle' | 'running' | 'paused' | 'error'
export type GamePhase = 'title' | 'playing' | 'quiz' | 'complete'
export type WorldId = number

export interface PinState {
  pin: number | string
  mode: PinMode
  value: number
  pwm: number
}

export interface BoardComponent {
  id: string
  type: ComponentType
  label: string
  /**
   * Legacy signal-pin mapping (role → Arduino pin). Since the circuit-net
   * simulator this is DERIVED by the solver from the physical wiring —
   * levels still author it as the desired connection, and autoWire turns
   * it into real wires at level start.
   */
  pins: { role: string; pin: number | string }[]
  state: Record<string, unknown>
  /** Solver output: electrical situation of this component. */
  circuit?: ComponentCircuit
  /** Position on the simulator canvas (board-native coordinate space). */
  pos?: { x: number; y: number }
  /** Rotation in degrees (0 / 90 / 180 / 270), around the part's center. */
  rot?: number
}

/** Where a wire endpoint attaches. */
export type NodeRef =
  | { type: 'pin'; pin: number | string }        // Arduino header hole (id)
  | { type: 'hole'; hole: string }               // breadboard hole id "row:col"
  | { type: 'term'; comp: string; role: string } // component terminal

export interface Wire {
  id: string
  a: NodeRef
  b: NodeRef
  color: string
  /** Optional world-space bends; absent in legacy projects. */
  points?: { x: number; y: number }[]
  /** Drawing style; absent means 'orthogonal' (legacy projects). */
  style?: 'orthogonal' | 'straight' | 'curved'
}

export interface CircuitFault {
  type: 'short-circuit' | 'voltage-conflict' | 'gpio-contention'
  net: string
  message: string
  nodes: string[]
}

/** Electrical evaluation of one component (computed by the circuit solver). */
export interface ComponentCircuit {
  /** Arduino pin (or '5V'/'3V3') that drives the signal terminal, null = unconnected */
  srcPin: number | string | null
  /** total series resistance on the source+ground path (Ω) */
  seriesR: number
  /** true when the ground side reaches GND */
  gndOk: boolean
  /** current would exceed safe limits (e.g. LED without resistor) */
  overcurrent: boolean
  /** 0..1 brightness multiplier from series resistance */
  brightScale: number
  /** modules: VCC reaches 5V/3V3 and GND reaches ground */
  powered: boolean
  /** per-role resolved arduino pin for multi-signal parts (trig/echo, rs/en) */
  rolePins: Record<string, number | string | ''>
  /** kid-friendly problem description, null when circuit is fine */
  warning: string | null
}

export interface SerialLine {
  id: string
  text: string
  ts: number
}

export interface PinEvent {
  pin: number | string
  value: number
  ts: number
}

export interface LevelObjective {
  id: string
  description: string
  check: (pinEvents: PinEvent[], serial: SerialLine[]) => boolean
}

export interface QuizQuestion {
  id: string
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface LevelDefinition {
  id: number
  worldId: WorldId
  name: string
  description: string
  boardType: BoardType
  allowedBlocks: string[]
  initialComponents: Omit<BoardComponent, 'state'>[]
  objectives: LevelObjective[]
  hints: string[]
  quiz: QuizQuestion[]
}

export interface WorldDefinition {
  id: WorldId
  name: string
  emoji: string
  description: string
  levelIds: number[]
  bgColor: string
}

export interface PlayerProgress {
  completedLevels: number[]
  completedWorlds: WorldId[]
}
