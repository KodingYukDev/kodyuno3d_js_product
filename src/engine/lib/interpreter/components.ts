import type { BoardComponent, ComponentType } from '@kodyuno/types'

interface ComponentDef {
  label: string
  emoji: string
  defaultPins: { role: string; pin: number | string }[]
  makeState: () => Record<string, unknown>
  onPinChange: (
    comp: BoardComponent,
    pin: number | string,
    value: number,
    pwm: number
  ) => Partial<Record<string, unknown>>
}

/** state keys preserved across resets (user configuration, not runtime state) */
export const PERSISTENT_STATE_KEYS = [
  'value', 'color', 'level', 'temperature', 'humidity', 'distanceCm', 'detected',
  'x', 'y', 'pressed', 'key', 'cardPresent', 'code', 'angle', 'noBounce', 'bpm', 'clockHalted',
  'address', 'epoch', 'epochSetAt', 'weightGram', 'uid', 'threshold',
  'ax', 'ay', 'az', 'gx', 'gy', 'gz',
  'files', 'mounted', 'mode',
] as const

const SEVEN_SEGMENT_ROLES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']
/** IN1–IN4 coil patterns in half-step order (a full step skips one). */
const STEPPER_HALF_STEPS = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001']

export const COMPONENT_DEFS: Partial<Record<ComponentType, ComponentDef>> = {
  led: {
    label: 'LED',
    emoji: '💡',
    defaultPins: [{ role: 'anode', pin: 13 }],
    makeState: () => ({ on: false, brightness: 0, color: '#f59e0b', burned: false }),
    onPinChange(comp, pin, value, pwm) {
      const c = comp.circuit
      // circuit solver decides which pin actually drives this LED
      if (!c || c.srcPin !== pin) return {}
      if (comp.state.burned) return { on: false }
      if (!c.gndOk) return { on: false }
      const driven = value === 1 || pwm > 0
      // overcurrent + driven → the LED burns out
      if (driven && c.overcurrent) {
        return { on: false, burned: true, brightness: 0 }
      }
      const duty = pwm > 0 ? pwm / 255 : value === 1 ? 1 : 0
      return { on: driven, brightness: duty * c.brightScale }
    },
  },

  resistor: {
    label: 'Resistor',
    emoji: '〰️',
    defaultPins: [],
    makeState: () => ({ value: 220 }),
    onPinChange() {
      return {}
    },
  },

  buzzer: {
    label: 'Buzzer',
    emoji: '🔔',
    defaultPins: [{ role: 'signal', pin: 8 }],
    makeState: () => ({ active: false, frequency: 0 }),
    onPinChange(comp, pin, value) {
      const c = comp.circuit
      if (!c || c.srcPin !== pin) return {}
      if (!c.gndOk) return { active: false }
      return { active: value === 1 }
    },
  },

  servo: {
    label: 'Servo',
    emoji: '⚙️',
    defaultPins: [{ role: 'signal', pin: 9 }],
    makeState: () => ({ angle: 0 }),
    onPinChange(comp, pin, _value, pwm) {
      const c = comp.circuit
      if (c) {
        if (!c.powered || c.rolePins['signal'] !== pin) return {}
      } else {
        const signal = comp.pins.find((p) => p.role === 'signal')
        if (signal?.pin !== pin) return {}
      }
      // pwm 0-255 maps to 0-180 degrees
      return { angle: Math.round((pwm / 255) * 180) }
    },
  },

  lcd: {
    label: 'LCD 16x2',
    emoji: '🖥️',
    // I2C backpack (the only wiring kody-lcd1602 actually draws) — SDA/SCL
    // on Uno's hardware I2C pins, not the old 4-bit parallel RS/EN wiring.
    defaultPins: [
      { role: 'sda', pin: 'A4' },
      { role: 'scl', pin: 'A5' },
    ],
    makeState: () => ({ lines: ['', ''], cursor: [0, 0] }),
    onPinChange() {
      return {}
    },
  },

  dht11: {
    label: 'DHT11',
    emoji: '🌡️',
    defaultPins: [{ role: 'data', pin: 2 }],
    makeState: () => ({ temperature: 25, humidity: 60 }),
    onPinChange() {
      return {}
    },
  },

  ultrasonic: {
    label: 'Ultrasonik',
    emoji: '📡',
    defaultPins: [
      { role: 'trig', pin: 10 },
      { role: 'echo', pin: 11 },
    ],
    makeState: () => ({ distanceCm: 30 }),
    onPinChange() {
      return {}
    },
  },

  pir: {
    label: 'Sensor PIR',
    emoji: '👁️',
    defaultPins: [{ role: 'out', pin: 4 }],
    makeState: () => ({ detected: false }),
    onPinChange(comp, pin, value) {
      const c = comp.circuit
      if (c) {
        if (!c.powered || c.rolePins['out'] !== pin) return {}
      } else {
        const out = comp.pins.find((p) => p.role === 'out')
        if (out?.pin !== pin) return {}
      }
      return { detected: value === 1 }
    },
  },
  rgb_led: {
    label: 'LED RGB', emoji: '🌈',
    defaultPins: [{ role: 'red', pin: 9 }, { role: 'green', pin: 10 }, { role: 'blue', pin: 11 }],
    makeState: () => ({ red: 0, green: 0, blue: 0 }),
    onPinChange(comp, pin, value, pwm) {
      const patch: Record<string, unknown> = {}
      for (const role of ['red', 'green', 'blue']) {
        if (comp.circuit?.rolePins[role] === pin) patch[role] = pwm > 0 ? pwm : value * 255
      }
      return patch
    },
  },
  pushbutton: {
    label: 'Push Button', emoji: '🔘', defaultPins: [{ role: 'signal', pin: 2 }],
    makeState: () => ({ pressed: false }), onPinChange: () => ({}),
  },
  potentiometer: {
    label: 'Potensiometer 10K', emoji: '🎛️', defaultPins: [{ role: 'signal', pin: 'A0' }],
    makeState: () => ({ value: 512 }), onPinChange: () => ({}),
  },
  ldr: {
    label: 'Sensor Cahaya LDR', emoji: '☀️', defaultPins: [{ role: 'signal', pin: 'A0' }, { role: 'do', pin: 2 }],
    makeState: () => ({ level: 650, threshold: 600 }), onPinChange: () => ({}),
  },
  sound_sensor: {
    label: 'Sensor Suara', emoji: '🎤', defaultPins: [{ role: 'ao', pin: 'A0' }, { role: 'do', pin: 2 }],
    makeState: () => ({ level: 180, threshold: 600 }), onPinChange: () => ({}),
  },
  lm35: {
    label: 'Sensor Suhu LM35', emoji: '🌡️', defaultPins: [{ role: 'signal', pin: 'A0' }],
    makeState: () => ({ temperature: 25 }), onPinChange: () => ({}),
  },
  water_sensor: {
    label: 'Sensor Air', emoji: '💧', defaultPins: [{ role: 'signal', pin: 'A0' }],
    makeState: () => ({ level: 0 }), onPinChange: () => ({}),
  },
  gas_sensor: {
    label: 'Sensor Gas', emoji: '💨', defaultPins: [{ role: 'ao', pin: 'A0' }, { role: 'do', pin: 2 }],
    makeState: () => ({ level: 120, threshold: 600 }), onPinChange: () => ({}),
  },
  flame_sensor: {
    label: 'Sensor Api', emoji: '🔥', defaultPins: [{ role: 'ao', pin: 'A0' }, { role: 'do', pin: 2 }],
    makeState: () => ({ level: 0, threshold: 500 }), onPinChange: () => ({}),
  },
  joystick: {
    label: 'Joystick XY', emoji: '🕹️', defaultPins: [{ role: 'vrx', pin: 'A0' }, { role: 'vry', pin: 'A1' }, { role: 'sw', pin: 2 }],
    makeState: () => ({ x: 512, y: 512, pressed: false }), onPinChange: () => ({}),
  },
  multimeter: {
    label: 'Multimeter', emoji: '📟', defaultPins: [],
    makeState: () => ({ mode: 'V' }), onPinChange: () => ({}),
  },
  logic_analyzer: {
    label: 'Logic Analyzer', emoji: '📈', defaultPins: [],
    makeState: () => ({ events: 0 }), onPinChange: () => ({}),
  },
  relay: {
    label: 'Relay 1 Channel', emoji: '🔌', defaultPins: [{ role: 'in', pin: 7 }],
    makeState: () => ({ active: false }),
    onPinChange(comp, pin, value) {
      return comp.circuit?.rolePins.in === pin ? { active: value === 1 } : {}
    },
  },
  ir_receiver: {
    label: 'IR Receiver', emoji: '📡', defaultPins: [{ role: 'out', pin: 2 }],
    makeState: () => ({ code: 0, active: false }), onPinChange: () => ({}),
  },
  rotary_encoder: {
    label: 'Rotary Encoder', emoji: '🎚️', defaultPins: [{ role: 'clk', pin: 2 }, { role: 'dt', pin: 3 }, { role: 'sw', pin: 4 }],
    makeState: () => ({ value: 0, pressed: false }), onPinChange: () => ({}),
  },
  rfid: {
    label: 'RFID RC522', emoji: '💳', defaultPins: [
      { role: 'sda', pin: 10 }, { role: 'sck', pin: 13 }, { role: 'mosi', pin: 11 },
      { role: 'miso', pin: 12 }, { role: 'rst', pin: 9 },
    ],
    makeState: () => ({ cardPresent: false, uid: 'DE AD BE EF' }), onPinChange: () => ({}),
  },
  keypad: {
    label: 'Keypad 4×4', emoji: '🔢', defaultPins: [],
    makeState: () => ({ key: '' }), onPinChange: () => ({}),
  },
  seven_segment: {
    label: '7-Segment', emoji: '8️⃣', defaultPins: [],
    makeState: () => ({ value: 0 }),
    // Common-cathode digit: each segment lights while its own pin is HIGH.
    onPinChange(comp, pin, value, pwm) {
      const index = SEVEN_SEGMENT_ROLES.findIndex(role => comp.circuit?.rolePins[role] === pin)
      if (index < 0) return {}
      const segments = Array.isArray(comp.state.segments) ? [...comp.state.segments as number[]] : [0, 0, 0, 0, 0, 0, 0, 0]
      segments[index] = value === 1 || pwm > 0 ? 1 : 0
      return { segments }
    },
  },
  led_matrix: {
    label: 'LED Matrix 8×8', emoji: '🔳', defaultPins: [{ role: 'din', pin: 11 }, { role: 'cs', pin: 10 }, { role: 'clk', pin: 13 }],
    makeState: () => ({ pixels: [] }), onPinChange: () => ({}),
  },
  led_matrix4: {
    label: 'LED Matrix 8×32', emoji: '🟥', defaultPins: [{ role: 'din', pin: 11 }, { role: 'cs', pin: 10 }, { role: 'clk', pin: 13 }],
    makeState: () => ({ pixels: [] }), onPinChange: () => ({}),
  },
  stepper: {
    label: 'Stepper 28BYJ-48', emoji: '⚙️', defaultPins: [
      { role: 'in1', pin: 8 }, { role: 'in2', pin: 9 }, { role: 'in3', pin: 10 }, { role: 'in4', pin: 11 },
    ],
    makeState: () => ({ angle: 0, coils: [0, 0, 0, 0], phase: -1 }),
    // The rotor follows the energised coil pattern. Moving to a neighbouring
    // pattern is one half-step forward or back; 28BYJ-48 (64:1 gearbox) needs
    // 4096 half-steps per output revolution, so the Arduino Stepper example's
    // 2048 full steps turn it exactly once.
    onPinChange(comp, pin, value) {
      const index = ['in1', 'in2', 'in3', 'in4'].findIndex((role) => comp.circuit?.rolePins[role] === pin)
      if (index < 0) return {}
      const before = Array.isArray(comp.state.coils) ? comp.state.coils as number[] : [0, 0, 0, 0]
      const coils = [...before]
      coils[index] = value === 1 ? 1 : 0
      // Pins change one at a time, so between two valid patterns the driver
      // briefly shows an invalid one (e.g. 1011). Measure each move from the
      // last valid phase, not from that transient pattern.
      const from = typeof comp.state.phase === 'number' ? comp.state.phase : STEPPER_HALF_STEPS.indexOf(before.join(''))
      const to = STEPPER_HALF_STEPS.indexOf(coils.join(''))
      let angle = Number(comp.state.angle ?? 0)
      if (to < 0) return { coils }
      if (from >= 0 && from !== to) {
        const delta = ((to - from + 12) % 8) - 4 // -4..3; ±4 is ambiguous, ignore
        if (delta !== -4) angle = (((angle + delta * (360 / 4096)) % 360) + 360) % 360
      }
      return { coils, angle, phase: to }
    },
  },

  // ---- parts added alongside ESP32 support ----

  neopixel: {
    label: 'NeoPixel WS2812', emoji: '✨', defaultPins: [{ role: 'din', pin: 5 }],
    makeState: () => ({ red: 0, green: 0, blue: 0 }), onPinChange: () => ({}),
  },
  neopixel_matrix: {
    label: 'NeoPixel Matrix 8×8', emoji: '🟦', defaultPins: [{ role: 'din', pin: 5 }],
    makeState: () => ({ rows: 8, cols: 8, pixels: [] }), onPinChange: () => ({}),
  },
  led_bar: {
    label: 'LED Bar Graph', emoji: '📶', defaultPins: [],
    makeState: () => ({ values: Array.from({ length: 10 }, () => 0) }),
    // Anodes a1–a10 on GPIO, cathodes to GND: an LED lights while its pin is HIGH.
    onPinChange(comp, pin, value, pwm) {
      const index = Array.from({ length: 10 }, (_, i) => `a${i + 1}`).findIndex(role => comp.circuit?.rolePins[role] === pin)
      if (index < 0) return {}
      const values = Array.isArray(comp.state.values) ? [...comp.state.values as number[]] : Array.from({ length: 10 }, () => 0)
      values[index] = pwm > 0 ? pwm / 255 : value === 1 ? 1 : 0
      return { values }
    },
  },
  slide_switch: {
    label: 'Slide Switch', emoji: '🎚', defaultPins: [{ role: '2', pin: 4 }],
    makeState: () => ({ value: 0 }), onPinChange: () => ({}),
  },
  dip_switch: {
    label: 'DIP Switch 8', emoji: '🔢', defaultPins: [],
    makeState: () => ({ values: Array.from({ length: 8 }, () => 0) }), onPinChange: () => ({}),
  },
  tilt_switch: {
    label: 'Sensor Kemiringan', emoji: '📐', defaultPins: [{ role: 'signal', pin: 2 }],
    makeState: () => ({ tilted: false }), onPinChange: () => ({}),
  },
  ntc_temp: {
    label: 'Sensor Suhu NTC', emoji: '🌡', defaultPins: [{ role: 'signal', pin: 'A0' }],
    makeState: () => ({ temperature: 25 }), onPinChange: () => ({}),
  },
  heart_sensor: {
    label: 'Sensor Detak Jantung', emoji: '❤️', defaultPins: [{ role: 'signal', pin: 'A0' }],
    makeState: () => ({ bpm: 72, level: 512 }), onPinChange: () => ({}),
  },
  ds18b20: {
    label: 'DS18B20', emoji: '🌡', defaultPins: [{ role: 'data', pin: 2 }],
    makeState: () => ({ temperature: 25 }), onPinChange: () => ({}),
  },
  dht22: {
    label: 'DHT22', emoji: '🌦', defaultPins: [{ role: 'data', pin: 4 }],
    makeState: () => ({ temperature: 25, humidity: 60 }), onPinChange: () => ({}),
  },
  mpu6050: {
    label: 'MPU6050', emoji: '🧭', defaultPins: [{ role: 'sda', pin: 21 }, { role: 'scl', pin: 22 }],
    makeState: () => ({ ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, temperature: 27, powered: false }),
    onPinChange(comp) {
      return { powered: Boolean(comp.circuit?.powered) }
    },
  },
  hx711: {
    label: 'HX711 Load Cell', emoji: '⚖️', defaultPins: [{ role: 'dt', pin: 4 }, { role: 'sck', pin: 5 }],
    makeState: () => ({ weightGram: 0 }), onPinChange: () => ({}),
  },
  ds1307: {
    label: 'RTC DS1307', emoji: '⏰', defaultPins: [{ role: 'sda', pin: 21 }, { role: 'scl', pin: 22 }],
    makeState: () => ({ epoch: 0 }), onPinChange: () => ({}),
  },
  microsd: {
    label: 'Modul MicroSD', emoji: '💾', defaultPins: [
      { role: 'cs', pin: 5 }, { role: 'mosi', pin: 23 }, { role: 'miso', pin: 19 }, { role: 'sck', pin: 18 },
    ],
    makeState: () => ({ mounted: true, files: [] }), onPinChange: () => ({}),
  },
  ssd1306: {
    label: 'OLED SSD1306', emoji: '📺', defaultPins: [{ role: 'sda', pin: 21 }, { role: 'sck', pin: 22 }],
    makeState: () => ({ lines: [], cursor: [0, 0], textSize: 1 }), onPinChange: () => ({}),
  },
  lcd2004: {
    label: 'LCD 20×4', emoji: '🖵', defaultPins: [{ role: 'sda', pin: 21 }, { role: 'scl', pin: 22 }],
    makeState: () => ({ lines: ['', '', '', ''], cursor: [0, 0], backlight: true }), onPinChange: () => ({}),
  },
  tft_ili9341: {
    label: 'TFT ILI9341', emoji: '🖼', defaultPins: [
      { role: 'cs', pin: 5 }, { role: 'dc', pin: 2 }, { role: 'mosi', pin: 23 }, { role: 'sck', pin: 18 },
    ],
    makeState: () => ({ rotation: 0 }), onPinChange: () => ({}),
  },
}
