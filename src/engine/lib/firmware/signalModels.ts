// Signal-level part models for real AVR firmware, the way Wokwi's parts work:
// a part reads what the firmware actually puts on its pin (a PWM duty, a
// servo pulse width, a tone frequency, an ultrasonic trigger) instead of an
// interpreter shim telling it the result of a library call.
//
// Everything here is driven by CPU cycle counts, never wall-clock time, so
// the result does not depend on how fast the browser runs the emulator.

export const UNO_CLOCK_HZ = 16_000_000
const US = UNO_CLOCK_HZ / 1_000_000

/**
 * Hardware PWM outputs of the ATmega328P as Arduino's analogWrite() uses them:
 * [pin, TCCRnA address, COMnx1 bit, OCRnx address].
 * Timer1 runs in 8-bit phase-correct mode in the Arduino core, so the low
 * byte of OCR1A/OCR1B is the duty.
 */
export const UNO_PWM_OUTPUTS: ReadonlyArray<readonly [pin: number, tccr: number, comBit: number, ocr: number]> = [
  [6, 0x44, 7, 0x47], // OC0A
  [5, 0x44, 5, 0x48], // OC0B
  [9, 0x80, 7, 0x88], // OC1A
  [10, 0x80, 5, 0x8a], // OC1B
  [11, 0xb0, 7, 0xb3], // OC2A
  [3, 0xb0, 5, 0xb4], // OC2B
]

/** Duty (0-255) of every pin whose timer compare output is driving it, else absent. */
export function readUnoPwm(data: Uint8Array): Map<number, number> {
  const duties = new Map<number, number>()
  for (const [pin, tccr, bit, ocr] of UNO_PWM_OUTPUTS) {
    if (data[tccr] & (1 << bit)) duties.set(pin, data[ocr])
  }
  return duties
}

/** Arduino Servo library defaults (MIN_PULSE_WIDTH / MAX_PULSE_WIDTH). */
export const SERVO_MIN_US = 544
export const SERVO_MAX_US = 2400

export function servoAngleFromPulse(widthUs: number): number | null {
  // Anything outside a generous servo window is not a servo pulse (e.g. a
  // digitalWrite HIGH that stays on); ignore it rather than slam to 180°.
  if (widthUs < 400 || widthUs > 2600) return null
  const clamped = Math.max(SERVO_MIN_US, Math.min(SERVO_MAX_US, widthUs))
  return Math.round(((clamped - SERVO_MIN_US) / (SERVO_MAX_US - SERVO_MIN_US)) * 180)
}

export type PinRole = 'servo' | 'buzzer' | 'ultrasonic-trig'

export interface SignalEvents {
  servoAngle?: (pin: number, angle: number) => void
  tone?: (pin: number, frequency: number) => void
  noTone?: (pin: number) => void
  /** Trigger pin fired: echo pin should read HIGH during [startCycle, endCycle). */
  echo?: (trigPin: number, startCycle: number, endCycle: number) => void
}

interface PinTrack {
  level: number
  riseAt: number
  lastRise: number
  period: number
  lastAngle: number | null
  pendingAngle: number | null
  toneHz: number
}

/**
 * Edge decoder fed with sampled pin levels and the cycle they were seen at.
 * Only pins with a role are decoded, so an LED blinking on a plain pin costs
 * nothing here.
 */
