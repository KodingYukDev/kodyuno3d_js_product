// Multi-file sketches, as in Wokwi: sketch.ino plus headers/sources, and a
// libraries.txt that names the Arduino libraries the sketch needs. The compile
// server takes the .ino/.h/.hpp/.c/.cpp/.S files; libraries.txt stays in the
// browser and is checked against what the compiler image has installed, so a
// missing library is reported before a compile is spent on it.

export const MAIN_FILE = 'sketch.ino'
export const LIBRARIES_FILE = 'libraries.txt'
export const MAX_EXTRA_FILES = 15

/** Same rule as the compile server (services/kodyuno-compiler/server.py). */
const SOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,47}\.(h|hpp|c|cpp|S)$/
const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 10 }, (_, i) => `COM${i}`), ...Array.from({ length: 10 }, (_, i) => `LPT${i}`)])

export type FileNameCheck = { ok: true } | { ok: false; reason: string }

export function checkFileName(name: string, existing: Iterable<string>): FileNameCheck {
  if (name === LIBRARIES_FILE) return Array.from(existing).includes(name) ? { ok: false, reason: 'Nama berkas sudah dipakai.' } : { ok: true }
  if (!SOURCE_NAME.test(name)) return { ok: false, reason: 'Nama berkas: huruf di awal, lalu huruf/angka/_/-, berakhiran .h .hpp .c .cpp atau .S.' }
  if (RESERVED.has(name.split('.')[0].toUpperCase())) return { ok: false, reason: 'Nama itu dicadangkan sistem.' }
  const folded = name.toLowerCase()
  if (folded === MAIN_FILE || Array.from(existing).some(other => other.toLowerCase() === folded)) return { ok: false, reason: 'Nama berkas sudah dipakai.' }
  return { ok: true }
}

/** The files that go to the compile server. libraries.txt never does. */
export function compileFiles(sketchCode: string, extraFiles: Record<string, string>): Record<string, string> {
  const files: Record<string, string> = { [MAIN_FILE]: sketchCode }
  for (const [name, content] of Object.entries(extraFiles)) if (name !== LIBRARIES_FILE) files[name] = content
  return files
}

/** Library names installed in the compiler image (Dockerfile.isolated) plus the cores' bundled ones. */
export const INSTALLED_LIBRARIES: readonly string[] = [
  'Servo', 'LiquidCrystal', 'LiquidCrystal I2C', 'Stepper', 'Keypad', 'DHT sensor library', 'Adafruit Unified Sensor',
  'Adafruit NeoPixel', 'Adafruit GFX Library', 'Adafruit BusIO', 'Adafruit SSD1306', 'Adafruit ILI9341', 'MFRC522', 'SD',
  'OneWire', 'DallasTemperature', 'RTClib', 'NewPing', 'HX711 Arduino Library', 'LedControl', 'MPU6050_light', 'MPU6050',
  'IRremote', 'TM1637', 'AccelStepper', 'Encoder', 'Adafruit MPU6050', 'Adafruit NeoMatrix', 'SevSeg',
  'PulseSensor Playground', 'Bounce2', 'ezButton', 'U8g2', 'DS3231',
  'EEPROM', 'Wire', 'SPI', 'SoftwareSerial', 'avr-libc',
]

const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
const INSTALLED = new Set(INSTALLED_LIBRARIES.map(normalize))

/** One library per line; `#` starts a comment; `Name@1.2.3` pins a version (the image's version is used). */
export function parseLibrariesTxt(text: string): string[] {
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    names.push(line.replace(/@[^@\s]*$/, '').trim())
  }
  return names
}

export function missingLibraries(text: string): string[] {
  return parseLibrariesTxt(text).filter(name => !INSTALLED.has(normalize(name)))
}

/** Whole-project guard used when opening files from disk, a share link or autosave. */
export function validateExtraFiles(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Berkas tambahan tidak valid.')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_EXTRA_FILES + 1) throw new Error('Terlalu banyak berkas.')
  const result: Record<string, string> = {}
  const seen: string[] = []
  for (const [name, content] of entries) {
    if (typeof content !== 'string' || content.length > 64_000 || content.includes('\u0000')) throw new Error('Isi berkas tidak valid.')
    const check = checkFileName(name, seen)
    if (!check.ok) throw new Error(check.reason)
    seen.push(name)
    result[name] = content
  }
  return result
}
