// ============================================================
// KodyUno — ESP32 family boards
//
// ESP32 DevKit V1 reuses the vendored KodyUno element artwork, so its
// header coordinates are lifted straight from that drawing. The S2 / S3 /
// C3 / C6 devkits are drawn by KodyUno's own generic devkit renderer, so
// their headers are laid out here on a 2.54mm grid.
//
// Pin capabilities (ADC channel, touch, DAC, input-only, strapping) follow
// the Espressif datasheets and the arduino-esp32 variant headers.
// ============================================================
import type { BoardDef, BoardPin, PinSpec } from './types'
import { layoutDevkit } from './types'

// ------------------------------------------------------------
// Shorthand pin builders
// ------------------------------------------------------------

/** A general purpose ESP GPIO. Every output-capable ESP GPIO can do LEDC PWM. */
const gpio = (n: number, extra: Partial<PinSpec> = {}): PinSpec => ({
  id: n,
  label: String(n),
  kind: 'gpio',
  pwm: !extra.inputOnly,
  ...extra,
})
const gnd = (suffix = ''): PinSpec => ({ id: `GND${suffix}`, label: 'GND', kind: 'gnd' })
const v33 = (suffix = ''): PinSpec => ({ id: `3V3${suffix}`, label: '3V3', kind: 'power', volts: 3.3 })
const v5 = (suffix = ''): PinSpec => ({ id: `5V${suffix}`, label: '5V', kind: 'power', volts: 5 })
const rst: PinSpec = { id: 'EN', label: 'RST', kind: 'special', connectable: false }

const STRAP = 'Strapping pin — hindari menahan level saat boot.'

// ------------------------------------------------------------
// ESP32 DevKit V1 (30 pin DOIT) — element artwork
// ------------------------------------------------------------

const DEVKIT_L = 5
const DEVKIT_R = 101.3

const ESP32_PINS: BoardPin[] = [
  { id: 'VIN', label: 'VIN', x: DEVKIT_L, y: 158.5, kind: 'power', connectable: true },
  { id: 'GND2', label: 'GND', x: DEVKIT_L, y: 149, kind: 'gnd', connectable: true },
  { id: 13, label: 'D13', x: DEVKIT_L, y: 139.5, kind: 'gpio', connectable: true, pwm: true, adc: 'A14', touch: true },
  { id: 12, label: 'D12', x: DEVKIT_L, y: 130.4, kind: 'gpio', connectable: true, pwm: true, adc: 'A15', touch: true, note: STRAP },
  { id: 14, label: 'D14', x: DEVKIT_L, y: 120, kind: 'gpio', connectable: true, pwm: true, adc: 'A16', touch: true },
  { id: 27, label: 'D27', x: DEVKIT_L, y: 110.8, kind: 'gpio', connectable: true, pwm: true, adc: 'A17', touch: true },
  { id: 26, label: 'D26', x: DEVKIT_L, y: 101, kind: 'gpio', connectable: true, pwm: true, adc: 'A19', dac: true },
  { id: 25, label: 'D25', x: DEVKIT_L, y: 91.3, kind: 'gpio', connectable: true, pwm: true, adc: 'A18', dac: true },
  { id: 33, label: 'D33', x: DEVKIT_L, y: 81.7, kind: 'gpio', connectable: true, pwm: true, adc: 'A5', touch: true },
  { id: 32, label: 'D32', x: DEVKIT_L, y: 72.2, kind: 'gpio', connectable: true, pwm: true, adc: 'A4', touch: true },
  { id: 35, label: 'D35', x: DEVKIT_L, y: 62.9, kind: 'gpio', connectable: true, adc: 'A7', inputOnly: true },
  { id: 34, label: 'D34', x: DEVKIT_L, y: 53.1, kind: 'gpio', connectable: true, adc: 'A6', inputOnly: true },
  { id: 39, label: 'VN', x: DEVKIT_L, y: 44, kind: 'gpio', connectable: true, adc: 'A3', inputOnly: true },
  { id: 36, label: 'VP', x: DEVKIT_L, y: 34, kind: 'gpio', connectable: true, adc: 'A0', inputOnly: true },
  { id: 'EN', label: 'EN', x: DEVKIT_L, y: 24, kind: 'special', connectable: false },

  { id: '3V3', label: '3V3', x: DEVKIT_R, y: 158.5, kind: 'power', connectable: true, volts: 3.3 },
  { id: 'GND', label: 'GND', x: DEVKIT_R, y: 149, kind: 'gnd', connectable: true },
  { id: 15, label: 'D15', x: DEVKIT_R, y: 139.5, kind: 'gpio', connectable: true, pwm: true, adc: 'A13', touch: true, note: STRAP },
  { id: 2, label: 'D2', x: DEVKIT_R, y: 130.4, kind: 'gpio', connectable: true, pwm: true, adc: 'A12', touch: true, note: STRAP },
  { id: 4, label: 'D4', x: DEVKIT_R, y: 120, kind: 'gpio', connectable: true, pwm: true, adc: 'A10', touch: true },
  { id: 16, label: 'RX2', x: DEVKIT_R, y: 110.8, kind: 'gpio', connectable: true, pwm: true },
  { id: 17, label: 'TX2', x: DEVKIT_R, y: 101, kind: 'gpio', connectable: true, pwm: true },
  { id: 5, label: 'D5', x: DEVKIT_R, y: 91.3, kind: 'gpio', connectable: true, pwm: true, note: STRAP },
  { id: 18, label: 'D18', x: DEVKIT_R, y: 81.7, kind: 'gpio', connectable: true, pwm: true },
  { id: 19, label: 'D19', x: DEVKIT_R, y: 72.2, kind: 'gpio', connectable: true, pwm: true },
  { id: 21, label: 'D21', x: DEVKIT_R, y: 62.9, kind: 'gpio', connectable: true, pwm: true },
  { id: 3, label: 'RX0', x: DEVKIT_R, y: 53.1, kind: 'gpio', connectable: true, pwm: true },
  { id: 1, label: 'TX0', x: DEVKIT_R, y: 44, kind: 'gpio', connectable: true, pwm: true },
  { id: 22, label: 'D22', x: DEVKIT_R, y: 34, kind: 'gpio', connectable: true, pwm: true },
  { id: 23, label: 'D23', x: DEVKIT_R, y: 24, kind: 'gpio', connectable: true, pwm: true },
]