export function createSignalDecoder(events: SignalEvents, echoDistanceCm: (trigPin: number) => number) {
  const roles = new Map<number, PinRole>()
  const tracks = new Map<number, PinTrack>()
  const track = (pin: number) => {
    let entry = tracks.get(pin)
    if (!entry) { entry = { level: 0, riseAt: -1, lastRise: -1, period: 0, lastAngle: null, pendingAngle: null, toneHz: 0 }; tracks.set(pin, entry) }
    return entry
  }

  return {
    setRoles(next: Map<number, PinRole>) {
      for (const [pin, role] of roles) if (next.get(pin) !== role && role === 'buzzer' && track(pin).toneHz) { track(pin).toneHz = 0; events.noTone?.(pin) }
      roles.clear()
      for (const [pin, role] of next) roles.set(pin, role)
    },

    observe(pin: number, level: number, cycle: number) {
      const role = roles.get(pin)
      if (!role) return
      const t = track(pin)
      if (level === t.level) return
      t.level = level
      if (level === 1) {
        if (t.lastRise >= 0) t.period = cycle - t.lastRise
        t.lastRise = cycle
        t.riseAt = cycle
        if (role === 'buzzer' && t.period > 0) {
          const hz = Math.round(UNO_CLOCK_HZ / t.period)
          // Audible range only; a slow blink on a buzzer pin is not a tone.
          if (hz >= 31 && hz <= 20_000 && Math.abs(hz - t.toneHz) > Math.max(2, t.toneHz * 0.02)) { t.toneHz = hz; events.tone?.(pin, hz) }
        }
        return
      }
      // falling edge
      if (t.riseAt < 0) return
      const widthUs = (cycle - t.riseAt) / US
      if (role === 'servo') {
        const angle = servoAngleFromPulse(widthUs)
        if (angle === null || angle === t.lastAngle) return
        // Pulse edges are sampled every 16µs (~1.6°), so a steady servo would
        // flicker ±1°. Accept a small change only once two pulses agree.
        const settled = t.lastAngle === null || Math.abs(angle - t.lastAngle) >= 3 || angle === t.pendingAngle
        t.pendingAngle = angle
        if (settled) { t.lastAngle = angle; events.servoAngle?.(pin, angle) }
      } else if (role === 'ultrasonic-trig' && widthUs >= 10) {
        // HC-SR04: ~250µs after the trigger the echo goes HIGH for 58µs/cm.
        const distance = echoDistanceCm(pin)
        if (distance > 0) {
          const start = cycle + 250 * US
          events.echo?.(pin, start, start + Math.round(distance * 58 * US))
        }
      }
    },

    /**
     * Whether the pin's plain HIGH/LOW should still reach the circuit. A servo
     * only understands pulse width, and a tone is already reported as a
     * frequency; forwarding every edge would make the part reset to "LOW".
     */
    forwardsLevel(pin: number) {
      const role = roles.get(pin)
      if (role === 'servo') return false
      if (role === 'buzzer') return !tracks.get(pin)?.toneHz
      return true
    },

    /** Call regularly: a buzzer whose edges stopped has gone quiet. */
    tick(cycle: number) {
      for (const [pin, role] of roles) {
        if (role !== 'buzzer') continue
        const t = track(pin)
        if (t.toneHz && cycle - t.lastRise > Math.max(3 * t.period, 50_000 * US)) {
          t.toneHz = 0
          t.period = 0
          events.noTone?.(pin)
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Input waveforms: what a sensor drives back onto a pin, scheduled in cycles.

/** Level a pin reads before, during and after a sensor's reply. */
export interface InputWaveform {
  /** Level before the first step (e.g. pulled-up HIGH, or LOW for an echo). */
  initial: number
  /** [cycle, level] transitions in ascending order. */
  steps: Array<[number, number]>
  /** After this cycle the sensor lets go and normal circuit reading resumes. */
  until: number
}

export function waveformLevel(wave: InputWaveform, cycle: number): number {
  let level = wave.initial
  for (const [at, next] of wave.steps) {
    if (at > cycle) break
    level = next
  }
  return level
}

/** Time between quadrature edges when the knob is turned (~6 ms per detent). */
export const ENCODER_EDGE_CYCLES = 1500 * US

/**
 * KY-040 style encoder turned by `detents` (positive = clockwise) starting at
 * `start`: each detent is one full quadrature cycle from the idle HIGH/HIGH
 * rest position; clockwise CLK falls first, counter-clockwise DT does. The
 * lines stay at rest (pull-ups) afterwards, so `until` never ends.
 */
export function encoderWaveforms(start: number, detents: number): { clk: InputWaveform; dt: InputWaveform } {
  const clk: Array<[number, number]> = [], dt: Array<[number, number]> = []
  const count = Math.min(Math.abs(Math.trunc(detents)), 400)
  const [first, second] = detents > 0 ? [clk, dt] : [dt, clk]
  let at = start
  for (let i = 0; i < count; i++) {
    first.push([at, 0]); second.push([at += ENCODER_EDGE_CYCLES, 0])
    first.push([at += ENCODER_EDGE_CYCLES, 1]); second.push([at += ENCODER_EDGE_CYCLES, 1])
    at += ENCODER_EDGE_CYCLES
  }
  return { clk: { initial: 1, steps: clk, until: Infinity }, dt: { initial: 1, steps: dt, until: Infinity } }
}

/** HC-SR04 echo as a waveform: LOW, then HIGH for the round trip. */
export function echoWaveform(start: number, end: number): InputWaveform {
  return { initial: 0, steps: [[start, 1], [end, 0]], until: end + 1 }
}

/** The 5 bytes a DHT11/DHT22 sends for a temperature (°C) and humidity (%). */
export function dhtFrame(type: 'dht11' | 'dht22', temperature: number, humidity: number): number[] {
  let bytes: number[]
  if (type === 'dht11') {
    const t = Math.max(0, Math.min(50, temperature)), h = Math.max(0, Math.min(99, humidity))
    bytes = [Math.floor(h), 0, Math.floor(t), Math.round((t % 1) * 10) % 10]
  } else {
    const h = Math.round(Math.max(0, Math.min(100, humidity)) * 10)
    const t = Math.round(Math.max(-40, Math.min(80, temperature)) * 10)
    const tRaw = t < 0 ? 0x8000 | -t : t
    bytes = [h >> 8, h & 0xff, tRaw >> 8, tRaw & 0xff]
  }
  return [...bytes, bytes.reduce((sum, b) => sum + b, 0) & 0xff]
}

/**
 * DHT reply after the host releases the line at `release`: ~20µs later the
 * sensor pulls LOW 80µs, HIGH 80µs, then 40 bits of LOW 50µs + HIGH 26µs (0)
 * or 70µs (1), then a final LOW 50µs before letting the line float HIGH.
 */
export function dhtWaveform(release: number, bytes: number[]): InputWaveform {
  const steps: Array<[number, number]> = []
  let t = release + 20 * US
  const put = (level: number, us: number) => { steps.push([Math.round(t), level]); t += us * US }
  put(0, 80); put(1, 80)
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) { put(0, 50); put(1, byte & (1 << bit) ? 70 : 26) }
  put(0, 50)
  steps.push([Math.round(t), 1])
  return { initial: 1, steps, until: Math.round(t) + 1 }
}

/** Host start signal: line held LOW at least this long, then released. */
export const DHT_START_MIN_CYCLES = 500 * US

// ---------------------------------------------------------------------------
// WS2812 (NeoPixel): decoded from exact port-write cycles.

/**
 * Bits are HIGH ~0.35µs (0) or ~0.7µs (1) inside a 1.25µs slot; a LOW longer
 * than 50µs latches the frame. Colors arrive as G, R, B bytes per pixel.
 */
export function createNeoPixelDecoder(onFrame: (pixels: number[]) => void) {
  let level = 0
  let riseAt = -1
  let lastEdge = -1
  let bits: number[] = []
  const latch = () => {
    if (bits.length >= 24) {
      const pixels: number[] = []
      for (let i = 0; i + 24 <= bits.length; i += 24) {
        const byte = (offset: number) => bits.slice(i + offset, i + offset + 8).reduce((v, b) => (v << 1) | b, 0)
        const g = byte(0), r = byte(8), b = byte(16)
        pixels.push((r << 16) | (g << 8) | b)
      }
      onFrame(pixels)
    }
    bits = []
  }
  return {
    edge(next: number, cycle: number) {
      if (next === level) return
      if (next === 1 && lastEdge >= 0 && cycle - lastEdge > 50 * US) latch()
      level = next
      lastEdge = cycle
      if (next === 1) { riseAt = cycle; return }
      if (riseAt >= 0) bits.push(cycle - riseAt > 0.55 * US ? 1 : 0)
    },
    /** Call periodically: a long LOW after data means the frame is complete. */
    tick(cycle: number) {
      if (level === 0 && bits.length && cycle - lastEdge > 50 * US) latch()
    },
  }
}

// ---------------------------------------------------------------------------
// IR receiver (VS1838B-style): demodulated NEC frame on the OUT pin.

/**
 * NEC frame as the receiver outputs it (active LOW, idle HIGH): 9ms burst,
 * 4.5ms space, 32 bits LSB first (address, ~address, command, ~command),
 * each a 562µs burst plus 562µs (0) or 1687µs (1) space, then a stop burst.
 */
export function necWaveform(start: number, address: number, command: number): InputWaveform {
  const steps: Array<[number, number]> = []
  let t = start
  const put = (level: number, us: number) => { steps.push([Math.round(t), level]); t += us * US }
  put(0, 9000); put(1, 4500)
  const bytes = [address & 0xff, ~address & 0xff, command & 0xff, ~command & 0xff]
  for (const byte of bytes) for (let bit = 0; bit < 8; bit++) { put(0, 562); put(1, byte & (1 << bit) ? 1687 : 562) }
  put(0, 562)
  steps.push([Math.round(t), 1])
  return { initial: 1, steps, until: Math.round(t) + 1 }
}

// ---------------------------------------------------------------------------
// MAX7219 8×8 LED matrix driver, fed from DIN/CLK/CS (LedControl bit-bangs
// these with shiftOut, far faster than the 16µs sync step).

export interface Max7219State {
  rows: number[]
  intensity: number
  shutdown: boolean
  test: boolean
  /** Digits (rows) 0..scanLimit are multiplexed; the rest stay dark. */
  scanLimit: number
  /** Code-B decode bits per digit (7-segment use; a matrix leaves it 0). */
  decode: number
}

/** Power-up: every control register cleared, display blanked, shutdown mode. */
export function max7219PowerOn(): Max7219State {
  return { rows: new Array(8).fill(0), intensity: 0, shutdown: true, test: false, scanLimit: 0, decode: 0 }
}

/** Apply one 16-bit word (D11–D8 register, D7–D0 data) latched by LOAD. */
export function max7219Apply(state: Max7219State, word: number): boolean {
  const register = (word >> 8) & 0x0f, data = word & 0xff
  if (register >= 1 && register <= 8) state.rows[register - 1] = data
  else if (register === 0x09) state.decode = data
  else if (register === 0x0a) state.intensity = data & 0x0f
  else if (register === 0x0b) state.scanLimit = data & 0x07
  else if (register === 0x0c) state.shutdown = (data & 1) === 0
  else if (register === 0x0f) state.test = (data & 1) === 1
  return register !== 0 // 0 = no-op, what LedControl sends to the other chips
}

/**
 * MAX7219 chips daisy-chained DOUT→DIN, sharing CLK and LOAD. Each chip is a
 * 16-bit shift register: a bit clocked into chip 0 pushes chip 0's MSB into
 * chip 1, and so on. Rising LOAD latches every chip's own 16 bits, so chip 0
 * (nearest the MCU) gets the last word shifted — as LedControl expects.
 */
export class Max7219Chain {
  readonly states: Max7219State[]
  private readonly words: number[]
  private clk = 0
  private cs = 1

  constructor(devices = 1) {
    this.states = Array.from({ length: devices }, max7219PowerOn)
    this.words = new Array(devices).fill(0)
  }

  shiftBit(bit: number) {
    for (let i = this.words.length - 1; i >= 0; i--) {
      const carry = i === 0 ? bit & 1 : (this.words[i - 1] >> 15) & 1
      this.words[i] = ((this.words[i] << 1) | carry) & 0xffff
    }
  }

  shiftWord(word: number) { for (let bit = 15; bit >= 0; bit--) this.shiftBit((word >> bit) & 1) }

  /** Rising LOAD. Returns true when a chip took a register write. */
  load(): boolean {
    let changed = false
    this.states.forEach((state, i) => { if (max7219Apply(state, this.words[i])) changed = true })
    return changed
  }

  /** Current levels of DIN/CLK/LOAD after a port write. */
  update(din: number, clk: number, cs: number): boolean {
    let changed = false
    if (cs === 0 && !this.clk && clk) this.shiftBit(din) // rising CLK while selected
    if (!this.cs && cs) changed = this.load()
    this.clk = clk
    this.cs = cs
    return changed
  }
}

/** Single-chip decoder, fed from DIN/CLK/CS (LedControl bit-bangs these with shiftOut). */
export function createMax7219Decoder(onChange: (state: Max7219State) => void) {
  const chain = new Max7219Chain(1)
  return {
    update(din: number, clk: number, cs: number) {
      if (chain.update(din, clk, cs)) onChange({ ...chain.states[0], rows: [...chain.states[0].rows] })
    },
  }
}

/** Lit pixel indexes (row × 8 + column) for the canvas, as LedControl lays them out. */
export function max7219Pixels(state: Max7219State): number[] {
  const pixels: number[] = []
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    if (state.test || (row <= state.scanLimit && state.rows[row] & (0x80 >> col))) pixels.push(row * 8 + col)
  }
  return pixels
}

/** Canvas state of a matrix part: chip 0 as before, plus every chained module. */
export function matrixPatch(states: Max7219State[]) {
  const first = states[0]
  return {
    pixels: max7219Pixels(first), intensity: first.intensity, shutdown: first.shutdown,
    ...(states.length > 1 ? { modules: states.map(state => ({ pixels: max7219Pixels(state), intensity: state.intensity, shutdown: state.shutdown })) } : {}),
  }
}

/** HX711 counts per gram for a 5 kg bar cell (1 mV/V, 5 V excitation) at gain 128. */
export const HX711_COUNTS_PER_GRAM = 420
/** Unloaded bridge imbalance of a typical cell, so tare() has something to remove. */
export const HX711_ZERO_OFFSET = 8_400

/**
 * HX711 24-bit ADC on its two-wire serial port. DOUT goes LOW when a
 * conversion is ready (10 SPS with RATE tied low, as on the common green
 * board); each SCK rising edge shifts out one bit MSB-first; 1–3 extra pulses
 * pick the next channel/gain (A128 / B32 / A64); SCK held HIGH for over 60 µs
 * powers it down, and it settles for 400 ms after waking.
 */
export function createHx711(startCycle: number, grams: () => number) {
  const PERIOD = UNO_CLOCK_HZ / 10
  const SETTLE = UNO_CLOCK_HZ * 0.4
  const POWER_DOWN = 60 * US
  const GAIN_GAP = 50 * US
  let epoch = startCycle + SETTLE // next conversion ready at or after this cycle
  let pulses = 0
  let word = 0
  let gain = 128
  let sck = 0
  let highSince = 0
  let lastFall = 0
  const nextReady = (cycle: number) => cycle < epoch ? epoch : epoch + Math.ceil((cycle - epoch + 1) / PERIOD) * PERIOD
  const sample = () => {
    const scaled = (HX711_ZERO_OFFSET + (gain === 32 ? 0 : grams() * HX711_COUNTS_PER_GRAM)) * (gain / 128)
    return Math.max(-0x800000, Math.min(0x7fffff, Math.round(scaled))) & 0xffffff
  }
  /** Close a finished read: the gain pulses set the next conversion's gain. */
  const finish = () => {
    gain = pulses === 25 ? 128 : pulses === 26 ? 32 : 64
    pulses = 0
    epoch = nextReady(lastFall)
  }
  const level = (cycle: number) => {
    if (sck && cycle - highSince > POWER_DOWN) return 1
    if (pulses >= 25) return cycle - lastFall > GAIN_GAP && cycle >= nextReady(lastFall) ? 0 : 1
    if (pulses > 0) return (word >> (24 - pulses)) & 1
    return cycle >= epoch ? 0 : 1
  }
  return {
    /** DOUT level at `cycle` (between SCK edges). */
    level,
    /** SCK driven to `high` at `cycle`; returns DOUT right after the edge. */
    clock(high: boolean, cycle: number) {
      if (high && !sck) {
        sck = 1; highSince = cycle
        if (pulses >= 25) {
          if (pulses < 27 && cycle - lastFall <= GAIN_GAP) { pulses++; return 1 }
          finish()
        }
        if (pulses === 0) {
          if (cycle < epoch) return 1 // not ready: the chip ignores the pulse
          word = sample()
        }
        if (pulses < 24) pulses++
        else pulses = 25
        return pulses <= 24 ? (word >> (24 - pulses)) & 1 : 1
      }
      if (!high && sck) {
        sck = 0
        if (cycle - highSince > POWER_DOWN) { pulses = 0; gain = 128; epoch = cycle + SETTLE; return 1 }
        lastFall = cycle
      }
      return level(cycle)
    },
  }
}

/**
 * Mechanical contact bounce when a push button or slide switch changes to
 * `level`: the contacts chatter for about a millisecond before settling, as a
 * real tactile switch does (Wokwi models the same). Sketches must debounce.
 */
export function bounceWaveform(start: number, level: number): InputWaveform {
  const other = level ? 0 : 1
  const at = [0, 90, 260, 430, 700, 980].map(us => start + us * US)
  return { initial: other, steps: at.map((cycle, i) => [cycle, i % 2 === 0 ? level : other] as [number, number]).concat([[start + 1250 * US, level]]), until: start + 1300 * US }
}
