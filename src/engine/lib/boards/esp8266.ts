// ============================================================
// KodyUno — NodeMCU ESP8266 V3
//
// The ESP8266 core numbers pins by GPIO but every NodeMCU silkscreen uses
// the D0…D8 labels, so both are exposed: the pin id is the GPIO number and
// `aliases` maps D0…D8 onto it, exactly like the Arduino core does.
// ============================================================
import type { BoardDef, BoardPin, PinSpec } from './types'
import { layoutDevkit } from './types'

const gpio = (n: number, label: string, extra: Partial<PinSpec> = {}): PinSpec => ({
  id: n,
  label,
  kind: 'gpio',
  pwm: true,
  ...extra,
})
const gnd = (suffix = ''): PinSpec => ({ id: `GND${suffix}`, label: 'GND', kind: 'gnd' })
const v33 = (suffix = ''): PinSpec => ({ id: `3V3${suffix}`, label: '3V3', kind: 'power', volts: 3.3 })
const reserved = (id: string, label: string): PinSpec => ({ id, label, kind: 'special', connectable: false })

const BOOT = 'Ikut menentukan mode boot — jangan ditarik ke level tertentu saat reset.'

const NODEMCU = layoutDevkit({
  cssW: 92,
  topInset: 46,
  bottomInset: 26,
  left: [
    { id: 'A0', label: 'A0', kind: 'analog', adc: 'A0' },
    reserved('RSV', 'RSV'),
    reserved('RSV2', 'RSV'),
    gpio(10, 'SD3'),
    gpio(9, 'SD2'),
    reserved('SD1', 'SD1'),
    reserved('CMD', 'CMD'),
    reserved('SD0', 'SD0'),
    reserved('CLK', 'CLK'),
    gnd(),
    v33(),
    reserved('EN', 'EN'),
    reserved('RST', 'RST'),
    gnd('2'),
    { id: 'VIN', label: 'VIN', kind: 'power' },
  ],
  right: [
    gpio(16, 'D0', { note: 'Deep-sleep wake; PWM software tersedia, interrupt GPIO tidak tersedia.' }),
    gpio(5, 'D1'),
    gpio(4, 'D2'),
    gpio(0, 'D3', { note: BOOT }),
    gpio(2, 'D4', { note: `${BOOT} Terhubung ke LED onboard (aktif LOW).` }),
    v33('2'),
    gnd('3'),
    gpio(14, 'D5'),
    gpio(12, 'D6'),
    gpio(13, 'D7'),
    gpio(15, 'D8', { note: BOOT }),
    gpio(3, 'RX'),
    gpio(1, 'TX'),
    gnd('4'),
    v33('3'),
  ],
})

const NODEMCU_ALIASES: Record<string, number | string> = {
  LED_BUILTIN: 2,
  BUILTIN_LED: 2,
  A0: 'A0',
  D0: 16,
  D1: 5,
  D2: 4,
  D3: 0,
  D4: 2,
  D5: 14,
  D6: 12,
  D7: 13,
  D8: 15,
  D9: 3,
  D10: 1,
}

export const NODEMCU_PINS: BoardPin[] = NODEMCU.pins

export const ESP8266_NODEMCU: BoardDef = {
  id: 'esp8266',
  name: 'LoLin NodeMCU V3 ESP8266',
  shortName: 'ESP8266',
  vendor: 'Espressif',
  mcu: 'ESP8266EX',
  arch: 'xtensa',
  family: 'esp8266',
  logicVolts: 3.3,
  adcBits: 10,
  pwmBits: 8,
  cpuMHz: 80,
  flashKB: 4096,
  ramKB: 80,
  hasWiFi: true,
  hasBLE: false,
  builtinLed: 2,
  builtinLedActiveLow: true,
  artwork: {
    kind: 'generic',
    cssW: 92,
    cssH: NODEMCU.cssH,
    theme: {
      pcb: '#0b3d2e',
      silk: '#f0fdf4',
      shield: '#cbd5e1',
      moduleLabel: 'ESP-12E',
      subLabel: 'KODYUNO NODEMCU',
      usb: 'micro',
      usbCount: 1,
      buttons: ['FLASH', 'RST'],
    },
  },
  pins: NODEMCU.pins,
  aliases: NODEMCU_ALIASES,
  blurb: 'LoLin V3 / CH340, logika 3.3V, ADC A0 10-bit. PWM software default 8-bit mengikuti Arduino ESP8266 core 3.x.',
}