// ------------------------------------------------------------
// ESP32-S3-DevKitC-1 — 2×22, KodyUno artwork
// ------------------------------------------------------------

const s3Adc = (n: number): string | undefined => (n >= 1 && n <= 20 ? `A${n - 1}` : undefined)
const s3 = (n: number, extra: Partial<PinSpec> = {}): PinSpec =>
  gpio(n, { adc: s3Adc(n), touch: n >= 1 && n <= 14, ...extra })

const S3_LAYOUT = layoutDevkit({
  cssW: 96,
  topInset: 40,
  bottomInset: 30,
  left: [
    v33(), v33('2'), rst,
    s3(4), s3(5), s3(6), s3(7), s3(15), s3(16), s3(17), s3(18),
    s3(8), s3(3, { note: STRAP }), s3(46, { note: STRAP }),
    s3(9), s3(10), s3(11), s3(12), s3(13), s3(14),
    v5(), gnd(),
  ],
  right: [
    gnd('2'), gnd('3'),
    s3(43, { label: 'TX' }), s3(44, { label: 'RX' }),
    s3(1), s3(2), s3(42), s3(41), s3(40), s3(39), s3(38), s3(37), s3(36), s3(35),
    s3(0, { note: STRAP }), s3(45, { note: STRAP }), s3(48), s3(47),
    s3(21), s3(20), s3(19),
    gnd('4'),
  ],
})

// ------------------------------------------------------------
// ESP32-S2-DevKitM-1 — 2×22, KodyUno artwork
// ------------------------------------------------------------

const s2 = (n: number, extra: Partial<PinSpec> = {}): PinSpec =>
  gpio(n, { adc: s3Adc(n), touch: n >= 1 && n <= 14, ...extra })

const S2_LAYOUT = layoutDevkit({
  cssW: 96,
  topInset: 40,
  bottomInset: 30,
  left: [
    v33(), v33('2'), rst,
    s2(4), s2(5), s2(6), s2(7), s2(15), s2(16), s2(17, { dac: true }), s2(18, { dac: true }),
    s2(8), s2(3), s2(46, { inputOnly: true, note: STRAP }),
    s2(9), s2(10), s2(11), s2(12), s2(13), s2(14),
    v5(), gnd(),
  ],
  right: [
    gnd('2'), gnd('3'),
    s2(43, { label: 'TX' }), s2(44, { label: 'RX' }),
    s2(1), s2(2), s2(42), s2(41), s2(40), s2(39), s2(38), s2(37), s2(36), s2(35),
    s2(0, { note: STRAP }), s2(45, { note: STRAP }), s2(34), s2(33),
    s2(21), s2(20), s2(19),
    gnd('4'),
  ],
})

