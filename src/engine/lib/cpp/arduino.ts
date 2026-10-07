// ============================================================
// KodyUno — Arduino core library
//
// Installs the globals a sketch expects: HIGH/LOW, pinMode(), Serial, the
// math helpers, and the ESP-only extras (ledc*, dacWrite, touchRead, ESP).
// Everything routes through the Hardware bridge, so the same core works
// against the canvas simulator or a headless test board.
// ============================================================
import { CArray, CFloat, CObject, printFloat, printText, toBool, toDisplayString, toNumber, type Value } from './values'
import type { Interpreter } from './runtime'
import type { PinMode } from './hardware'

const DEC = 10
const HEX = 16
const OCT = 8
const BIN = 2

const num = (args: Value[], index: number, fallback = 0): number => {
  const value = args[index]
  return value === undefined ? fallback : toNumber(value)
}
const int = (args: Value[], index: number, fallback = 0): number => Math.trunc(num(args, index, fallback))

/** Format a value the way Serial.print does, honouring the optional base. */
function formatPrint(value: Value, base: Value | undefined): string {
  if (base === undefined) return printText(value)
  const radix = Math.trunc(toNumber(base))
  if (value instanceof CFloat || (typeof value === 'number' && !Number.isInteger(value))) {
    // Serial.print(float, digits) — the second argument is a digit count
    return printFloat(toNumber(value), Math.max(0, radix))
  }
  const rounded = Math.trunc(toNumber(value))
  if (radix === DEC || radix < 2) return String(rounded)
  const unsigned = rounded < 0 ? rounded >>> 0 : rounded
  return unsigned.toString(radix).toUpperCase()
}

