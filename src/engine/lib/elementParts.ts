// ============================================================
// KodyUno — Element-backed part geometry
//
// Terminal coordinates for the parts whose artwork comes from the KodyUno
// element library. They are lifted from each element's own pin table, so a
// wire endpoint always lands on the metal that is actually drawn.
//
// Units are CSS pixels at 96dpi, matching the element's rendered size.
// partSpecs.ts scales them into simulator canvas units.
// ============================================================
import type { TerminalKind } from './partSpecs'

export interface ElementTerminal {
  role: string
  dx: number
  dy: number
  kind: TerminalKind
  color: string
}

export interface ElementGeometry {
  tag: string
  cssW: number
  cssH: number
  terminals: ElementTerminal[]
}

export const ELEMENT_GEOMETRY: Record<string, ElementGeometry> = {
  'ssd1306': {
    tag: 'kody-ssd1306',
    cssW: 148,
    cssH: 114,
    terminals: [
      { role: 'sda', dx: 36.5, dy: 12.5, kind: 'signal', color: '#8b5cf6' },
      { role: 'sck', dx: 45.5, dy: 12.5, kind: 'signal', color: '#0ea5e9' },
      { role: 'dc', dx: 54.5, dy: 12.5, kind: 'signal', color: '#f97316' },
      { role: 'rst', dx: 64.5, dy: 12.5, kind: 'signal', color: '#22c55e' },
      { role: 'cs', dx: 74.5, dy: 12.5, kind: 'signal', color: '#eab308' },
      { role: 'vcc', dx: 83.5, dy: 12.5, kind: 'vcc', color: '#dc2626' },
      { role: 'vin', dx: 93.5, dy: 12.5, kind: 'vcc', color: '#dc2626' },
      { role: 'gnd', dx: 103.5, dy: 12, kind: 'gnd', color: '#334155' },
    ],
  },
  'dht22': {
    tag: 'kody-dht22',
    cssW: 57.07,
    cssH: 116.73,
    terminals: [
      { role: 'vcc', dx: 15, dy: 114.9, kind: 'vcc', color: '#dc2626' },
      { role: 'data', dx: 24.5, dy: 114.9, kind: 'signal', color: '#8b5cf6' },
      // NC = not connected on the real module; 'passive' keeps it out of the
      // solver's required-signal check so it doesn't force a permanent
      // "kabel belum tersambung" warning on an otherwise fully-wired sensor.
      { role: 'nc', dx: 34.1, dy: 114.9, kind: 'passive', color: '#94a3b8' },
      { role: 'gnd', dx: 43.8, dy: 114.9, kind: 'gnd', color: '#334155' },
    ],
  },
  'mpu6050': {
    tag: 'kody-mpu6050',
    cssW: 81.64,
    cssH: 61.23,
    terminals: [
      { role: 'int', dx: 7.28, dy: 5.78, kind: 'signal', color: '#8b5cf6' },
      { role: 'ad0', dx: 16.9, dy: 5.78, kind: 'signal', color: '#0ea5e9' },
      { role: 'xcl', dx: 26.4, dy: 5.78, kind: 'signal', color: '#f97316' },
      { role: 'xda', dx: 36, dy: 5.78, kind: 'signal', color: '#22c55e' },
      { role: 'sda', dx: 45.6, dy: 5.78, kind: 'signal', color: '#eab308' },
      { role: 'scl', dx: 55.2, dy: 5.78, kind: 'signal', color: '#ec4899' },
      { role: 'gnd', dx: 64.8, dy: 5.78, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 74.4, dy: 5.78, kind: 'vcc', color: '#dc2626' },
    ],
  },
  'ds1307': {
    tag: 'kody-ds1307',
    cssW: 97.51,
    cssH: 83.95,
    terminals: [
      { role: 'gnd', dx: 9.5, dy: 15, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 9.5, dy: 25, kind: 'vcc', color: '#dc2626' },
      { role: 'sda', dx: 9.5, dy: 34.5, kind: 'signal', color: '#8b5cf6' },
      { role: 'scl', dx: 9.5, dy: 44, kind: 'signal', color: '#0ea5e9' },
      { role: 'sqw', dx: 9.5, dy: 54, kind: 'signal', color: '#f97316' },
    ],
  },
  'dip-switch-8': {
    tag: 'kody-dip-switch-8',
    cssW: 82.87,
    cssH: 55.35,
    terminals: [
      { role: '1a', dx: 8.1, dy: 51.3, kind: 'signal', color: '#8b5cf6' },
      { role: '2a', dx: 17.7, dy: 51.3, kind: 'signal', color: '#0ea5e9' },
      { role: '3a', dx: 27.3, dy: 51.3, kind: 'signal', color: '#f97316' },
      { role: '4a', dx: 36.9, dy: 51.3, kind: 'signal', color: '#22c55e' },
      { role: '5a', dx: 46.5, dy: 51.3, kind: 'signal', color: '#eab308' },
      { role: '6a', dx: 56.1, dy: 51.3, kind: 'signal', color: '#ec4899' },
      { role: '7a', dx: 65.7, dy: 51.3, kind: 'signal', color: '#14b8a6' },
      { role: '8a', dx: 75.3, dy: 51.3, kind: 'signal', color: '#f43f5e' },
      { role: '8b', dx: 75.3, dy: 3, kind: 'signal', color: '#a855f7' },
      { role: '7b', dx: 65.7, dy: 3, kind: 'signal', color: '#8b5cf6' },
      { role: '6b', dx: 56.1, dy: 3, kind: 'signal', color: '#0ea5e9' },
      { role: '5b', dx: 46.5, dy: 3, kind: 'signal', color: '#f97316' },
      { role: '4b', dx: 36.9, dy: 3, kind: 'signal', color: '#22c55e' },
      { role: '3b', dx: 27.3, dy: 3, kind: 'signal', color: '#eab308' },
      { role: '2b', dx: 17.7, dy: 3, kind: 'signal', color: '#ec4899' },
      { role: '1b', dx: 8.1, dy: 3, kind: 'signal', color: '#14b8a6' },
    ],
  },
  'slide-switch': {
    tag: 'kody-slide-switch',
    cssW: 32.13,
    cssH: 34.89,
    terminals: [
      { role: '1', dx: 6.5, dy: 34, kind: 'signal', color: '#8b5cf6' },
      { role: '2', dx: 16, dy: 34, kind: 'signal', color: '#0ea5e9' },
      { role: '3', dx: 25.5, dy: 34, kind: 'signal', color: '#f97316' },
    ],
  },
  'tilt-switch': {
    tag: 'kody-tilt-switch',
    cssW: 88.44,
    cssH: 55.56,
    terminals: [
      { role: 'gnd', dx: 88, dy: 18, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 88, dy: 27.8, kind: 'vcc', color: '#dc2626' },
      { role: 'signal', dx: 88, dy: 37.5, kind: 'signal', color: '#8b5cf6' },
    ],
  },
  'ntc-temperature-sensor': {
    tag: 'kody-ntc-temperature-sensor',
    cssW: 135.41,
    cssH: 71.81,
    terminals: [
      { role: 'gnd', dx: 135, dy: 26.2, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 135, dy: 35.8, kind: 'vcc', color: '#dc2626' },
      { role: 'signal', dx: 135, dy: 45.5, kind: 'signal', color: '#8b5cf6' },
    ],
  },
  'heart-beat-sensor': {
    tag: 'kody-heart-beat-sensor',
    cssW: 88.44,
    cssH: 79.15,
    terminals: [
      { role: 'gnd', dx: 87, dy: 17.8, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 87, dy: 27.5, kind: 'vcc', color: '#dc2626' },
      { role: 'signal', dx: 87, dy: 37.5, kind: 'signal', color: '#8b5cf6' },
    ],
  },
  'microsd-card': {
    tag: 'kody-microsd-card',
    cssW: 81.64,
    cssH: 77.1,
    terminals: [
      { role: 'cd', dx: 76.734, dy: 9.3744, kind: 'signal', color: '#8b5cf6' },
      { role: 'miso', dx: 76.734, dy: 18.8622, kind: 'signal', color: '#0ea5e9' },
      { role: 'gnd', dx: 76.734, dy: 28.4634, kind: 'gnd', color: '#334155' },
      { role: 'sck', dx: 76.734, dy: 38.178, kind: 'signal', color: '#f97316' },
      { role: 'vcc', dx: 76.734, dy: 47.628, kind: 'vcc', color: '#dc2626' },
      { role: 'mosi', dx: 76.734, dy: 57.456, kind: 'signal', color: '#22c55e' },
      { role: 'cs', dx: 76.734, dy: 66.906, kind: 'signal', color: '#eab308' },
    ],
  },
  'ili9341': {
    tag: 'kody-ili9341',
    cssW: 175.75,
    cssH: 293.29,
    terminals: [
      { role: 'vcc', dx: 48.3, dy: 287.2, kind: 'vcc', color: '#dc2626' },
      { role: 'gnd', dx: 57.9012, dy: 287.2, kind: 'gnd', color: '#334155' },
      { role: 'cs', dx: 67.5024, dy: 287.2, kind: 'signal', color: '#8b5cf6' },
      { role: 'rst', dx: 77.1036, dy: 287.2, kind: 'signal', color: '#0ea5e9' },
      { role: 'dc', dx: 86.7048, dy: 287.2, kind: 'signal', color: '#f97316' },
      { role: 'mosi', dx: 96.306, dy: 287.2, kind: 'signal', color: '#22c55e' },
      { role: 'sck', dx: 105.9072, dy: 287.2, kind: 'signal', color: '#eab308' },
      { role: 'led', dx: 115.5084, dy: 287.2, kind: 'signal', color: '#ec4899' },
      { role: 'miso', dx: 125.1096, dy: 287.2, kind: 'signal', color: '#14b8a6' },
    ],
  },
  'neopixel': {
    tag: 'kody-neopixel',
    cssW: 21.4,
    cssH: 18.9,
    terminals: [
      { role: 'vcc', dx: 1, dy: 3.5, kind: 'vcc', color: '#dc2626' },
      { role: 'dout', dx: 1, dy: 14, kind: 'signal', color: '#8b5cf6' },
      { role: 'gnd', dx: 21, dy: 14, kind: 'gnd', color: '#334155' },
      { role: 'din', dx: 21, dy: 3.5, kind: 'signal', color: '#0ea5e9' },
    ],
  },

  // ---- parts whose element builds its pin table from props ----
  'neopixel-matrix': {
    tag: 'kody-neopixel-matrix',
    cssW: 181.4,
    cssH: 181.4,
    terminals: [
      { role: 'vcc', dx: 5, dy: 8, kind: 'vcc', color: '#dc2626' },
      { role: 'din', dx: 5, dy: 22, kind: 'signal', color: '#0ea5e9' },
      { role: 'gnd', dx: 5, dy: 36, kind: 'gnd', color: '#334155' },
      { role: 'dout', dx: 176, dy: 22, kind: 'signal', color: '#8b5cf6' },
    ],
  },
  'led-bar-graph': {
    tag: 'kody-led-bar-graph',
    cssW: 38.17,
    cssH: 96.38,
    terminals: [
      ...Array.from({ length: 10 }, (_, i) => ({
        role: `a${i + 1}`,
        dx: 3.4,
        dy: 6 + i * 9.6,
        kind: 'anode' as TerminalKind,
        color: '#ef4444',
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        role: `c${i + 1}`,
        dx: 34.8,
        dy: 6 + i * 9.6,
        kind: 'cathode' as TerminalKind,
        color: '#334155',
      })),
    ],
  },
  lcd2004: {
    tag: 'kody-lcd2004',
    cssW: 370.4,
    cssH: 226.8,
    terminals: [
      { role: 'gnd', dx: 24, dy: 220, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 42, dy: 220, kind: 'vcc', color: '#dc2626' },
      { role: 'sda', dx: 60, dy: 220, kind: 'signal', color: '#8b5cf6' },
      { role: 'scl', dx: 78, dy: 220, kind: 'signal', color: '#0ea5e9' },
    ],
  },
  hx711: {
    tag: 'kody-hx711',
    cssW: 128.5,
    cssH: 79.4,
    terminals: [
      { role: 'gnd', dx: 7, dy: 26.5, kind: 'gnd', color: '#334155' },
      { role: 'dt', dx: 7, dy: 40.1, kind: 'signal', color: '#8b5cf6' },
      { role: 'sck', dx: 7, dy: 53.7, kind: 'signal', color: '#0ea5e9' },
      { role: 'vcc', dx: 7, dy: 67.3, kind: 'vcc', color: '#dc2626' },
    ],
  },
  'servo': {
    tag: 'kody-servo',
    cssW: 170.08,
    cssH: 119.55,
    terminals: [
      { role: 'gnd', dx: 0, dy: 50, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 0, dy: 59.5, kind: 'vcc', color: '#dc2626' },
      { role: 'signal', dx: 0, dy: 69, kind: 'signal', color: '#f97316' },
    ],
  },
  'lcd1602': {
    tag: 'kody-lcd1602',
    cssW: 302.36,
    cssH: 136.06,
    terminals: [
      { role: 'gnd', dx: 4, dy: 32, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 4, dy: 41.5, kind: 'vcc', color: '#dc2626' },
      { role: 'sda', dx: 4, dy: 51, kind: 'signal', color: '#8b5cf6' },
      { role: 'scl', dx: 4, dy: 60.5, kind: 'signal', color: '#0ea5e9' },
    ],
  },
  'hc-sr04': {
    tag: 'kody-hc-sr04',
    cssW: 170.08,
    cssH: 94.49,
    terminals: [
      { role: 'vcc', dx: 71.3, dy: 94.5, kind: 'vcc', color: '#dc2626' },
      { role: 'trig', dx: 81.3, dy: 94.5, kind: 'signal', color: '#10b981' },
      { role: 'echo', dx: 91.3, dy: 94.5, kind: 'signal', color: '#f43f5e' },
      { role: 'gnd', dx: 101.3, dy: 94.5, kind: 'gnd', color: '#334155' },
    ],
  },
  'pir-motion-sensor': {
    tag: 'kody-pir-motion-sensor',
    cssW: 90.71,
    cssH: 92.4,
    terminals: [
      { role: 'vcc', dx: 36.178, dy: 92, kind: 'vcc', color: '#dc2626' },
      { role: 'out', dx: 45.9175, dy: 92, kind: 'signal', color: '#f43f5e' },
      { role: 'gnd', dx: 55.6415, dy: 92, kind: 'gnd', color: '#334155' },
    ],
  },
  'potentiometer': {
    tag: 'kody-potentiometer',
    cssW: 75.59,
    cssH: 75.59,
    terminals: [
      { role: 'gnd', dx: 29, dy: 68.5, kind: 'gnd', color: '#334155' },
      { role: 'signal', dx: 39, dy: 68.5, kind: 'signal', color: '#8b5cf6' },
      { role: 'vcc', dx: 49, dy: 68.5, kind: 'vcc', color: '#dc2626' },
    ],
  },
  'photoresistor-sensor': {
    tag: 'kody-photoresistor-sensor',
    cssW: 173.68,
    cssH: 61.48,
    terminals: [
      { role: 'vcc', dx: 172, dy: 16, kind: 'vcc', color: '#dc2626' },
      { role: 'gnd', dx: 172, dy: 26, kind: 'gnd', color: '#334155' },
      { role: 'do', dx: 172, dy: 35.8, kind: 'signal', color: '#0ea5e9' },
      { role: 'signal', dx: 172, dy: 45.5, kind: 'signal', color: '#eab308' },
    ],
  },
  'big-sound-sensor': {
    tag: 'kody-big-sound-sensor',
    cssW: 140.06,
    cssH: 50.44,
    terminals: [
      { role: 'ao', dx: 0, dy: 11, kind: 'signal', color: '#8b5cf6' },
      { role: 'gnd', dx: 0, dy: 20.5, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 0, dy: 30.5, kind: 'vcc', color: '#dc2626' },
      { role: 'do', dx: 0, dy: 40.5, kind: 'signal', color: '#0ea5e9' },
    ],
  },
  'gas-sensor': {
    tag: 'kody-gas-sensor',
    cssW: 136.94,
    cssH: 62.8,
    terminals: [
      { role: 'ao', dx: 137, dy: 16.5, kind: 'signal', color: '#8b5cf6' },
      { role: 'do', dx: 137, dy: 26.4, kind: 'signal', color: '#0ea5e9' },
      { role: 'gnd', dx: 137, dy: 36.5, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 137, dy: 46.2, kind: 'vcc', color: '#dc2626' },
    ],
  },
  'flame-sensor': {
    tag: 'kody-flame-sensor',
    cssW: 199.95,
    cssH: 61.48,
    terminals: [
      { role: 'vcc', dx: 199, dy: 14.6, kind: 'vcc', color: '#dc2626' },
      { role: 'gnd', dx: 199, dy: 24.3, kind: 'gnd', color: '#334155' },
      { role: 'do', dx: 199, dy: 34, kind: 'signal', color: '#0ea5e9' },
      { role: 'ao', dx: 199, dy: 43.7, kind: 'signal', color: '#f97316' },
    ],
  },
  'analog-joystick': {
    tag: 'kody-analog-joystick',
    cssW: 102.8,
    cssH: 120.19,
    terminals: [
      { role: 'vcc', dx: 33, dy: 115.8, kind: 'vcc', color: '#dc2626' },
      { role: 'vrx', dx: 42.6012, dy: 115.8, kind: 'signal', color: '#8b5cf6' },
      { role: 'vry', dx: 52.2024, dy: 115.8, kind: 'signal', color: '#0ea5e9' },
      { role: 'sw', dx: 61.8036, dy: 115.8, kind: 'signal', color: '#f97316' },
      { role: 'gnd', dx: 71.4048, dy: 115.8, kind: 'gnd', color: '#334155' },
    ],
  },
  'ir-receiver': {
    tag: 'kody-ir-receiver',
    cssW: 61.15,
    cssH: 88.75,
    terminals: [
      { role: 'gnd', dx: 20.977, dy: 87.75, kind: 'gnd', color: '#334155' },
      { role: 'vcc', dx: 30.578, dy: 87.75, kind: 'vcc', color: '#dc2626' },
      { role: 'out', dx: 40.18, dy: 87.75, kind: 'signal', color: '#8b5cf6' },
    ],
  },
  'ky-040': {
    tag: 'kody-ky-040',
    cssW: 116.47,
    cssH: 70.41,
    terminals: [
      { role: 'clk', dx: 116, dy: 7.9, kind: 'signal', color: '#8b5cf6' },
      { role: 'dt', dx: 116, dy: 17.4, kind: 'signal', color: '#0ea5e9' },
      { role: 'sw', dx: 116, dy: 27, kind: 'signal', color: '#f97316' },
      { role: 'vcc', dx: 116, dy: 36.3, kind: 'vcc', color: '#dc2626' },
      { role: 'gnd', dx: 116, dy: 45.5, kind: 'gnd', color: '#334155' },
    ],
  },
  'membrane-keypad': {
    tag: 'kody-membrane-keypad',
    cssW: 265.84,
    // `connector` must be passed true (RealisticPart.tsx) — without it the
    // element draws no ribbon/pin strip at all, and these dots (pinInfo,
    // authored against the connector) would float over nothing.
    cssH: 344.02,
    terminals: [
      { role: 'r1', dx: 100, dy: 338, kind: 'signal', color: '#8b5cf6' },
      { role: 'r2', dx: 110, dy: 338, kind: 'signal', color: '#8b5cf6' },
      { role: 'r3', dx: 119.5, dy: 338, kind: 'signal', color: '#8b5cf6' },
      { role: 'r4', dx: 129, dy: 338, kind: 'signal', color: '#8b5cf6' },
      { role: 'c1', dx: 138.5, dy: 338, kind: 'signal', color: '#0ea5e9' },
      { role: 'c2', dx: 148, dy: 338, kind: 'signal', color: '#0ea5e9' },
      { role: 'c3', dx: 157.75, dy: 338, kind: 'signal', color: '#0ea5e9' },
      { role: 'c4', dx: 167.5, dy: 338, kind: 'signal', color: '#0ea5e9' },
    ],
  },
  '7segment': {
    tag: 'kody-7segment',
    cssW: 47.439,
    cssH: 83.16,
    // Pinout of the default single-digit (5611BH) configuration; COM.1/COM.2
    // (the shared cathode/anode pin) aren't modelled as a terminal here —
    // pre-existing simplification, unrelated to this position fix.
    terminals: [
      { role: 'a', dx: 33.32, dy: 3.78, kind: 'signal', color: '#ef4444' },
      { role: 'b', dx: 42.92, dy: 3.78, kind: 'signal', color: '#ef4444' },
      { role: 'c', dx: 33.32, dy: 71.82, kind: 'signal', color: '#ef4444' },
      { role: 'd', dx: 14.12, dy: 71.82, kind: 'signal', color: '#ef4444' },
      { role: 'e', dx: 4.52, dy: 71.82, kind: 'signal', color: '#ef4444' },
      { role: 'f', dx: 14.12, dy: 3.78, kind: 'signal', color: '#ef4444' },
      { role: 'g', dx: 4.52, dy: 3.78, kind: 'signal', color: '#ef4444' },
      { role: 'dp', dx: 42.92, dy: 71.82, kind: 'signal', color: '#ef4444' },
    ],
  },
  'stepper-motor': {
    tag: 'kody-stepper-motor',
    cssW: 220.374,
    cssH: 235.494,
    terminals: [
      // in1-in4 map to the motor's own A-/A+/B+/B- coil leads (left→right) —
      // this sim skips the ULN2003/L298N driver board real hardware needs
      // between Arduino and these leads; pre-existing simplification.
      { role: 'in1', dx: 95.122, dy: 235.494, kind: 'signal', color: '#0ea5e9' },
      { role: 'in2', dx: 104.723, dy: 235.494, kind: 'signal', color: '#0ea5e9' },
      { role: 'in3', dx: 114.324, dy: 235.494, kind: 'signal', color: '#0ea5e9' },
      { role: 'in4', dx: 123.926, dy: 235.494, kind: 'signal', color: '#0ea5e9' },
      // The real 4-wire bipolar motor has no separate vcc/gnd (power comes
      // through the driver board on the same 4 leads) — this sim still
      // models one, so place it away from the real leads, at the frame's
      // top corners, rather than guess a "real" position that doesn't exist.
      { role: 'vcc', dx: 20, dy: 12, kind: 'vcc', color: '#dc2626' },
      { role: 'gnd', dx: 40, dy: 12, kind: 'gnd', color: '#334155' },
    ],
  },
}