// ------------------------------------------------------------
// ESP32-C3-DevKitM-1 — 2×15, KodyUno artwork
// ------------------------------------------------------------

const c3 = (n: number, extra: Partial<PinSpec> = {}): PinSpec =>
  gpio(n, { adc: n <= 4 ? `A${n}` : undefined, ...extra })

const C3_LAYOUT = layoutDevkit({
  cssW: 96,
  topInset: 40,
  bottomInset: 30,
  left: [
    gnd(), v33(), v33('2'),
    c3(2, { note: STRAP }), c3(3), c3(10),
    c3(16, { label: 'RX' }), c3(17, { label: 'TX' }),
    gnd('2'),
    c3(0), c3(1), c3(8, { note: STRAP }), c3(9, { note: STRAP }),
    v5(), gnd('3'),
  ],
  right: [
    gnd('4'), c3(4), c3(5), c3(6), c3(7),
    c3(18), c3(19), gnd('5'),
    c3(20, { label: 'RX0' }), c3(21, { label: 'TX0' }),
    c3(11), c3(12), c3(13),
    v5('2'), gnd('6'),
  ],
})

// ------------------------------------------------------------
// ESP32-C6-DevKitC-1 — 2×15, KodyUno artwork
// ------------------------------------------------------------

const c6 = (n: number, extra: Partial<PinSpec> = {}): PinSpec =>
  gpio(n, { adc: n <= 6 ? `A${n}` : undefined, ...extra })

const C6_LAYOUT = layoutDevkit({
  cssW: 96,
  topInset: 40,
  bottomInset: 30,
  left: [
    gnd(), v33(), v33('2'),
    c6(3), c6(2), c6(1), c6(0),
    gnd('2'),
    c6(15), c6(23), c6(22), c6(21), c6(20),
    v5(), gnd('3'),
  ],
  right: [
    gnd('4'), c6(4), c6(5), c6(6), c6(7),
    c6(8, { note: STRAP }), c6(9, { note: STRAP }),
    gnd('5'),
    c6(16, { label: 'TX' }), c6(17, { label: 'RX' }),
    c6(18), c6(19), c6(11),
    v5('2'), gnd('6'),
  ],
})

// ------------------------------------------------------------
// Board definitions
// ------------------------------------------------------------

/** LED_BUILTIN plus every A-channel alias declared on the pin table. */
function espAliases(pins: BoardPin[], led: number): Record<string, number | string> {
  const aliases: Record<string, number | string> = { LED_BUILTIN: led, BUILTIN_LED: led }
  for (const pin of pins) {
    if (pin.adc) aliases[pin.adc] = pin.id
    if (pin.touch && typeof pin.id === 'number') aliases[`T${pin.id}`] = pin.id
  }
  return aliases
}

export const ESP32_DEVKIT_V1: BoardDef = {
  id: 'esp32',
  name: 'ESP32 DevKit V1',
  shortName: 'ESP32',
  vendor: 'Espressif',
  mcu: 'ESP32-WROOM-32',
  arch: 'xtensa',
  family: 'esp32',
  logicVolts: 3.3,
  adcBits: 12,
  pwmBits: 8,
  cpuMHz: 240,
  flashKB: 4096,
  ramKB: 520,
  hasWiFi: true,
  hasBLE: true,
  builtinLed: 2,
  artwork: { kind: 'element', tag: 'kody-esp32-devkit-v1', cssW: 106.58, cssH: 204.32 },
  pins: ESP32_PINS,
  aliases: espAliases(ESP32_PINS, 2),
  blurb: 'Dual-core 240MHz dengan WiFi dan Bluetooth. Logika 3.3V, ADC 12-bit.',
}