/** Emulate printf for the handful of specifiers sketches actually use. */
function formatPrintf(template: string, args: Value[]): string {
  let index = 0
  return template.replace(
    /%([-+ 0#]*)(\d+)?(?:\.(\d+))?([dioxXufFeEgGcsl%])/g,
    (match, flags: string, widthText: string | undefined, precisionText: string | undefined, spec: string) => {
      if (spec === '%') return '%'
      const value = args[index++]
      const width = widthText ? parseInt(widthText, 10) : 0
      const precision = precisionText ? parseInt(precisionText, 10) : undefined
      let out: string
      switch (spec) {
        case 'd':
        case 'i':
          out = String(Math.trunc(toNumber(value)))
          break
        case 'u':
          out = String(Math.trunc(toNumber(value)) >>> 0)
          break
        case 'o':
          out = (Math.trunc(toNumber(value)) >>> 0).toString(8)
          break
        case 'x':
          out = (Math.trunc(toNumber(value)) >>> 0).toString(16)
          break
        case 'X':
          out = (Math.trunc(toNumber(value)) >>> 0).toString(16).toUpperCase()
          break
        case 'f':
        case 'F':
          out = toNumber(value).toFixed(precision ?? 6)
          break
        case 'e':
        case 'E':
          out = toNumber(value).toExponential(precision ?? 6)
          break
        case 'g':
        case 'G':
          out = String(toNumber(value))
          break
        case 'c':
          out = String.fromCharCode(Math.trunc(toNumber(value)))
          break
        case 's':
          out = toDisplayString(value)
          break
        default:
          return match
      }
      if (width > out.length) {
        const pad = flags.includes('0') && !flags.includes('-') ? '0' : ' '
        out = flags.includes('-') ? out.padEnd(width, ' ') : out.padStart(width, pad)
      }
      return out
    },
  )
}

/** A Serial-like port. UART0 is the one wired to the serial monitor. */
function makeSerialPort(interpreter: Interpreter, label: string, isMonitor: boolean): CObject {
  const hardware = interpreter.hardware
  let timeoutMs = 1000

  const emit = (text: string) => {
    if (isMonitor) interpreter.print(text)
    else interpreter.print(`[${label}] ${text}`)
  }

  const port = new CObject(label, {}, {
    begin: (args) => {
      const baud = int(args, 0, 9600)
      if (isMonitor) {
        hardware.serialBaud?.(baud)
        interpreter.warn(`${label} dimulai pada ${baud} baud`, true)
      }
      return null
    },
    end: () => null,
    print: (args) => {
      const text = formatPrint(args[0], args[1])
      emit(text)
      return text.length
    },
    println: (args) => {
      const text = args.length === 0 ? '' : formatPrint(args[0], args[1])
      emit(`${text}\n`)
      return text.length + 1
    },
    printf: (args) => {
      const text = formatPrintf(toDisplayString(args[0]), args.slice(1))
      emit(text)
      return text.length
    },
    write: (args) => {
      const value = args[0]
      if (value instanceof CArray) {
        emit(value.elements.map((item) => String.fromCharCode(Math.trunc(toNumber(item)))).join(''))
        return value.length
      }
      if (typeof value === 'string') {
        emit(value)
        return value.length
      }
      emit(String.fromCharCode(Math.trunc(toNumber(value))))
      return 1
    },
    flush: () => null,
    available: () => (isMonitor ? hardware.serialAvailable() : 0),
    availableForWrite: () => 64,
    read: () => (isMonitor ? hardware.serialRead() : -1),
    peek: () => (isMonitor ? hardware.serialPeek() : -1),
    readString: () => (isMonitor ? hardware.serialReadAll() : ''),
    readStringUntil: (args) => {
      if (!isMonitor) return ''
      const terminator = String.fromCharCode(int(args, 0, 10))
      let out = ''
      while (hardware.serialAvailable() > 0) {
        const code = hardware.serialRead()
        if (code < 0) break
        const char = String.fromCharCode(code)
        if (char === terminator) break
        out += char
      }
      return out
    },
    parseInt: () => (isMonitor ? Math.trunc(parseFloat(hardware.serialReadAll())) || 0 : 0),
    parseFloat: () => (isMonitor ? parseFloat(hardware.serialReadAll()) || 0 : 0),
    setTimeout: (args) => {
      timeoutMs = int(args, 0, 1000)
      return null
    },
    getTimeout: () => timeoutMs,
  })
  return port
}

export function installArduinoCore(interpreter: Interpreter) {
  const hardware = interpreter.hardware
  const board = hardware.board

  // ---------- constants ----------
  const constants: Record<string, number | boolean | string> = {
    HIGH: 1, LOW: 0,
    INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3, OUTPUT_OPEN_DRAIN: 4,
    true: true, false: false,
    PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI,
    EULER: Math.E,
    DEC, HEX, OCT, BIN,
    LSBFIRST: 0, MSBFIRST: 1,
    CHANGE: 1, FALLING: 2, RISING: 3,
    NULL: 0, nullptr: 0,
    SERIAL_8N1: 0x800001c,
  }
  for (const [name, value] of Object.entries(constants)) interpreter.defineGlobal(name, value)
  // interrupt modes are compared by name so attachInterrupt can read them back
  interpreter.defineGlobal('__MODE_CHANGE', 'CHANGE')

  for (const [alias, pin] of Object.entries(board.aliases)) {
    interpreter.defineGlobal(alias, pin as Value)
  }

  // ---------- pin IO ----------
  const modeName = (value: number): PinMode => {
    switch (Math.trunc(value)) {
      case 1: return 'OUTPUT'
      case 2: return 'INPUT_PULLUP'
      case 4: return 'OUTPUT_OPEN_DRAIN'
      default: return 'INPUT'
    }
  }
  const pinOf = (args: Value[], index = 0): number | string => {
    const raw = args[index]
    return hardware.resolvePin(typeof raw === 'string' ? raw : Math.trunc(toNumber(raw)))
  }

  interpreter.defineNative('pinMode', (args) => {
    hardware.pinMode(pinOf(args), modeName(num(args, 1)))
    return null
  })
  interpreter.defineNative('digitalWrite', (args) => {
    hardware.digitalWrite(pinOf(args), toBool(args[1]) ? 1 : 0)
    return null
  })
  interpreter.defineNative('digitalRead', (args) => hardware.digitalRead(pinOf(args)))
  interpreter.defineNative('analogRead', (args) => hardware.analogRead(pinOf(args)))
  interpreter.defineNative('analogWrite', (args) => {
    hardware.analogWrite(pinOf(args), int(args, 1))
    return null
  })
  interpreter.defineNative('analogReadResolution', () => null)
  interpreter.defineNative('analogWriteResolution', () => null)
  interpreter.defineNative('analogSetAttenuation', () => null)
  interpreter.defineNative('dacWrite', (args) => {
    hardware.dacWrite(pinOf(args), int(args, 1))
    return null
  })
  interpreter.defineNative('touchRead', (args) => hardware.touchRead(pinOf(args)))

  // ---------- timing ----------
  interpreter.defineNative('delay', async (args) => {
    await interpreter.delay(num(args, 0))
    return null
  })
  interpreter.defineNative('delayMicroseconds', async (args) => {
    await interpreter.delayMicroseconds(num(args, 0))
    return null
  })
  interpreter.defineNative('millis', () => interpreter.millis())
  interpreter.defineNative('micros', () => interpreter.micros())
  interpreter.defineNative('yield', async () => {
    await interpreter.delay(0)
    return null
  })
  interpreter.defineNative('noInterrupts', () => null)
  interpreter.defineNative('interrupts', () => null)

  // ---------- sound ----------
  interpreter.defineNative('tone', (args) => {
    hardware.tone(pinOf(args), int(args, 1), args.length > 2 ? int(args, 2) : undefined)
    return null
  })
  interpreter.defineNative('noTone', (args) => {
    hardware.noTone(pinOf(args))
    return null
  })

  // ---------- measurement ----------
  interpreter.defineNative('pulseIn', (args) => hardware.pulseIn(pinOf(args), int(args, 1, 1), int(args, 2, 1_000_000)))
  interpreter.defineNative('pulseInLong', (args) => hardware.pulseIn(pinOf(args), int(args, 1, 1), int(args, 2, 1_000_000)))

  interpreter.defineNative('shiftOut', (args) => {
    const dataPin = pinOf(args, 0)
    const clockPin = pinOf(args, 1)
    const msbFirst = int(args, 2) === 1
    const value = int(args, 3)
    for (let i = 0; i < 8; i++) {
      const bit = msbFirst ? (value >> (7 - i)) & 1 : (value >> i) & 1
      hardware.digitalWrite(dataPin, bit as 0 | 1)
      hardware.digitalWrite(clockPin, 1)
      hardware.digitalWrite(clockPin, 0)
    }
    return null
  })
  interpreter.defineNative('shiftIn', (args) => {
    const dataPin = pinOf(args, 0)
    const clockPin = pinOf(args, 1)
    const msbFirst = int(args, 2) === 1
    let value = 0
    for (let i = 0; i < 8; i++) {
      hardware.digitalWrite(clockPin, 1)
      const bit = hardware.digitalRead(dataPin) & 1
      value |= msbFirst ? bit << (7 - i) : bit << i
      hardware.digitalWrite(clockPin, 0)
    }
    return value
  })

  // ---------- interrupts ----------
  const MODE_NAMES: Record<number, string> = { 1: 'CHANGE', 2: 'FALLING', 3: 'RISING', 0: 'LOW' }
  interpreter.defineNative('attachInterrupt', (args) => {
    interpreter.attachInterrupt(pinOf(args), args[1], MODE_NAMES[int(args, 2, 1)] ?? 'CHANGE')
    return null
  })
  interpreter.defineNative('detachInterrupt', (args) => {
    interpreter.detachInterrupt(pinOf(args))
    return null
  })
  interpreter.defineNative('digitalPinToInterrupt', (args) => int(args, 0))

  // ---------- math ----------
  const math: Record<string, (args: Value[]) => Value> = {
    min: (args) => Math.min(num(args, 0), num(args, 1)),
    max: (args) => Math.max(num(args, 0), num(args, 1)),
    abs: (args) => Math.abs(num(args, 0)),
    fabs: (args) => Math.abs(num(args, 0)),
    constrain: (args) => Math.min(Math.max(num(args, 0), num(args, 1)), num(args, 2)),
    pow: (args) => Math.pow(num(args, 0), num(args, 1)),
    sqrt: (args) => Math.sqrt(num(args, 0)),
    sq: (args) => num(args, 0) ** 2,
    sin: (args) => Math.sin(num(args, 0)),
    cos: (args) => Math.cos(num(args, 0)),
    tan: (args) => Math.tan(num(args, 0)),
    asin: (args) => Math.asin(num(args, 0)),
    acos: (args) => Math.acos(num(args, 0)),
    atan: (args) => Math.atan(num(args, 0)),
    atan2: (args) => Math.atan2(num(args, 0), num(args, 1)),
    log: (args) => Math.log(num(args, 0)),
    log10: (args) => Math.log10(num(args, 0)),
    exp: (args) => Math.exp(num(args, 0)),
    floor: (args) => Math.floor(num(args, 0)),
    ceil: (args) => Math.ceil(num(args, 0)),
    round: (args) => Math.round(num(args, 0)),
    trunc: (args) => Math.trunc(num(args, 0)),
    radians: (args) => (num(args, 0) * Math.PI) / 180,
    degrees: (args) => (num(args, 0) * 180) / Math.PI,
    isnan: (args) => (Number.isNaN(num(args, 0)) ? 1 : 0),
    isinf: (args) => (Number.isFinite(num(args, 0)) ? 0 : 1),
    map: (args) => {
      const [value, inMin, inMax, outMin, outMax] = [num(args, 0), num(args, 1), num(args, 2), num(args, 3), num(args, 4)]
      if (inMax === inMin) return outMin
      return Math.trunc(((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin)
    },
  }
  for (const [name, fn] of Object.entries(math)) interpreter.defineNative(name, fn)

  // ---------- random ----------
  // A seeded xorshift keeps a run reproducible after randomSeed().
  let seed = 0x2545f491
  const nextRandom = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0x100000000
  }
  interpreter.defineNative('randomSeed', (args) => {
    seed = (int(args, 0) || 1) >>> 0 || 1
    return null
  })
  interpreter.defineNative('random', (args) => {
    if (args.length === 0) return Math.trunc(nextRandom() * 0x7fffffff)
    if (args.length === 1) return Math.trunc(nextRandom() * int(args, 0))
    const lo = int(args, 0)
    const hi = int(args, 1)
    return lo + Math.trunc(nextRandom() * Math.max(1, hi - lo))
  })
  interpreter.defineNative('esp_random', () => Math.trunc(nextRandom() * 0xffffffff))

  // ---------- bit and byte helpers ----------
  const bits: Record<string, (args: Value[]) => Value> = {
    bit: (args) => 2 ** int(args, 0),
    bitRead: (args) => (Math.trunc(num(args, 0)) >> int(args, 1)) & 1,
    bitSet: (args) => Math.trunc(num(args, 0)) | (1 << int(args, 1)),
    bitClear: (args) => Math.trunc(num(args, 0)) & ~(1 << int(args, 1)),
    bitWrite: (args) => {
      const value = Math.trunc(num(args, 0))
      const index = int(args, 1)
      return toBool(args[2]) ? value | (1 << index) : value & ~(1 << index)
    },
    lowByte: (args) => Math.trunc(num(args, 0)) & 0xff,
    highByte: (args) => (Math.trunc(num(args, 0)) >> 8) & 0xff,
    word: (args) => (args.length > 1 ? ((int(args, 0) & 0xff) << 8) | (int(args, 1) & 0xff) : int(args, 0) & 0xffff),
  }
  for (const [name, fn] of Object.entries(bits)) interpreter.defineNative(name, fn)

  // ---------- character classification ----------
  const charTests: Record<string, (code: number) => boolean> = {
    isDigit: (c) => c >= 48 && c <= 57,
    isAlpha: (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isAlphaNumeric: (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isSpace: (c) => c === 32 || (c >= 9 && c <= 13),
    isUpperCase: (c) => c >= 65 && c <= 90,
    isLowerCase: (c) => c >= 97 && c <= 122,
    isPunct: (c) => (c >= 33 && c <= 47) || (c >= 58 && c <= 64),
    isHexadecimalDigit: (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
    isPrintable: (c) => c >= 32 && c < 127,
    isControl: (c) => c < 32 || c === 127,
    isWhitespace: (c) => c === 32 || c === 9,
    isAscii: (c) => c < 128,
  }
  for (const [name, test] of Object.entries(charTests)) {
    interpreter.defineNative(name, (args) => (test(Math.trunc(num(args, 0))) ? 1 : 0))
  }
  interpreter.defineNative('toUpperCase', (args) => String.fromCharCode(int(args, 0)).toUpperCase().charCodeAt(0))
  interpreter.defineNative('toLowerCase', (args) => String.fromCharCode(int(args, 0)).toLowerCase().charCodeAt(0))

  // ---------- conversions & C string helpers ----------
  interpreter.defineNative('char', (args) => int(args, 0) & 0xff)
  interpreter.defineNative('byte', (args) => int(args, 0) & 0xff)
  interpreter.defineNative('F', (args) => toDisplayString(args[0]))
  interpreter.defineNative('PSTR', (args) => toDisplayString(args[0]))
  interpreter.defineNative('FPSTR', (args) => toDisplayString(args[0]))
  interpreter.defineNative('strlen', (args) => toDisplayString(args[0]).length)
  interpreter.defineNative('strcmp', (args) => {
    const a = toDisplayString(args[0])
    const b = toDisplayString(args[1])
    return a < b ? -1 : a > b ? 1 : 0
  })
  interpreter.defineNative('atoi', (args) => Math.trunc(parseFloat(toDisplayString(args[0]))) || 0)
  interpreter.defineNative('atof', (args) => parseFloat(toDisplayString(args[0])) || 0)
  interpreter.defineNative('dtostrf', (args) => num(args, 0).toFixed(int(args, 2, 2)))
  interpreter.defineNative('sprintf', (args) => formatPrintf(toDisplayString(args[1]), args.slice(2)))
  interpreter.defineNative('snprintf', (args) => formatPrintf(toDisplayString(args[2]), args.slice(3)))

  // `String(value)` and `String(value, base)` build text like the core does
  interpreter.registerClass('String', (args) => (args.length === 0 ? '' : formatPrint(args[0], args[1])))

  // ---------- Serial ports ----------
  const serial = makeSerialPort(interpreter, 'Serial', true)
  interpreter.defineGlobal('Serial', serial)
  interpreter.defineGlobal('Serial0', serial)
  if (board.family === 'esp32') {
    interpreter.defineGlobal('Serial1', makeSerialPort(interpreter, 'Serial1', false))
    interpreter.defineGlobal('Serial2', makeSerialPort(interpreter, 'Serial2', false))
  }
  if (board.id === 'mega') {
    for (const label of ['Serial1', 'Serial2', 'Serial3']) {
      interpreter.defineGlobal(label, makeSerialPort(interpreter, label, false))
    }
  }

  // ---------- ESP32 LEDC PWM ----------
  if (board.family === 'esp32' || board.family === 'esp8266') {
    const channelPins = new Map<number, number | string>()
    const channelBits = new Map<number, number>()
    interpreter.defineNative('ledcSetup', (args) => {
      const channel = int(args, 0)
      channelBits.set(channel, int(args, 2, 8))
      return num(args, 1)
    })
    interpreter.defineNative('ledcAttachPin', (args) => {
      channelPins.set(int(args, 1), pinOf(args, 0))
      return null
    })
    interpreter.defineNative('ledcAttach', (args) => {
      // newer 3.x core: ledcAttach(pin, freq, resolution)
      const pin = pinOf(args, 0)
      channelPins.set(-1, pin)
      channelBits.set(-1, int(args, 2, 8))
      return 1
    })
    interpreter.defineNative('ledcAttachChannel', (args) => {
      channelPins.set(int(args, 3), pinOf(args, 0))
      channelBits.set(int(args, 3), int(args, 2, 8))
      return 1
    })
    interpreter.defineNative('ledcWrite', (args) => {
      // 2.x takes a channel, 3.x takes the pin directly
      const first = int(args, 0)
      const duty = num(args, 1)
      const pin = channelPins.get(first) ?? hardware.resolvePin(first)
      const resolution = channelBits.get(first) ?? channelBits.get(-1) ?? 8
      const scaled = Math.round((duty / (2 ** resolution - 1)) * 255)
      hardware.analogWrite(pin, Math.max(0, Math.min(255, scaled)))
      return null
    })
    interpreter.defineNative('ledcWriteTone', (args) => {
      const pin = channelPins.get(int(args, 0)) ?? hardware.resolvePin(int(args, 0))
      hardware.tone(pin, int(args, 1))
      return num(args, 1)
    })
    interpreter.defineNative('ledcDetachPin', (args) => {
      hardware.noTone(pinOf(args, 0))
      return null
    })
  }

  // ---------- ESP object ----------
  if (board.family === 'esp32' || board.family === 'esp8266') {
    interpreter.defineGlobal('ESP', new CObject('ESP', {}, {
      getFreeHeap: () => board.ramKB * 1024 - 40_000,
      getHeapSize: () => board.ramKB * 1024,
      getChipModel: () => board.mcu,
      getCpuFreqMHz: () => board.cpuMHz,
      getFlashChipSize: () => board.flashKB * 1024,
      getSdkVersion: () => 'kodyuno-sim',
      getEfuseMac: () => 0x0024a1c0ffee,
      restart: () => {
        interpreter.warn('ESP.restart() dipanggil — simulator berhenti')
        interpreter.stop()
        return null
      },
      deepSleep: () => {
        interpreter.warn('ESP.deepSleep() dipanggil — simulator berhenti')
        interpreter.stop()
        return null
      },
      wdtFeed: () => null,
    }))
  }
}
