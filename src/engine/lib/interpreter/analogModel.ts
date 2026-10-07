import type { BoardId } from '../boards/types'

/** Ideal educational input full scale, NOT calibrated ADC reference voltages.
 * ESP attenuation, nonlinearity and NodeMCU A0 divider tolerances are unmodeled.
 * Keep separate from logicVolts: changing GPIO levels must not change ADC gain.
 */
export const NOMINAL_ADC_FULL_SCALE: Record<BoardId, number> = {
  uno: 5, nano: 5, mega: 5,
  esp32: 3.3, 'esp32-s2': 3.3, 'esp32-s3': 3.3,
  'esp32-c3': 3.3, 'esp32-c6': 3.3, esp8266: 3.3,
}

export const ANALOG_OUTPUT_ROLES: Partial<Record<string, readonly string[]>> = {
  potentiometer: ['signal'], ldr: ['signal'], sound_sensor: ['ao'],
  gas_sensor: ['ao'], flame_sensor: ['ao'], water_sensor: ['signal'],
  heart_sensor: ['signal'], lm35: ['signal'], ntc_temp: ['signal'],
  joystick: ['vrx', 'vry'],
}

export function adcCounts(fraction: number, max: number): number {
  if (Number.isNaN(fraction)) return 0
  return Math.round(Math.max(0, Math.min(1, fraction)) * max)
}

/** 10k fixed resistor to VCC; 10k NTC (at 25°C), Beta 3950 K, to GND.
 * AO falls as temperature rises. Below absolute zero saturates at cold rail.
 * Log-domain ratio avoids overflow at the cold end.
 */
export function ntcDividerFraction(celsius: number): number {
  const kelvin = celsius + 273.15
  if (kelvin <= 0) return 1
  const logRatio = 3950 * (1 / kelvin - 1 / 298.15)
  return 1 / (1 + Math.exp(-logRatio))
}

/**
 * Pulse sensor (PulseSensor.com style) output in 10-bit counts at time
 * `seconds`: a photoplethysmogram at `bpm` — steep systolic upstroke, peak,
 * dicrotic notch and diastolic wave — riding on a mid-rail baseline, the way
 * the real sensor's amplifier centres it (~512, peaks near 800).
 */
export function pulseWaveCounts(seconds: number, bpm: number): number {
  const rate = Math.max(20, Math.min(250, Number.isFinite(bpm) ? bpm : 72))
  const phase = (seconds * rate / 60) % 1
  const bump = (centre: number, width: number) => Math.exp(-(((phase - centre) / width) ** 2))
  const wave = 0.95 * bump(0.12, 0.045) + 0.28 * bump(0.34, 0.07) - 0.06 * bump(0.25, 0.02)
  return Math.round(470 + 330 * wave)
}