export const ESP32_S3: BoardDef = {
  id: 'esp32-s3',
  name: 'ESP32-S3 DevKitC-1',
  shortName: 'ESP32-S3',
  vendor: 'Espressif',
  mcu: 'ESP32-S3-WROOM-1',
  arch: 'xtensa',
  family: 'esp32',
  logicVolts: 3.3,
  adcBits: 12,
  pwmBits: 8,
  cpuMHz: 240,
  flashKB: 8192,
  ramKB: 512,
  hasWiFi: true,
  hasBLE: true,
  builtinLed: 48,
  artwork: {
    kind: 'generic',
    cssW: 96,
    cssH: S3_LAYOUT.cssH,
    theme: {
      pcb: '#1f2937',
      silk: '#e5e7eb',
      shield: '#c7cbd1',
      moduleLabel: 'ESP32-S3-WROOM-1',
      subLabel: 'KODYUNO S3',
      usb: 'usb-c',
      usbCount: 2,
      buttons: ['BOOT', 'RST'],
    },
  },
  pins: S3_LAYOUT.pins,
  aliases: espAliases(S3_LAYOUT.pins, 48),
  blurb: 'Penerus ESP32 dengan USB OTG, 45 GPIO, dan LED RGB internal di GPIO48.',
}

export const ESP32_S2: BoardDef = {
  id: 'esp32-s2',
  name: 'ESP32-S2 DevKitM-1',
  shortName: 'ESP32-S2',
  vendor: 'Espressif',
  mcu: 'ESP32-S2-MINI-1',
  arch: 'xtensa',
  family: 'esp32',
  logicVolts: 3.3,
  adcBits: 13,
  pwmBits: 8,
  cpuMHz: 240,
  flashKB: 4096,
  ramKB: 320,
  hasWiFi: true,
  hasBLE: false,
  builtinLed: 15,
  artwork: {
    kind: 'generic',
    cssW: 96,
    cssH: S2_LAYOUT.cssH,
    theme: {
      pcb: '#164e63',
      silk: '#ecfeff',
      shield: '#cbd5e1',
      moduleLabel: 'ESP32-S2-MINI-1',
      subLabel: 'KODYUNO S2',
      usb: 'micro',
      usbCount: 2,
      buttons: ['BOOT', 'RST'],
    },
  },
  pins: S2_LAYOUT.pins,
  aliases: espAliases(S2_LAYOUT.pins, 15),
  blurb: 'Single-core dengan WiFi saja (tanpa Bluetooth) plus dua DAC di GPIO17 dan 18.',
}

export const ESP32_C3: BoardDef = {
  id: 'esp32-c3',
  name: 'ESP32-C3 DevKitM-1',
  shortName: 'ESP32-C3',
  vendor: 'Espressif',
  mcu: 'ESP32-C3-MINI-1',
  arch: 'riscv',
  family: 'esp32',
  logicVolts: 3.3,
  adcBits: 12,
  pwmBits: 8,
  cpuMHz: 160,
  flashKB: 4096,
  ramKB: 400,
  hasWiFi: true,
  hasBLE: true,
  builtinLed: 8,
  artwork: {
    kind: 'generic',
    cssW: 96,
    cssH: C3_LAYOUT.cssH,
    theme: {
      pcb: '#3f2d5c',
      silk: '#f5f3ff',
      shield: '#d1d5db',
      moduleLabel: 'ESP32-C3-MINI-1',
      subLabel: 'KODYUNO C3',
      usb: 'micro',
      usbCount: 1,
      buttons: ['BOOT', 'RST'],
    },
  },
  pins: C3_LAYOUT.pins,
  aliases: espAliases(C3_LAYOUT.pins, 8),
  blurb: 'RISC-V single-core, murah dan hemat daya. LED RGB internal di GPIO8.',
}

export const ESP32_C6: BoardDef = {
  id: 'esp32-c6',
  name: 'ESP32-C6 DevKitC-1',
  shortName: 'ESP32-C6',
  vendor: 'Espressif',
  mcu: 'ESP32-C6-WROOM-1',
  arch: 'riscv',
  family: 'esp32',
  logicVolts: 3.3,
  adcBits: 12,
  pwmBits: 8,
  cpuMHz: 160,
  flashKB: 8192,
  ramKB: 512,
  hasWiFi: true,
  hasBLE: true,
  builtinLed: 8,
  artwork: {
    kind: 'generic',
    cssW: 96,
    cssH: C6_LAYOUT.cssH,
    theme: {
      pcb: '#134e3a',
      silk: '#ecfdf5',
      shield: '#d1d5db',
      moduleLabel: 'ESP32-C6-WROOM-1',
      subLabel: 'KODYUNO C6',
      usb: 'usb-c',
      usbCount: 2,
      buttons: ['BOOT', 'RST'],
    },
  },
  pins: C6_LAYOUT.pins,
  aliases: espAliases(C6_LAYOUT.pins, 8),
  blurb: 'WiFi 6, Thread, dan Zigbee dalam satu chip RISC-V. Cocok untuk proyek IoT baru.',
}
