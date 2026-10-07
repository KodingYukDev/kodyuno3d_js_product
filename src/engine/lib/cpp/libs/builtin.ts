// ============================================================
// KodyUno — built-in library shims
//
// Each shim registers the classes its header provides and drives the
// matching simulated part through the Hardware bridge. Behaviour is what
// the part visibly does, not the wire protocol: `lcd.print("hi")` writes
// text onto the LCD component rather than toggling I2C lines.
// ============================================================
import { HX711_COUNTS_PER_GRAM, HX711_ZERO_OFFSET, matrixPatch, Max7219Chain } from '@kodyuno/lib/firmware/signalModels'
import { CArray, CChar, CObject, printFloat, printText, toDisplayString, toNumber, type NativeMethod, type Value, CFloat } from '../values'
import type { Interpreter } from '../runtime'
import type { SimLibrary } from './types'
import { MonoFramebuffer } from '@kodyuno/lib/monoFramebuffer'
import { rtcEpoch } from '@kodyuno/lib/rtcClock'
import { ColorFramebuffer } from '@kodyuno/lib/colorFramebuffer'
import { parseRfidUid } from '@kodyuno/lib/rfidUid'
import { DEFAULT_SPI_PINS, type SpiPins } from '@kodyuno/lib/spiBus'
import type { SimComponentView } from '../hardware'
import type { TypeInfo } from '../ast'
import { crc8, ds18b20Celsius, Ds18b20, OneWireMaster, resolutionFromConfig } from '@kodyuno/lib/oneWire'

const spiBuses = new WeakMap<Interpreter, SpiPins>()
function spiWired(interpreter: Interpreter, entry: SimComponentView, reads: boolean): boolean {
  const pins = spiBuses.get(interpreter) ?? DEFAULT_SPI_PINS[interpreter.hardware.board.id]
  if (!pins) return false
  return String(entry.rolePins.mosi) === String(pins.mosi)
    && String(entry.rolePins.sck) === String(pins.sck)
    && (!reads || String(entry.rolePins.miso) === String(pins.miso))
}

const int = (args: Value[], index: number, fallback = 0): number => {
  const value = args[index]
  return value === undefined ? fallback : Math.trunc(toNumber(value))
}
const dbl = (args: Value[], index: number, fallback = 0): number => {
  const value = args[index]
  return value === undefined ? fallback : toNumber(value)
}
const text = (args: Value[], index: number): string => toDisplayString(args[index])

/** Read a number out of a simulated component's loosely-typed state bag. */
const stateNum = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Pad or trim a character display buffer to its real geometry. */
function writeToDisplay(lines: string[], cols: number, rows: number, cursor: [number, number], value: string) {
  let [col, row] = cursor
  for (const char of value) {
    if (char === '\n') {
      row++
      col = 0
      continue
    }
    if (row < 0 || row >= rows) break
    const line = (lines[row] ?? '').padEnd(cols, ' ')
    if (col >= 0 && col < cols) lines[row] = (line.slice(0, col) + char + line.slice(col + 1)).slice(0, cols)
    col++
  }
  return [col, row] as [number, number]
}

/** A character LCD backed by an `lcd` or `lcd2004` part on the canvas. */
function makeCharacterDisplay(
  interpreter: Interpreter,
  className: string,
  partTypes: string[],
  cols: number,
  rows: number,
  address?: number,
): CObject {
  const state = {
    lines: Array.from({ length: rows }, () => ''),
    cursor: [0, 0] as [number, number],
    backlight: true,
    displayOn: true,
    scroll: 0,
  }

  const sync = () => {
    if (address !== undefined && interpreter.hardware.i2cWrite(address, []) !== 0) return
    for (const type of partTypes) {
      for (const part of interpreter.hardware.componentsOfType(type)) {
        if (!part.powered || (address !== undefined && Number(part.state.address ?? 0x27) !== address)) continue
        interpreter.hardware.patchComponent(part.id, {
          lines: state.displayOn ? state.lines.map(line => {
            const padded = line.padEnd(cols, ' ')
            if (state.scroll >= 0) return padded.slice(Math.min(cols, state.scroll)).padEnd(cols, ' ')
            const spaces = Math.min(cols, -state.scroll)
            return (' '.repeat(spaces) + padded).slice(0, cols)
          }) : Array.from({ length: rows }, () => ''),
          displayOn: state.displayOn,
          cursor: [...state.cursor],
          backlight: state.backlight,
        })
      }
    }
  }

  const print: NativeMethod = (args) => {
    const floating = args[0] instanceof CFloat || (typeof args[0] === 'number' && !Number.isInteger(args[0]))
    const value = args.length > 1 ? (floating ? printFloat(toNumber(args[0]), Math.max(0, int(args, 1, 2))) : Number(toNumber(args[0])).toString(int(args, 1, 10))) : printText(args[0])
    state.cursor = writeToDisplay(state.lines, cols, rows, state.cursor, value)
    sync()
    return value.length
  }

  return new CObject(className, {}, {
    begin: () => {
      sync()
      return null
    },
    init: () => {
      sync()
      return null
    },
    clear: () => {
      state.lines = Array.from({ length: rows }, () => '')
      state.cursor = [0, 0]
      state.scroll = 0
      sync()
      return null
    },
    home: () => {
      state.cursor = [0, 0]
      state.scroll = 0
      sync()
      return null
    },
    setCursor: (args) => {
      state.cursor = [int(args, 0), int(args, 1)]
      return null
    },
    print,
    println: (args) => {
      print(args)
      state.cursor = [0, state.cursor[1] + 1]
      sync()
      return null
    },
    write: (args) => {
      print([String.fromCharCode(int(args, 0))])
      return 1
    },
    printstr: print,
    backlight: () => {
      state.backlight = true
      sync()
      return null
    },
    noBacklight: () => {
      state.backlight = false
      sync()
      return null
    },
    setBacklight: (args) => {
      state.backlight = toNumber(args[0]) !== 0
      sync()
      return null
    },
    display: () => { state.displayOn = true; sync(); return null },
    noDisplay: () => { state.displayOn = false; sync(); return null },
    cursor: () => null,
    noCursor: () => null,
    blink: () => null,
    noBlink: () => null,
    createChar: () => null,
    scrollDisplayLeft: () => { state.scroll = Math.min(cols, state.scroll + 1); sync(); return null },
    scrollDisplayRight: () => { state.scroll = Math.max(-cols, state.scroll - 1); sync(); return null },
    autoscroll: () => null,
    noAutoscroll: () => null,
    leftToRight: () => null,
    rightToLeft: () => null,
  })
}

// ------------------------------------------------------------
// Servo
// ------------------------------------------------------------

function installServo(interpreter: Interpreter) {
  const factory = () => {
    let pin: number | string = -1
    let angle = 0
    let attached = false
    let minPulse = 544
    let maxPulse = 2400
    let pulse = 1500

    const drive = (nextAngle: number) => {
      angle = Math.max(0, Math.min(180, Math.round(nextAngle)))
      pulse = Math.round(minPulse + (angle / 180) * (maxPulse - minPulse))
      if (!attached) return
      // a hobby servo is driven by pulse width; the canvas shows the angle
      interpreter.hardware.analogWrite(pin, Math.round((angle / 180) * 255))
      const part = interpreter.hardware.componentOn('servo', pin, 'signal')
      if (part?.powered) interpreter.hardware.patchComponent(part.id, { angle })
    }

    return new CObject('Servo', {}, {
      attach: (args) => {
        pin = interpreter.hardware.resolvePin(int(args, 0))
        minPulse = int(args, 1, 544)
        maxPulse = int(args, 2, 2400)
        const definition = interpreter.hardware.board.pins.find(entry => String(entry.id) === String(pin))
        if (!definition || definition.inputOnly || !['gpio', 'analog'].includes(definition.kind) || minPulse <= 0 || maxPulse <= minPulse) {
          attached = false
          interpreter.warn('Servo.attach(): pin atau rentang pulsa tidak valid')
          return 0
        }
        attached = true
        interpreter.hardware.pinMode(pin, 'OUTPUT')
        drive(angle)
        return 1
      },
      attached: () => (attached ? 1 : 0),
      detach: () => {
        if (attached) interpreter.hardware.digitalWrite(pin, 0)
        attached = false
        return null
      },
      write: (args) => {
        const value = dbl(args, 0)
        drive(value >= 544 ? ((Math.max(minPulse, Math.min(maxPulse, value)) - minPulse) / (maxPulse - minPulse)) * 180 : value)
        return null
      },
      writeMicroseconds: (args) => {
        // 544–2400µs is the standard hobby-servo pulse range
        const us = dbl(args, 0, 1500)
        drive(((Math.max(minPulse, Math.min(maxPulse, us)) - minPulse) / (maxPulse - minPulse)) * 180)
        pulse = Math.round(Math.max(minPulse, Math.min(maxPulse, us)))
        return null
      },
      read: () => angle,
      readMicroseconds: () => pulse,
      setPeriodHertz: () => null,
      // ESP32Servo keeps a timer allocator that the simulator does not need
      allocateTimer: () => null,
    })
  }
  interpreter.registerClass('Servo', factory)
}

// ------------------------------------------------------------
// NeoPixel
// ------------------------------------------------------------

function installNeoPixel(interpreter: Interpreter) {
  interpreter.registerClass('Adafruit_NeoPixel', (args) => {
    let count = Math.max(1, int(args, 0, 1))
    let pin = interpreter.hardware.resolvePin(int(args, 1, 6))
    let brightness = 255
    const pixels: number[] = Array.from({ length: count }, () => 0)

    const push = () => {
      const scaled = pixels.map((color) => {
        const r = Math.round((((color >> 16) & 0xff) * brightness) / 255)
        const g = Math.round((((color >> 8) & 0xff) * brightness) / 255)
        const b = Math.round(((color & 0xff) * brightness) / 255)
        return (r << 16) | (g << 8) | b
      })
      for (const type of ['neopixel', 'neopixel_matrix', 'led_ring']) {
        const part = interpreter.hardware.componentOn(type, pin, 'din')
        if (!part?.powered) continue
        const first = scaled[0] ?? 0
        interpreter.hardware.patchComponent(part.id, {
          pixels: scaled,
          red: (first >> 16) & 0xff,
          green: (first >> 8) & 0xff,
          blue: first & 0xff,
        })
      }
    }

    const object = new CObject('Adafruit_NeoPixel', {}, {
      begin: () => {
        interpreter.hardware.pinMode(pin, 'OUTPUT')
        return null
      },
      updateLength: (args2) => {
        count = Math.max(0, Math.min(65535, int(args2, 0, count)))
        pixels.length = count
        pixels.fill(0)
        return null
      },
      setPin: (args2) => {
        pin = interpreter.hardware.resolvePin(int(args2, 0, 6))
        return null
      },
      numPixels: () => count,
      setBrightness: (args2) => {
        brightness = Math.max(0, Math.min(255, int(args2, 0, 255)))
        return null
      },
      getBrightness: () => brightness,
      setPixelColor: (args2) => {
        const index = int(args2, 0)
        const color = args2.length >= 4
          ? ((int(args2, 1) & 0xff) << 16) | ((int(args2, 2) & 0xff) << 8) | (int(args2, 3) & 0xff)
          : int(args2, 1)
        if (index >= 0 && index < count) pixels[index] = color >>> 0
        return null
      },
      getPixelColor: (args2) => pixels[int(args2, 0)] ?? 0,
      fill: (args2) => {
        const color = int(args2, 0)
        const first = Math.max(0, int(args2, 1, 0))
        const requested = int(args2, 2, 0)
        const length = requested === 0 ? count - first : Math.max(0, requested)
        for (let i = first; i < Math.min(count, first + length); i++) pixels[i] = color >>> 0
        return null
      },
      clear: () => {
        pixels.fill(0)
        return null
      },
      show: () => {
        push()
        return null
      },
      Color: (args2) => ((int(args2, 0) & 0xff) << 16) | ((int(args2, 1) & 0xff) << 8) | (int(args2, 2) & 0xff),
      ColorHSV: (args2) => {
        const hue = (int(args2, 0) % 65536) / 65536
        const sat = int(args2, 1, 255) / 255
        const val = int(args2, 2, 255) / 255
        const i = Math.floor(hue * 6)
        const f = hue * 6 - i
        const p = val * (1 - sat)
        const q = val * (1 - f * sat)
        const t = val * (1 - (1 - f) * sat)
        const [r, g, b] = [[val, t, p], [q, val, p], [p, val, t], [p, q, val], [t, p, val], [val, p, q]][i % 6]
        return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)
      },
      gamma32: (args2) => int(args2, 0),
      canShow: () => 1,
    })
    return object
  })

  // Adafruit_NeoPixel::Color() is also used as a static
  interpreter.defineGlobal('NEO_GRB', 0x52)
  interpreter.defineGlobal('NEO_RGB', 0x06)
  interpreter.defineGlobal('NEO_GRBW', 0x1a)
  interpreter.defineGlobal('NEO_KHZ800', 0x0000)
  interpreter.defineGlobal('NEO_KHZ400', 0x0100)
}

// ------------------------------------------------------------
// SSD1306 OLED (Adafruit_GFX API)
// ------------------------------------------------------------

function installSSD1306(interpreter: Interpreter) {
  interpreter.registerClass('Adafruit_SSD1306', () => {
    const lines: string[] = []
    let cursor: [number, number] = [0, 0]
    let textSize = 1
    let address = 0x3c
    let initialized = false
    let inverted = false
    let dimmed = false
    const framebuffer = new MonoFramebuffer()
    const connected = () => interpreter.hardware.i2cWrite(address, []) === 0

    const sync = () => {
      if (!initialized || !connected()) return
      for (const part of interpreter.hardware.componentsOfType('ssd1306').filter((entry) => entry.powered && Number(entry.state.address ?? 0x3c) === address)) {
        interpreter.hardware.patchComponent(part.id, { lines: [...lines], cursor: [...cursor], textSize, framebuffer: framebuffer.snapshot(), inverted, dimmed })
      }
    }
    const write = (value: string) => {
      const row = cursor[1]
      const line = lines[row] ?? ''
      lines[row] = line.padEnd(cursor[0], ' ') + value
      cursor = [cursor[0] + value.length, row]
    }

    return new CObject('Adafruit_SSD1306', {}, {
      begin: (args) => {
        if (args.length > 1) address = int(args, 1, 0x3c) & 0x7f
        initialized = connected()
        return initialized ? 1 : 0
      },
      display: () => {
        sync()
        return null
      },
      clearDisplay: () => {
        lines.length = 0
        framebuffer.clear()
        cursor = [0, 0]
        return null
      },
      setTextSize: (args) => {
        textSize = Math.max(1, Math.min(8, int(args, 0, 1)))
        return null
      },
      setTextColor: () => null,
      setCursor: (args) => {
        // GFX cursors are pixels; a size-1 glyph is 6×8
        cursor = [Math.floor(int(args, 0) / (6 * textSize)), Math.floor(int(args, 1) / (8 * textSize))]
        return null
      },
      print: (args) => {
        write(printText(args[0]))
        return null
      },
      println: (args) => {
        write(args.length ? printText(args[0]) : '')
        cursor = [0, cursor[1] + 1]
        return null
      },
      printf: (args) => {
        write(toDisplayString(args[0]))
        return null
      },
      write: (args) => {
        write(String.fromCharCode(int(args, 0)))
        return 1
      },
      drawPixel: (args) => { framebuffer.pixel(int(args, 0), int(args, 1), int(args, 2)); return null },
      drawLine: (args) => { framebuffer.line(int(args, 0), int(args, 1), int(args, 2), int(args, 3), int(args, 4)); return null },
      drawRect: (args) => { framebuffer.rect(int(args, 0), int(args, 1), int(args, 2), int(args, 3), int(args, 4), false); return null },
      fillRect: (args) => { framebuffer.rect(int(args, 0), int(args, 1), int(args, 2), int(args, 3), int(args, 4), true); return null },
      drawCircle: (args) => { framebuffer.circle(int(args, 0), int(args, 1), int(args, 2), int(args, 3), false); return null },
      fillCircle: (args) => { framebuffer.circle(int(args, 0), int(args, 1), int(args, 2), int(args, 3), true); return null },
      drawBitmap: (args) => {
        if (args[2] instanceof CArray) framebuffer.bitmap(int(args, 0), int(args, 1), args[2].elements.map(toNumber), int(args, 3), int(args, 4), int(args, 5), args.length > 6 ? int(args, 6) : undefined)
        return null
      },
      startscrollright: () => null,
      stopscroll: () => null,
      dim: (args) => {
        dimmed = Boolean(toNumber(args[0]))
        if (initialized && connected()) for (const part of interpreter.hardware.componentsOfType('ssd1306')) {
          if (part.powered && Number(part.state.address ?? 0x3c) === address) interpreter.hardware.patchComponent(part.id, { dimmed })
        }
        return null
      },
      invertDisplay: (args) => {
        inverted = Boolean(toNumber(args[0]))
        if (initialized && connected()) for (const part of interpreter.hardware.componentsOfType('ssd1306')) {
          if (part.powered && Number(part.state.address ?? 0x3c) === address) interpreter.hardware.patchComponent(part.id, { inverted })
        }
        return null
      },
      width: () => 128,
      height: () => 64,
      setRotation: () => null,
      cp437: () => null,
    })
  })
  interpreter.defineGlobal('SSD1306_SWITCHCAPVCC', 0x02)
  interpreter.defineGlobal('SSD1306_WHITE', 1)
  interpreter.defineGlobal('SSD1306_BLACK', 0)
  interpreter.defineGlobal('WHITE', 1)
  interpreter.defineGlobal('BLACK', 0)
}

// ------------------------------------------------------------
// DHT temperature/humidity
// ------------------------------------------------------------

function installDHT(interpreter: Interpreter) {
  interpreter.registerClass('DHT', (args) => {
    const pin = interpreter.hardware.resolvePin(int(args, 0, 2))

    const sensorType = int(args, 1, 22) === 11 ? 'dht11' : 'dht22'
    const readPart = () => {
      const part = interpreter.hardware.componentOn(sensorType, pin, 'data')
      return part?.powered ? part : undefined
    }

    const temperature = () => stateNum(readPart()?.state.temperature, Number.NaN)
    const humidity = () => stateNum(readPart()?.state.humidity, Number.NaN)

    return new CObject('DHT', {}, {
      begin: () => null,
      readTemperature: (args2) => {
        const celsius = temperature()
        return toNumber(args2[0]) ? (celsius * 9) / 5 + 32 : celsius
      },
      readHumidity: () => humidity(),
      computeHeatIndex: (args2) => dbl(args2, 0, temperature()),
      read: () => readPart() ? 1 : 0,
    })
  })
  interpreter.defineGlobal('DHT11', 11)
  interpreter.defineGlobal('DHT22', 22)
  interpreter.defineGlobal('DHT21', 21)
  interpreter.defineGlobal('AM2301', 21)
}

// ------------------------------------------------------------
// Wire / SPI / EEPROM
// ------------------------------------------------------------

function installWire(interpreter: Interpreter) {
  const createBus = () => {
  const rxBuffer: number[] = []
  const txBuffer: number[] = []
  let address = 0
  let sda: number | string | undefined
  let scl: number | string | undefined
  return new CObject('TwoWire', {}, {
    begin: (args) => {
      if (args.length >= 2) {
        sda = interpreter.hardware.resolvePin(int(args, 0))
        scl = interpreter.hardware.resolvePin(int(args, 1))
      }
      return null
    },
    setClock: () => null,
    beginTransmission: (args) => {
      address = int(args, 0) & 0x7f
      txBuffer.length = 0
      return null
    },
    endTransmission: () => interpreter.hardware.i2cWrite(address, txBuffer, sda, scl),
    write: (args) => {
      if (args[0] instanceof CArray || typeof args[0] === 'string') {
        const bytes = args[0] instanceof CArray ? args[0].elements.map(toNumber) : Array.from(args[0], ch => ch.charCodeAt(0))
        const count = Math.max(0, Math.min(bytes.length, int(args, 1, bytes.length)))
        for (let i = 0; i < count; i++) txBuffer.push(bytes[i] & 0xff)
        return count
      }
      txBuffer.push(int(args, 0) & 0xff)
      return 1
    },
    requestFrom: (args) => {
      const requestAddress = int(args, 0) & 0x7f
      const count = Math.max(0, Math.min(256, int(args, 1, 0)))
      rxBuffer.splice(0, rxBuffer.length, ...interpreter.hardware.i2cRead(requestAddress, count, sda, scl))
      return rxBuffer.length
    },
    available: () => rxBuffer.length,
    peek: () => rxBuffer[0] ?? -1,
    read: () => rxBuffer.shift() ?? -1,
    setPins: (args) => {
      sda = interpreter.hardware.resolvePin(int(args, 0))
      scl = interpreter.hardware.resolvePin(int(args, 1))
      return 1
    },
  })
  }
  interpreter.defineGlobal('Wire', createBus())
  interpreter.defineGlobal('Wire1', createBus())
  interpreter.registerClass('TwoWire', createBus)
}

function installSPI(interpreter: Interpreter) {
  let order = 1
  let pins: { mosi: number | string; miso: number | string; sck: number | string } | undefined
  const transfer = (value: number) => interpreter.hardware.spiTransfer(value & 0xff, pins) & 0xff
  interpreter.defineGlobal('SPI', new CObject('SPIClass', {}, {
    begin: (args) => {
      if (args.length >= 3) pins = { sck: interpreter.hardware.resolvePin(int(args, 0)), miso: interpreter.hardware.resolvePin(int(args, 1)), mosi: interpreter.hardware.resolvePin(int(args, 2)) }
      if (pins) spiBuses.set(interpreter, pins)
      return null
    },
    end: () => null,
    beginTransaction: (args) => {
      if (args[0] instanceof CObject) order = toNumber(args[0].fields.bitOrder) === 0 ? 0 : 1
      return null
    },
    endTransaction: () => null,
    transfer: (args) => {
      if (args[0] instanceof CArray) {
        const buffer = args[0]
        const count = Math.max(0, Math.min(buffer.length, int(args, 1, buffer.length)))
        for (let i = 0; i < count; i++) buffer.elements[i] = transfer(toNumber(buffer.elements[i]))
        return null
      }
      return transfer(int(args, 0))
    },
    transfer16: (args) => {
      const value = int(args, 0) & 0xffff
      if (order === 0) {
        const low = transfer(value)
        return (transfer(value >> 8) << 8) | low
      }
      return (transfer(value >> 8) << 8) | transfer(value)
    },
    setBitOrder: (args) => { order = int(args, 0) === 0 ? 0 : 1; return null },
    setDataMode: () => null,
    setClockDivider: () => null,
  }))
  interpreter.registerClass('SPISettings', args => new CObject('SPISettings', { clock: int(args, 0, 4000000), bitOrder: int(args, 1, 1), dataMode: int(args, 2) }))
  interpreter.defineGlobal('MSBFIRST', 1)
  interpreter.defineGlobal('LSBFIRST', 0)
  interpreter.defineGlobal('SPI_MODE0', 0)
  interpreter.defineGlobal('SPI_MODE1', 1)
  interpreter.defineGlobal('SPI_MODE2', 2)
  interpreter.defineGlobal('SPI_MODE3', 3)
}

function installEEPROM(interpreter: Interpreter) {
  // Simulated EEPROM lives for the run only — nothing is written to disk.
  const cells = new Map<number, number>()
  const avr = interpreter.hardware.board.arch === 'avr'
  let capacity = avr ? interpreter.hardware.board.id === 'mega' ? 4096 : 1024 : 0
  const valid = (address: number) => Number.isInteger(address) && address >= 0 && address < capacity
  const write = (args: Value[]) => {
    const address = int(args, 0)
    if (valid(address)) cells.set(address, int(args, 1) & 0xff)
    return null
  }
  interpreter.defineGlobal('EEPROM', new CObject('EEPROMClass', {}, {
    begin: (args) => {
      if (avr) return 1
      const requested = int(args, 0)
      if (!Number.isFinite(requested) || requested <= 0 || requested > 4096) return 0
      capacity = requested
      return 1
    },
    read: (args) => valid(int(args, 0)) ? cells.get(int(args, 0)) ?? 255 : 0,
    write,
    update: write,
    get: (args) => cells.get(int(args, 0)) ?? 0,
    put: (args) => {
      cells.set(int(args, 0), int(args, 1))
      return null
    },
    commit: () => capacity > 0 ? 1 : 0,
    end: () => { if (!avr) capacity = 0; return null },
    length: () => capacity,
  }))
}

// ------------------------------------------------------------
// WiFi (simulated association, no real network)
// ------------------------------------------------------------

function installWiFi(interpreter: Interpreter) {
  let status = 6 // WL_DISCONNECTED
  let ssid = ''
  const networks = [{ ssid: 'Wokwi-GUEST', rssi: -50, channel: 6, encryption: 0, bssid: '02:00:00:00:00:01' }]
  interpreter.defineGlobal('WiFi', new CObject('WiFiClass', {}, {
    mode: () => null,
    begin: (args) => {
      ssid = text(args, 0)
      const password = args.length > 1 ? text(args, 1) : ''
      const network = networks.find((entry) => entry.ssid === ssid)
      status = network && password === '' ? 3 : 4
      if (status === 3) interpreter.warn(`WiFi virtual tersambung ke "${ssid}" pada channel ${network!.channel}`)
      else interpreter.warn(`WiFi gagal: access point "${ssid}" tidak ditemukan atau kata sandi salah`)
      return status
    },
    status: () => status,
    disconnect: () => {
      status = 6
      return null
    },
    localIP: () => '192.168.4.2',
    macAddress: () => 'A0:B1:C2:D3:E4:F5',
    SSID: (args) => args.length ? networks[int(args, 0)]?.ssid ?? '' : ssid,
    RSSI: (args) => networks[args.length ? int(args, 0) : 0]?.rssi ?? -100,
    channel: (args) => networks[args.length ? int(args, 0) : 0]?.channel ?? 0,
    encryptionType: (args) => networks[int(args, 0)]?.encryption ?? 0,
    BSSIDstr: (args) => networks[int(args, 0)]?.bssid ?? '',
    softAP: (args) => {
      ssid = text(args, 0)
      interpreter.warn(`WiFi.softAP("${ssid}") disimulasikan`)
      return 1
    },
    softAPIP: () => '192.168.4.1',
    setSleep: () => null,
    scanNetworks: () => networks.length,
  }))
  interpreter.defineGlobal('WL_CONNECTED', 3)
  interpreter.defineGlobal('WL_DISCONNECTED', 6)
  interpreter.defineGlobal('WL_IDLE_STATUS', 0)
  interpreter.defineGlobal('WL_NO_SSID_AVAIL', 1)
  interpreter.defineGlobal('WL_CONNECT_FAILED', 4)
  interpreter.defineGlobal('WIFI_AUTH_OPEN', 0)
  interpreter.defineGlobal('WIFI_STA', 1)
  interpreter.defineGlobal('WIFI_AP', 2)
}

// ------------------------------------------------------------
// Smaller shims
// ------------------------------------------------------------

function installSoftwareSerial(interpreter: Interpreter) {
  interpreter.registerClass('SoftwareSerial', (args) => {
    const label = `SoftwareSerial(${int(args, 0)},${int(args, 1)})`
    return new CObject('SoftwareSerial', {}, {
      begin: () => null,
      print: (a) => {
        interpreter.print(`[${label}] ${toDisplayString(a[0])}`)
        return null
      },
      println: (a) => {
        interpreter.print(`[${label}] ${a.length ? toDisplayString(a[0]) : ''}\n`)
        return null
      },
      write: () => 1,
      available: () => 0,
      read: () => -1,
      listen: () => 1,
    })
  })
}

function installStepper(interpreter: Interpreter) {
  interpreter.registerClass('Stepper', (args) => {
    const stepsPerRev = Math.max(1, int(args, 0, 2048))
    const pins = args.slice(1).map(value => interpreter.hardware.resolvePin(toNumber(value)))
    let rpm = 60
    let position = 0
    return new CObject('Stepper', {}, {
      setSpeed: (values) => {
        const requested = dbl(values, 0)
        if (Number.isFinite(requested) && requested > 0) rpm = requested
        else interpreter.warn('Stepper.setSpeed(): RPM harus lebih besar dari nol')
        return null
      },
      step: async (a) => {
        const steps = int(a, 0)
        position += steps
        const angle = ((position / stepsPerRev) * 360) % 360
        for (const part of interpreter.hardware.componentsOfType('stepper')) {
          if (!part.powered || pins.length !== 4 || !pins.every((pin, index) => String(part.rolePins[`in${index + 1}`]) === String(pin))) continue
          interpreter.hardware.patchComponent(part.id, { angle: (angle + 360) % 360 })
        }
        // a real stepper takes time; mirror it so animations look right
        await interpreter.delay(Math.abs(steps) * 60000 / (stepsPerRev * rpm))
        return null
      },
      version: () => 5,
    })
  })
}

function installKeypad(interpreter: Interpreter) {
  interpreter.registerClass('Keypad', (args) => {
    const rows = args[1] instanceof CArray ? args[1].elements : []
    const cols = args[2] instanceof CArray ? args[2].elements : []
    const rowCount = int(args, 3), colCount = int(args, 4)
    const flatten = (value: Value): Value[] => value instanceof CArray ? value.elements.flatMap(flatten) : [value]
    const keymap = flatten(args[0])
    const configured = rowCount > 0 && rowCount <= 4 && colCount > 0 && colCount <= 4
      && rows.length >= rowCount && cols.length >= colCount
    const connected = () => configured ? interpreter.hardware.componentsOfType('keypad').find(part =>
      rows.slice(0, rowCount).every((pin, i) => String(part.rolePins[`r${i + 1}`]) === String(interpreter.hardware.resolvePin(toNumber(pin))))
      && cols.slice(0, colCount).every((pin, i) => String(part.rolePins[`c${i + 1}`]) === String(interpreter.hardware.resolvePin(toNumber(pin))))) : undefined
    const readKey = () => {
      const part = connected()
      const key = String(part?.state.key ?? '')
      if (!part || !key) return 0
      const physical = ['123A', '456B', '789C', '*0#D']
      const row = physical.findIndex(line => line.includes(key))
      const col = row < 0 ? -1 : physical[row].indexOf(key)
      if (row < 0 || col < 0 || row >= rowCount || col >= colCount) return 0
      interpreter.hardware.patchComponent(part.id, { key: '' })
      const mapped = keymap[row * colCount + col]
      return mapped === undefined ? 0 : typeof mapped === 'string' ? mapped.charCodeAt(0) : toNumber(mapped)
    }
    return new CObject('Keypad', {}, {
    getKey: readKey,
    waitForKey: async () => {
      for (;;) {
        const key = readKey()
        if (key) return key
        // Yield through the runtime so Stop remains responsive while waiting.
        await interpreter.delay(10)
      }
    },
    getState: () => 0,
    setDebounceTime: () => null,
    setHoldTime: () => null,
    })
  })
  interpreter.defineNative('makeKeymap', (args) => args[0] ?? new CArray([], { name: 'char' } as never))
}

function installHX711(interpreter: Interpreter) {
  interpreter.registerClass('HX711', () => {
    let scale = 1
    let offset = 0
    let dataPin: number | string | undefined
    let clockPin: number | string | undefined
    let sleeping = false
    const part = () => dataPin === undefined || clockPin === undefined || sleeping ? undefined
      : interpreter.hardware.componentsOfType('hx711').find((entry) => entry.powered
        && String(entry.rolePins.dt) === String(dataPin)
        && String(entry.rolePins.sck) === String(clockPin))
    // Same counts as the firmware model (HX711_COUNTS_PER_GRAM, zero offset):
    // a 5 kg cell at gain 128, so set_scale(420) gives grams on both engines.
    const raw = () => { const cell = part(); return cell ? Math.round(HX711_ZERO_OFFSET + stateNum(cell.state.weightGram, 0) * HX711_COUNTS_PER_GRAM) : 0 }
    return new CObject('HX711', {}, {
      begin: (args) => {
        dataPin = interpreter.hardware.resolvePin(int(args, 0))
        clockPin = interpreter.hardware.resolvePin(int(args, 1))
        sleeping = false
        return null
      },
      is_ready: () => part() ? 1 : 0,
      set_scale: (args) => {
        scale = dbl(args, 0, 1) || 1
        return null
      },
      set_offset: (args) => {
        offset = dbl(args, 0)
        return null
      },
      tare: () => {
        offset = raw()
        return null
      },
      read: () => raw(),
      get_units: () => (raw() - offset) / scale,
      get_value: () => raw() - offset,
      power_down: () => { sleeping = true; return null },
      power_up: () => { sleeping = false; return null },
    })
  })
}

/** MAX7219 chips per matrix part for one interpreter run (fresh at power-up, like the board). */
const matrixChains = new WeakMap<Interpreter, Map<string, Max7219Chain>>()

/** LedControl's charTable for setDigit/setChar (7-segment bit order dp,a,b,c,d,e,f,g). */
const LEDCONTROL_CHARS: Record<number, number> = {
  0: 0x7e, 1: 0x30, 2: 0x6d, 3: 0x79, 4: 0x33, 5: 0x5b, 6: 0x5f, 7: 0x70, 8: 0x7f, 9: 0x7b,
  10: 0x77, 11: 0x1f, 12: 0x0d, 13: 0x3d, 14: 0x4f, 15: 0x47,
  32: 0x00, 45: 0x01, 46: 0x80, 95: 0x08,
  65: 0x77, 66: 0x1f, 67: 0x0d, 68: 0x3d, 69: 0x4f, 70: 0x47, 72: 0x37, 76: 0x0e, 80: 0x67,
  97: 0x77, 98: 0x1f, 99: 0x0d, 100: 0x3d, 101: 0x4f, 102: 0x47, 104: 0x17, 108: 0x0e, 112: 0x67,
}

function installLedControl(interpreter: Interpreter) {
  // A port of LedControl.cpp: the same register writes (spiTransfer) go into
  // the same MAX7219 chain model the firmware engine decodes from the pins.
  interpreter.registerClass('LedControl', (constructorArgs) => {
    const data = interpreter.hardware.resolvePin(int(constructorArgs, 0))
    const clock = interpreter.hardware.resolvePin(int(constructorArgs, 1))
    const select = interpreter.hardware.resolvePin(int(constructorArgs, 2))
    let maxDevices = int(constructorArgs, 3, 1)
    if (maxDevices <= 0 || maxDevices > 8) maxDevices = 8
    const status = new Array(64).fill(0)
    let chains = matrixChains.get(interpreter)
    if (!chains) { chains = new Map(); matrixChains.set(interpreter, chains) }
    const chainOf = (part: SimComponentView) => {
      let chain = chains!.get(part.id)
      if (!chain) { chain = new Max7219Chain(part.type === 'led_matrix4' ? 4 : 1); chains!.set(part.id, chain) }
      return chain
    }
    const spiTransfer = (addr: number, opcode: number, value: number) => {
      const words = new Array(maxDevices).fill(0)
      words[addr] = ((opcode & 0xff) << 8) | (value & 0xff)
      for (const part of ['led_matrix', 'led_matrix4'].flatMap((type) => interpreter.hardware.componentsOfType(type))) {
        if (!part.powered || String(part.rolePins.din) !== String(data)
          || String(part.rolePins.clk) !== String(clock) || String(part.rolePins.cs) !== String(select)) continue
        const chain = chainOf(part)
        // shiftOut from the last device's bytes down to device 0, then LOAD.
        for (let i = maxDevices - 1; i >= 0; i--) chain.shiftWord(words[i])
        if (chain.load()) interpreter.hardware.patchComponent(part.id, matrixPatch(chain.states))
      }
    }
    const inRange = (addr: number) => addr >= 0 && addr < maxDevices
    const setLed = (addr: number, row: number, column: number, on: boolean) => {
      if (!inRange(addr) || row < 0 || row > 7 || column < 0 || column > 7) return
      const offset = addr * 8
      const bit = 0x80 >> column
      status[offset + row] = on ? status[offset + row] | bit : status[offset + row] & ~bit
      spiTransfer(addr, row + 1, status[offset + row])
    }
    const clearDisplay = (addr: number) => {
      if (!inRange(addr)) return
      for (let i = 0; i < 8; i++) { status[addr * 8 + i] = 0; spiTransfer(addr, i + 1, 0) }
    }
    const setDigit = (addr: number, digit: number, code: number, dp: boolean) => {
      if (!inRange(addr) || digit < 0 || digit > 7) return
      const pattern = (LEDCONTROL_CHARS[code] ?? 0) | (dp ? 0x80 : 0)
      status[addr * 8 + digit] = pattern
      spiTransfer(addr, digit + 1, pattern)
    }
    // Constructor: test off, scan limit 7, no decode, blank, and shutdown —
    // the sketch has to call shutdown(addr, false) to light the display.
    for (let i = 0; i < maxDevices; i++) {
      spiTransfer(i, 0x0f, 0)
      spiTransfer(i, 0x0b, 7)
      spiTransfer(i, 0x09, 0)
      clearDisplay(i)
      spiTransfer(i, 0x0c, 0)
    }
    return new CObject('LedControl', {}, {
      getDeviceCount: () => maxDevices,
      shutdown: (args) => { if (inRange(int(args, 0))) spiTransfer(int(args, 0), 0x0c, toNumber(args[1]) ? 0 : 1); return null },
      setScanLimit: (args) => { const limit = int(args, 1); if (inRange(int(args, 0)) && limit >= 0 && limit < 8) spiTransfer(int(args, 0), 0x0b, limit); return null },
      setIntensity: (args) => { const level = int(args, 1); if (inRange(int(args, 0)) && level >= 0 && level < 16) spiTransfer(int(args, 0), 0x0a, level); return null },
      clearDisplay: (args) => { clearDisplay(int(args, 0)); return null },
      setLed: (args) => { setLed(int(args, 0), int(args, 1), int(args, 2), Boolean(toNumber(args[3]))); return null },
      setRow: (args) => {
        const addr = int(args, 0), row = int(args, 1)
        if (!inRange(addr) || row < 0 || row > 7) return null
        status[addr * 8 + row] = int(args, 2) & 0xff
        spiTransfer(addr, row + 1, status[addr * 8 + row])
        return null
      },
      setColumn: (args) => {
        const addr = int(args, 0), col = int(args, 1), value = int(args, 2)
        if (!inRange(addr) || col < 0 || col > 7) return null
        for (let row = 0; row < 8; row++) setLed(addr, row, col, ((value >> (7 - row)) & 1) === 1)
        return null
      },
      setDigit: (args) => { const value = int(args, 2); if (value >= 0 && value <= 15) setDigit(int(args, 0), int(args, 1), value, Boolean(toNumber(args[3] ?? 0))); return null },
      setChar: (args) => {
        const raw = args[2] instanceof CChar ? args[2].code : int(args, 2)
        setDigit(int(args, 0), int(args, 1), raw > 127 ? 32 : raw, Boolean(toNumber(args[3] ?? 0)))
        return null
      },
    })
  })
}

function installNewPing(interpreter: Interpreter) {
  interpreter.registerClass('NewPing', (args) => {
    const trig = interpreter.hardware.resolvePin(int(args, 0))
    const echo = interpreter.hardware.resolvePin(int(args, 1))
    const maxDistance = Math.max(0, int(args, 2, 500))
    const distance = () => {
      const part = interpreter.hardware.componentOn('ultrasonic', trig, 'trig')
      if (!part?.powered || String(part.rolePins.echo) !== String(echo)) return 0
      const value = stateNum(part.state.distanceCm, 0)
      return value > 0 && value <= maxDistance ? value : 0
    }
    return new CObject('NewPing', {}, {
      ping_cm: () => Math.round(distance()),
      ping: () => Math.round(distance() * 58),
      ping_median: () => Math.round(distance() * 58),
      convert_cm: (a) => Math.round(int(a, 0) / 58),
    })
  })
}

function installRTC(interpreter: Interpreter) {
  const makeDateTime = (epoch: number) => {
    const date = new Date(epoch * 1000)
    return new CObject('DateTime', { epoch }, {
      year: () => date.getUTCFullYear(),
      month: () => date.getUTCMonth() + 1,
      day: () => date.getUTCDate(),
      hour: () => date.getUTCHours(),
      minute: () => date.getUTCMinutes(),
      second: () => date.getUTCSeconds(),
      dayOfTheWeek: () => date.getUTCDay(),
      unixtime: () => epoch,
      timestamp: () => date.toISOString(),
    })
  }
  const connected = () => interpreter.hardware.i2cWrite(0x68, []) === 0
  const rtcPart = () => connected() ? interpreter.hardware.componentsOfType('ds1307').find((entry) => entry.powered) : undefined
  const currentEpoch = () => {
    return rtcEpoch(rtcPart()?.state ?? {})
  }
  const rtc = () => new CObject('RTC', {}, {
    begin: () => rtcPart() ? 1 : 0,
    isrunning: () => rtcPart() ? 1 : 0,
    lostPower: () => 0,
    adjust: (args) => {
      const part = rtcPart()
      const value = args[0] instanceof CObject ? args[0].fields.epoch : undefined
      if (part && typeof value === 'number' && Number.isFinite(value)) interpreter.hardware.patchComponent(part.id, { epoch: value, epochSetAt: Date.now() })
      return null
    },
    now: () => makeDateTime(currentEpoch()),
    getTemperature: () => 27,
  })
  interpreter.registerClass('RTC_DS1307', rtc)
  interpreter.registerClass('RTC_DS3231', rtc)
  interpreter.registerClass('DateTime', (args) => {
    if (args.length >= 3) {
      let year = int(args, 0)
      if (year < 100) year += 2000
      return makeDateTime(Math.floor(Date.UTC(year, int(args, 1) - 1, int(args, 2), int(args, 3), int(args, 4), int(args, 5)) / 1000))
    }
    return makeDateTime(int(args, 0, Math.floor(Date.now() / 1000)))
  })
}

/** DS18B20 chips of one interpreter run, by part id, so their registers persist across calls. */
const ds18b20Chips = new WeakMap<Interpreter, Map<string, Ds18b20>>()

const UINT8: TypeInfo = { name: 'uint8_t', isConst: false, isStatic: false, isUnsigned: true, pointer: 0, isReference: false, templateArgs: [] }
const DEVICE_DISCONNECTED_C = -127
const DEVICE_DISCONNECTED_F = -196.6

function installOneWire(interpreter: Interpreter) {
  // The same DS18B20 model the firmware engine talks to (lib/oneWire.ts),
  // driven with the commands OneWire/DallasTemperature send, so enumeration
  // order, power-up 85 °C, resolution and conversion time all match.
  const chipsFor = () => {
    let chips = ds18b20Chips.get(interpreter)
    if (!chips) { chips = new Map(); ds18b20Chips.set(interpreter, chips) }
    return chips
  }
  const sensorsOn = (pin: number | string) => () => interpreter.hardware.componentsOfType('ds18b20')
    .filter((part) => part.powered && String(part.rolePins.data) === String(pin))
    .map((part) => {
      const chips = chipsFor()
      let chip = chips.get(part.id)
      if (!chip) {
        const id = part.id
        chip = new Ds18b20(id, () => stateNum(interpreter.hardware.componentsOfType('ds18b20').find((entry) => entry.id === id)?.state.temperature, 25))
        chips.set(id, chip)
      }
      return chip
    })
  const cycles = () => interpreter.micros() * 16
  const bytesOf = (value: Value | undefined, length = 8): number[] =>
    value instanceof CArray ? Array.from({ length }, (_, i) => Math.trunc(toNumber(value.elements[i] ?? 0)) & 0xff) : []
  const fill = (target: Value | undefined, bytes: number[]) => {
    if (target instanceof CArray) bytes.forEach((byte, i) => { if (i < target.elements.length) target.elements[i] = byte })
  }
  const crc = (args: Value[]) => crc8(bytesOf(args[0], int(args, 1, 8)), int(args, 1, 8))

  interpreter.registerClass('DeviceAddress', () => new CArray(Array.from({ length: 8 }, () => 0), UINT8))
  interpreter.defineNative('crc8', crc) // OneWire::crc8(addr, len)
  interpreter.defineGlobal('DEVICE_DISCONNECTED_C', DEVICE_DISCONNECTED_C)
  interpreter.defineGlobal('DEVICE_DISCONNECTED_F', DEVICE_DISCONNECTED_F)
  interpreter.defineGlobal('DEVICE_DISCONNECTED_RAW', -7040)

  /** OneWire objects by pin, so DallasTemperature(&oneWire) shares its bus. */
  const masters = new Map<number | string, OneWireMaster>()
  interpreter.registerClass('OneWire', (args) => {
    const pin = interpreter.hardware.resolvePin(int(args, 0, 2))
    const master = new OneWireMaster(sensorsOn(pin), cycles)
    masters.set(pin, master)
    return new CObject('OneWire', { pin }, {
      reset: () => master.reset(),
      select: (a) => { master.select(bytesOf(a[0])); return null },
      skip: () => { master.skip(); return null },
      write: (a) => { master.write(int(a, 0) & 0xff); return null },
      write_bytes: (a) => { bytesOf(a[0], int(a, 1)).forEach((byte) => master.write(byte)); return null },
      read: () => master.read(),
      read_bytes: (a) => { fill(a[0], Array.from({ length: int(a, 1) }, () => master.read())); return null },
      write_bit: (a) => { master.writeBit(int(a, 0) & 1); return null },
      read_bit: () => master.readBit(),
      depower: () => null,
      reset_search: () => { master.resetSearch(); return null },
      search: (a) => {
        const rom = master.search(a.length > 1 && !toNumber(a[1]))
        if (!rom) return 0
        fill(a[0], rom)
        return 1
      },
      crc8: crc,
    })
  })
  interpreter.registerClass('DallasTemperature', (args) => {
    const wire = args[0] instanceof CObject && args[0].className === 'OneWire' ? args[0] : undefined
    const pin = (wire?.fields.pin as number | string | undefined) ?? interpreter.hardware.resolvePin(2)
    const master = masters.get(pin) ?? new OneWireMaster(sensorsOn(pin), cycles)
    let parasite = false
    let bitResolution = 9
    let waitForConversion = true
    let checkForConversion = true
    let devices = 0

    const validAddress = (rom: number[]) => rom.length === 8 && crc8(rom, 7) === rom[7]
    const readScratchPad = (rom: number[]): number[] | null => {
      if (!master.reset()) return null
      master.select(rom)
      master.write(0xbe)
      const pad = Array.from({ length: 9 }, () => master.read())
      if (!master.reset()) return null
      return pad
    }
    const connected = (rom: number[]) => {
      const pad = readScratchPad(rom)
      return pad && pad.some((byte) => byte !== 0) && crc8(pad, 8) === pad[8] ? pad : null
    }
    const addressAt = (index: number): number[] | null => {
      master.resetSearch()
      let depth = 0
      for (let rom = master.search(); rom; rom = master.search()) {
        if (!validAddress(rom)) continue
        if (depth === index) return rom
        depth += 1
      }
      return null
    }
    const resolutionOf = (rom: number[]) => {
      const pad = connected(rom)
      return pad ? resolutionFromConfig(pad[4]) : 0
    }
    const readPowerSupply = (rom?: number[]) => {
      if (!master.reset()) return false
      if (rom) master.select(rom)
      else master.skip()
      master.write(0xb4)
      const parasitic = master.readBit() === 0
      master.reset()
      return parasitic
    }
    const setResolutionOf = async (rom: number[], bits: number) => {
      const pad = connected(rom)
      if (!pad) return false
      const config = [0x1f, 0x3f, 0x5f, 0x7f][Math.max(9, Math.min(12, bits)) - 9]
      if (pad[4] === config) return true
      master.reset()
      master.select(rom)
      master.write(0x4e)
      master.write(pad[2])
      master.write(pad[3])
      master.write(config)
      // autoSaveScratchPad: COPY SCRATCHPAD, then the library waits for the EEPROM write.
      master.reset()
      master.select(rom)
      master.write(0x48)
      await interpreter.delay(20)
      master.reset()
      return true
    }
    const conversionDone = () => master.readBit() === 1
    const block = async () => {
      if (checkForConversion && !parasite) {
        // Poll the busy bit like the library does (750 ms timeout).
        // (timed in µs: whole-ms millis() could end the wait just before the chip finishes)
        const start = interpreter.micros()
        while (!conversionDone() && interpreter.micros() - start < 750_000) await interpreter.delay(1)
      } else {
        await interpreter.delay([94, 188, 375, 750][bitResolution - 9] ?? 750)
      }
    }
    const request = async (rom?: number[]) => {
      master.reset()
      if (rom) master.select(rom)
      else master.skip()
      master.write(0x44)
      if (waitForConversion) await block()
      return 1
    }
    const celsiusOf = (rom: number[] | null) => {
      const pad = rom ? connected(rom) : null
      return pad ? ds18b20Celsius(pad[0] | (pad[1] << 8)) : DEVICE_DISCONNECTED_C
    }
    const toF = (celsius: number) => celsius <= DEVICE_DISCONNECTED_C ? DEVICE_DISCONNECTED_F : celsius * 1.8 + 32
    const romArg = (value: Value | undefined) => bytesOf(value)
    const begin = () => {
      devices = 0
      parasite = false
      master.resetSearch()
      for (let rom = master.search(); rom; rom = master.search()) {
        if (!validAddress(rom)) continue
        devices += 1
        if (!parasite && readPowerSupply(rom)) parasite = true
        bitResolution = Math.max(bitResolution, resolutionOf(rom))
      }
      return null
    }

    return new CObject('DallasTemperature', {}, {
      begin,
      getDeviceCount: () => devices,
      getDS18Count: () => devices,
      isParasitePowerMode: () => (parasite ? 1 : 0),
      readPowerSupply: (a) => (readPowerSupply(a.length ? romArg(a[0]) : undefined) ? 1 : 0),
      validAddress: (a) => (validAddress(romArg(a[0])) ? 1 : 0),
      validFamily: (a) => (romArg(a[0])[0] === 0x28 ? 1 : 0),
      isConnected: (a) => (connected(romArg(a[0])) ? 1 : 0),
      getAddress: (a) => {
        const rom = addressAt(int(a, 1))
        if (!rom) return 0
        fill(a[0], rom)
        return 1
      },
      getResolution: (a) => (a.length ? resolutionOf(romArg(a[0])) : bitResolution),
      setResolution: async (a) => {
        if (a.length >= 2) return (await setResolutionOf(romArg(a[0]), int(a, 1))) ? 1 : 0
        bitResolution = Math.max(9, Math.min(12, int(a, 0, 12)))
        for (let i = 0; i < devices; i++) {
          const rom = addressAt(i)
          if (rom) await setResolutionOf(rom, bitResolution)
        }
        return null
      },
      setWaitForConversion: (a) => { waitForConversion = !!toNumber(a[0] ?? 1); return null },
      getWaitForConversion: () => (waitForConversion ? 1 : 0),
      setCheckForConversion: (a) => { checkForConversion = !!toNumber(a[0] ?? 1); return null },
      getCheckForConversion: () => (checkForConversion ? 1 : 0),
      isConversionComplete: () => (conversionDone() ? 1 : 0),
      millisToWaitForConversion: (a) => [94, 188, 375, 750][Math.max(9, Math.min(12, int(a, 0, bitResolution))) - 9],
      requestTemperatures: () => request(),
      requestTemperaturesByIndex: async (a) => {
        const rom = addressAt(int(a, 0))
        return rom ? request(rom) : 0
      },
      requestTemperaturesByAddress: (a) => request(romArg(a[0])),
      getTempC: (a) => new CFloat(celsiusOf(romArg(a[0]))),
      getTempF: (a) => new CFloat(toF(celsiusOf(romArg(a[0])))),
      getTemp: (a) => {
        const celsius = celsiusOf(romArg(a[0]))
        return celsius <= DEVICE_DISCONNECTED_C ? -7040 : Math.round(celsius * 128)
      },
      getTempCByIndex: (a) => new CFloat(celsiusOf(addressAt(int(a, 0)))),
      getTempFByIndex: (a) => new CFloat(toF(celsiusOf(addressAt(int(a, 0))))),
      toFahrenheit: (a) => new CFloat(dbl(a, 0) * 1.8 + 32),
      toCelsius: (a) => new CFloat((dbl(a, 0) - 32) / 1.8),
    })
  })
}

function installMPU(interpreter: Interpreter) {
  interpreter.registerClass('MPU6050', () => {
    const connected = () => interpreter.hardware.i2cWrite(0x68, []) === 0
    const part = () => connected() ? interpreter.hardware.componentsOfType('mpu6050').find((entry) => entry.powered) : undefined
    const axis = (name: string, fallback = 0) => stateNum(part()?.state[name], fallback)
    return new CObject('MPU6050', {}, {
      initialize: () => null,
      begin: () => connected() ? 1 : 0,
      testConnection: () => connected() ? 1 : 0,
      getAccelerationX: () => Math.round(axis('ax') * 16384),
      getAccelerationY: () => Math.round(axis('ay') * 16384),
      getAccelerationZ: () => Math.round(axis('az', 1) * 16384),
      getRotationX: () => Math.round(axis('gx') * 131),
      getRotationY: () => Math.round(axis('gy') * 131),
      getRotationZ: () => Math.round(axis('gz') * 131),
      getTemperature: () => Math.round((axis('temperature', 27) - 36.53) * 340),
    })
  })
}

function installMFRC522(interpreter: Interpreter) {
  interpreter.registerClass('MFRC522', (args) => {
    const ss = interpreter.hardware.resolvePin(int(args, 0, 10))
    const rst = interpreter.hardware.resolvePin(int(args, 1, 9))
    let initialized = false
    let antenna = false
    let halted = false
    const part = () => interpreter.hardware.componentsOfType('rfid').find((entry) => entry.powered
      && spiWired(interpreter, entry, true)
      && String(entry.rolePins.sda ?? entry.rolePins.cs) === String(ss)
      && String(entry.rolePins.rst) === String(rst))
    const uidBytes = new CArray([], { name: 'byte' } as never)
    const uid = new CObject('Uid', { size: 0, uidByte: uidBytes, sak: 0 })
    const reader = new CObject('MFRC522', { uid }, {
      PCD_Init: () => { initialized = true; antenna = true; halted = false; return null },
      PCD_Reset: () => { initialized = false; antenna = false; halted = false; return null },
      PCD_AntennaOn: () => { antenna = true; return null },
      PCD_AntennaOff: () => { antenna = false; return null },
      PICC_IsNewCardPresent: () => {
        const present = part()?.state.cardPresent === true
        if (!present) halted = false
        return initialized && antenna && !halted && present ? 1 : 0
      },
      PICC_ReadCardSerial: () => {
        const readerPart = part()
        if (!initialized || !antenna || halted || !readerPart?.state.cardPresent) return 0
        const parsed = parseRfidUid(readerPart.state.uid ?? 'DE AD BE EF')
        if (!parsed) {
          uidBytes.elements = []
          uid.fields.size = 0
          interpreter.warn('RFID UID tidak valid: gunakan 4, 7, atau 10 byte heksadesimal.')
          return 0
        }
        uidBytes.elements = parsed
        uid.fields.size = uidBytes.elements.length
        return 1
      },
      PICC_HaltA: () => { halted = true; return null },
      PCD_StopCrypto1: () => null,
      PICC_GetType: () => 1,
      PICC_GetTypeName: () => 'MIFARE 1KB',
    })
    return reader
  })
}

function installSD(interpreter: Interpreter) {
  let chipSelect: number | string | undefined
  const part = () => chipSelect === undefined ? undefined : interpreter.hardware.componentsOfType('microsd').find((entry) => entry.powered
    && spiWired(interpreter, entry, true)
    && entry.state.mounted === true && String(entry.rolePins.cs) === String(chipSelect))
  const files = () => {
    const value = part()?.state.files
    return Array.isArray(value) ? value as Array<{ name?: string; content?: string }> : []
  }
  const makeFile = (name: string, initial: string, writable: boolean, valid: boolean) => {
    const deviceId = part()?.id
    let closed = false
    const accessible = () => {
      if (!valid || closed || deviceId === undefined || part()?.id !== deviceId) return false
      const file = files().find(entry => entry.name === name)
      if (!file) return false
      content = String(file.content ?? '')
      return true
    }
    let cursor = writable ? initial.length : 0
    let content = initial
    const persist = () => {
      const device = part()
      if (!device || closed || device.id !== deviceId) return
      const next = files().filter((entry) => entry.name !== name)
      next.push({ name, content })
      interpreter.hardware.patchComponent(device.id, { files: next })
    }
    const handle = new CObject('File', { name }, {
      available: () => accessible() ? Math.max(0, content.length - cursor) : 0,
      read: (args) => {
        if (!accessible()) return args.length ? 0 : -1
        if (args[0] instanceof CArray) {
          const buffer = args[0]
          const count = Math.max(0, Math.min(buffer.length, int(args, 1, buffer.length), content.length - cursor))
          for (let i = 0; i < count; i++) buffer.elements[i] = content.charCodeAt(cursor++) & 0xff
          return count
        }
        return cursor < content.length ? content.charCodeAt(cursor++) & 0xff : -1
      },
      peek: () => accessible() && cursor < content.length ? content.charCodeAt(cursor) : -1,
      size: () => accessible() ? content.length : 0,
      position: () => accessible() ? cursor : 0,
      seek: (args) => { const next = int(args, 0); if (!accessible() || next < 0 || next > content.length) return 0; cursor = next; return 1 },
      print: (args) => { if (!writable || !accessible()) return 0; const value = text(args, 0); content += value; cursor = content.length; persist(); return value.length },
      println: (args) => { if (!writable || !accessible()) return 0; const value = `${args.length ? text(args, 0) : ''}\n`; content += value; cursor = content.length; persist(); return value.length },
      write: (args) => {
        if (!writable || !accessible()) return 0
        const bytes = args[0] instanceof CArray ? args[0].elements.map(toNumber)
          : typeof args[0] === 'string' ? Array.from(args[0], char => char.charCodeAt(0)) : [int(args, 0)]
        const count = Math.max(0, Math.min(bytes.length, int(args, 1, bytes.length)))
        for (let i = 0; i < count; i++) content += String.fromCharCode(bytes[i] & 0xff)
        cursor = content.length
        persist()
        return count
      },
      flush: () => null,
      close: () => { closed = true; return null },
      isDirectory: () => 0,
    })
    handle.truthValue = accessible
    return handle
  }
  interpreter.defineGlobal('SD', new CObject('SDClass', {}, {
    begin: (args) => {
      chipSelect = interpreter.hardware.resolvePin(int(args, 0, 4))
      return part()?.state.mounted === true ? 1 : 0
    },
    exists: (args) => files().some((entry) => entry.name === text(args, 0)) ? 1 : 0,
    remove: (args) => {
      const device = part()
      if (!device) return 0
      const name = text(args, 0)
      if (!files().some(entry => entry.name === name)) return 0
      interpreter.hardware.patchComponent(device.id, { files: files().filter((entry) => entry.name !== name) })
      return 1
    },
    open: (args) => {
      const name = text(args, 0)
      const existing = files().find((entry) => entry.name === name)
      const writable = args.length > 1 && toDisplayString(args[1]) !== '0'
      const device = part()
      const valid = Boolean(device && name && (existing || writable))
      if (valid && writable && !existing && device) interpreter.hardware.patchComponent(device.id, { files: [...files(), { name, content: '' }] })
      return makeFile(name, String(existing?.content ?? ''), writable, valid)
    },
    cardType: () => part()?.state.mounted === true ? 2 : 0,
  }))
  interpreter.defineGlobal('FILE_READ', 0)
  interpreter.defineGlobal('FILE_WRITE', 1)
}

function installILI9341(interpreter: Interpreter) {
  const makeDisplay = (className: string, args: Value[]) => {
    const framebuffer = new ColorFramebuffer()
    const chipSelect = interpreter.hardware.resolvePin(int(args, 0, 10))
    const dataCommand = interpreter.hardware.resolvePin(int(args, 1, 9))
    const displays = () => interpreter.hardware.componentsOfType('tft_ili9341').filter((entry) => entry.powered
      && spiWired(interpreter, entry, false)
      && String(entry.rolePins.cs) === String(chipSelect)
      && String(entry.rolePins.dc) === String(dataCommand))
    const state = { lines: [''], cursor: [0, 0] as [number, number], textSize: 1, textColor: 0xffff, bgColor: 0x0000 }
    const textRuns: { text: string; x: number; y: number; size: number; color: number; rotation: number; background?: number }[] = []
    let textBackground: number | undefined
    let wrap = true
    const sync = () => {
      for (const display of displays()) {
        interpreter.hardware.patchComponent(display.id, { ...state, lines: [...state.lines], cursor: [...state.cursor], textRuns: textRuns.map(run => ({ ...run })), framebuffer: framebuffer.snapshot(), rotation: framebuffer.rotation })
      }
    }
    const print: NativeMethod = (args) => {
      const value = toDisplayString(args[0])
      for (const character of value) {
        if (character === '\r') continue
        if (character === '\n') {
          state.cursor = [0, state.cursor[1] + 8 * state.textSize]
          continue
        }
        if (wrap && state.cursor[0] + 6 * state.textSize > framebuffer.width) state.cursor = [0, state.cursor[1] + 8 * state.textSize]
        if (state.cursor[0] < framebuffer.width && state.cursor[1] < framebuffer.height
          && state.cursor[0] + 6 * state.textSize > 0 && state.cursor[1] + 8 * state.textSize > 0) {
          if (textRuns.length >= 16384) throw new Error('Batas teks TFT tercapai. Gunakan fillScreen() untuk membersihkan tampilan.')
          textRuns.push({ text: character, x: state.cursor[0], y: state.cursor[1], size: state.textSize, color: state.textColor, rotation: framebuffer.rotation,
            ...(textBackground !== undefined ? { background: textBackground } : {}) })
        }
        state.cursor[0] += 6 * state.textSize
      }
      state.lines[state.lines.length - 1] = ((state.lines[state.lines.length - 1] ?? '') + value).slice(-4096)
      sync()
      return value.length
    }
    return new CObject(className, {}, {
      begin: () => { sync(); return null },
      init: () => { sync(); return null },
      fillScreen: (args) => { state.bgColor = int(args, 0); framebuffer.fill(state.bgColor); state.lines = ['']; textRuns.length = 0; sync(); return null },
      setCursor: (args) => { state.cursor = [int(args, 0), int(args, 1)]; return null },
      setTextColor: (args) => { state.textColor = int(args, 0); textBackground = args.length > 1 ? int(args, 1) : undefined; return null },
      setTextSize: (args) => { state.textSize = Math.max(1, Math.min(16, int(args, 0, 1))); return null },
      setTextWrap: (args) => { wrap = Boolean(toNumber(args[0])); return null },
      getCursorX: () => state.cursor[0],
      getCursorY: () => state.cursor[1],
      setRotation: (args) => { framebuffer.rotation = int(args, 0) & 3; sync(); return null },
      print,
      println: (args) => { const length = args.length ? print(args) : 0; state.lines.push(''); if (state.lines.length > 40) state.lines.shift(); state.cursor = [0, state.cursor[1] + 8 * state.textSize]; sync(); return Number(length) + 1 },
      drawPixel: (args) => { framebuffer.pixel(int(args, 0), int(args, 1), int(args, 2)); sync(); return null },
      drawLine: (args) => { framebuffer.line(int(args, 0), int(args, 1), int(args, 2), int(args, 3), int(args, 4)); sync(); return null },
      drawRect: (args) => { framebuffer.rect(int(args, 0), int(args, 1), int(args, 2), int(args, 3), int(args, 4), false); sync(); return null },
      fillRect: (args) => { framebuffer.rect(int(args, 0), int(args, 1), int(args, 2), int(args, 3), int(args, 4), true); sync(); return null },
      width: () => framebuffer.width,
      height: () => framebuffer.height,
    })
  }
  interpreter.registerClass('Adafruit_ILI9341', (args) => makeDisplay('Adafruit_ILI9341', args))
  interpreter.registerClass('TFT_eSPI', (args) => makeDisplay('TFT_eSPI', args))
  interpreter.defineGlobal('ILI9341_BLACK', 0x0000)
  interpreter.defineGlobal('ILI9341_WHITE', 0xffff)
  interpreter.defineGlobal('ILI9341_RED', 0xf800)
  interpreter.defineGlobal('TFT_BLACK', 0x0000)
  interpreter.defineGlobal('TFT_WHITE', 0xffff)
}

// ------------------------------------------------------------
// Registry
// ------------------------------------------------------------

export const BUILTIN_LIBRARIES: SimLibrary[] = [
  {
    id: 'servo',
    name: 'Servo',
    author: 'Michael Margolis, Arduino',
    version: '1.2.2',
    category: 'Aktuator',
    description: 'Kendalikan servo hobi 0–180° lewat servo.write(). Termasuk ESP32Servo untuk papan ESP.',
    headers: ['Servo.h', 'ESP32Servo.h'],
    keywords: ['servo', 'motor', 'sg90', 'mg996', 'pwm'],
    types: ['Servo'],
    support: 'native',
    install: installServo,
  },
  {
    id: 'liquidcrystal-i2c',
    name: 'LiquidCrystal I2C',
    author: 'Frank de Brabander',
    version: '1.1.4',
    category: 'Display',
    description: 'LCD karakter 16×2 dan 20×4 lewat modul I2C PCF8574.',
    headers: ['LiquidCrystal_I2C.h'],
    keywords: ['lcd', 'i2c', '1602', '2004', 'display'],
    types: ['LiquidCrystal_I2C'],
    support: 'native',
    install: (interpreter) => {
      interpreter.registerClass('LiquidCrystal_I2C', (args) => {
        const cols = Math.max(1, Math.min(40, int(args, 1, 16)))
        const rows = Math.max(1, Math.min(4, int(args, 2, 2)))
        return makeCharacterDisplay(interpreter, 'LiquidCrystal_I2C', rows > 2 ? ['lcd2004', 'lcd'] : ['lcd', 'lcd2004'], cols, rows, int(args, 0, 0x27) & 0x7f)
      })
    },
  },
  {
    id: 'liquidcrystal',
    name: 'LiquidCrystal',
    author: 'Arduino',
    version: '1.0.7',
    category: 'Display',
    description: 'LCD karakter dengan kabel paralel RS/EN/D4–D7.',
    headers: ['LiquidCrystal.h'],
    keywords: ['lcd', 'parallel', 'hd44780'],
    types: ['LiquidCrystal'],
    support: 'native',
    install: (interpreter) => {
      interpreter.registerClass('LiquidCrystal', () => makeCharacterDisplay(interpreter, 'LiquidCrystal', ['lcd', 'lcd2004'], 16, 2))
    },
  },
  {
    id: 'adafruit-neopixel',
    name: 'Adafruit NeoPixel',
    author: 'Adafruit',
    version: '1.12.3',
    category: 'Display',
    description: 'LED RGB addressable WS2812/WS2811 — satu pin data untuk banyak LED.',
    headers: ['Adafruit_NeoPixel.h'],
    keywords: ['neopixel', 'ws2812', 'rgb', 'led', 'strip'],
    types: ['Adafruit_NeoPixel'],
    support: 'native',
    install: installNeoPixel,
  },
  {
    id: 'adafruit-ssd1306',
    name: 'Adafruit SSD1306',
    author: 'Adafruit',
    version: '2.5.13',
    category: 'Display',
    description: 'OLED 128×64 I2C dengan API Adafruit_GFX.',
    headers: ['Adafruit_SSD1306.h', 'Adafruit_GFX.h'],
    keywords: ['oled', 'ssd1306', 'gfx', 'display', '128x64'],
    types: ['Adafruit_SSD1306', 'Adafruit_GFX'],
    support: 'native',
    install: installSSD1306,
  },
  {
    id: 'dht-sensor',
    name: 'DHT sensor library',
    author: 'Adafruit',
    version: '1.4.6',
    category: 'Sensor',
    description: 'Baca suhu dan kelembapan dari DHT11, DHT22, dan AM2302.',
    headers: ['DHT.h', 'DHT_U.h'],
    keywords: ['dht', 'dht11', 'dht22', 'suhu', 'kelembapan', 'temperature', 'humidity'],
    types: ['DHT'],
    support: 'native',
    install: installDHT,
  },
  {
    id: 'wire',
    name: 'Wire (I2C)',
    author: 'Arduino',
    version: 'core',
    category: 'Komunikasi',
    description: 'Bus I2C bawaan core Arduino.',
    headers: ['Wire.h'],
    keywords: ['i2c', 'twi', 'wire'],
    types: [],
    support: 'native',
    install: installWire,
  },
  {
    id: 'spi',
    name: 'SPI',
    author: 'Arduino',
    version: 'core',
    category: 'Komunikasi',
    description: 'Bus SPI bawaan core Arduino.',
    headers: ['SPI.h'],
    keywords: ['spi', 'mosi', 'miso'],
    types: ['SPISettings', 'SPIClass'],
    support: 'native',
    install: installSPI,
  },
  {
    id: 'eeprom',
    name: 'EEPROM',
    author: 'Arduino',
    version: 'core',
    category: 'Penyimpanan',
    description: 'Penyimpanan non-volatile. Di simulator isinya bertahan selama sesi berjalan.',
    headers: ['EEPROM.h'],
    keywords: ['eeprom', 'simpan', 'storage', 'nvs'],
    types: [],
    support: 'native',
    install: installEEPROM,
  },
  {
    id: 'wifi',
    name: 'WiFi',
    author: 'Espressif',
    version: 'core',
    category: 'Komunikasi',
    description: 'Koneksi WiFi ESP32/ESP8266. Disimulasikan: selalu tersambung, tanpa trafik jaringan nyata.',
    headers: ['WiFi.h', 'ESP8266WiFi.h', 'WiFiClient.h', 'WiFiMulti.h'],
    keywords: ['wifi', 'esp32', 'esp8266', 'network', 'iot'],
    types: ['WiFiClass', 'WiFiClient', 'WiFiServer'],
    support: 'stub',
    boards: ['esp32', 'esp32-s3', 'esp32-s2', 'esp32-c3', 'esp32-c6', 'esp8266'],
    install: installWiFi,
  },
  {
    id: 'softwareserial',
    name: 'SoftwareSerial',
    author: 'Arduino',
    version: 'core',
    category: 'Komunikasi',
    description: 'UART software di pin digital mana pun.',
    headers: ['SoftwareSerial.h'],
    keywords: ['serial', 'uart', 'software'],
    types: ['SoftwareSerial'],
    support: 'stub',
    install: installSoftwareSerial,
  },
  {
    id: 'stepper',
    name: 'Stepper',
    author: 'Arduino',
    version: '1.1.3',
    category: 'Aktuator',
    description: 'Motor stepper unipolar dan bipolar, termasuk 28BYJ-48.',
    headers: ['Stepper.h'],
    keywords: ['stepper', 'motor', '28byj', 'uln2003'],
    types: ['Stepper'],
    support: 'native',
    install: installStepper,
  },
  {
    id: 'keypad',
    name: 'Keypad',
    author: 'Mark Stanley, Alexander Brevig',
    version: '3.1.1',
    category: 'Input',
    description: 'Keypad matriks 3×4 dan 4×4.',
    headers: ['Keypad.h'],
    keywords: ['keypad', 'matrix', 'tombol', 'button'],
    types: ['Keypad'],
    support: 'native',
    install: installKeypad,
  },
  {
    id: 'hx711',
    name: 'HX711',
    author: 'Bogdan Necula',
    version: '0.7.5',
    category: 'Sensor',
    description: 'ADC 24-bit untuk load cell timbangan.',
    headers: ['HX711.h'],
    keywords: ['hx711', 'load cell', 'timbangan', 'berat', 'scale'],
    types: ['HX711'],
    support: 'native',
    install: installHX711,
  },
  {
    id: 'ledcontrol',
    name: 'LedControl',
    author: 'Eberhard Fahle',
    version: '1.0.6',
    category: 'Display',
    description: 'Dot matrix dan 7-segment berbasis MAX7219/MAX7221.',
    headers: ['LedControl.h'],
    keywords: ['max7219', 'matrix', 'dot matrix', '7 segment'],
    types: ['LedControl'],
    support: 'native',
    install: installLedControl,
  },
  {
    id: 'newping',
    name: 'NewPing',
    author: 'Tim Eckel',
    version: '1.9.7',
    category: 'Sensor',
    description: 'Sensor jarak ultrasonik HC-SR04 tanpa pulseIn yang lambat.',
    headers: ['NewPing.h'],
    keywords: ['ultrasonic', 'hc-sr04', 'jarak', 'distance', 'sonar'],
    types: ['NewPing'],
    support: 'native',
    install: installNewPing,
  },
  {
    id: 'rtclib',
    name: 'RTClib',
    author: 'Adafruit',
    version: '2.1.4',
    category: 'Utilitas',
    description: 'Real-time clock DS1307 dan DS3231.',
    headers: ['RTClib.h'],
    keywords: ['rtc', 'ds1307', 'ds3231', 'jam', 'waktu', 'clock'],
    types: ['RTC_DS1307', 'RTC_DS3231', 'DateTime'],
    support: 'native',
    install: installRTC,
  },
  {
    id: 'onewire',
    name: 'OneWire + DallasTemperature',
    author: 'Paul Stoffregen, Miles Burton',
    version: '3.9.1',
    category: 'Sensor',
    description: 'Bus 1-Wire dan sensor suhu DS18B20.',
    headers: ['OneWire.h', 'DallasTemperature.h'],
    keywords: ['onewire', 'ds18b20', 'suhu', 'temperature'],
    types: ['OneWire', 'DallasTemperature', 'DeviceAddress'],
    support: 'native',
    install: installOneWire,
  },
  {
    id: 'mpu6050',
    name: 'MPU6050',
    author: 'Jeff Rowberg',
    version: '1.0.0',
    category: 'Sensor',
    description: 'Akselerometer dan giroskop 6 sumbu lewat I2C.',
    headers: ['MPU6050.h', 'MPU6050_light.h'],
    keywords: ['mpu6050', 'gyro', 'accelerometer', 'imu'],
    types: ['MPU6050'],
    support: 'native',
    install: installMPU,
  },
  {
    id: 'mfrc522',
    name: 'MFRC522',
    author: 'GithubCommunity',
    version: '1.4.12',
    category: 'Sensor',
    description: 'Pembaca kartu RFID RC522 lewat SPI.',
    headers: ['MFRC522.h'],
    keywords: ['rfid', 'rc522', 'mifare'],
    types: ['MFRC522'],
    support: 'native',
    install: installMFRC522,
  },
  {
    id: 'sd',
    name: 'SD',
    author: 'Arduino',
    version: 'core',
    category: 'Penyimpanan',
    description: 'Kartu MicroSD dengan berkas yang bertahan selama sesi simulasi.',
    headers: ['SD.h', 'FS.h'],
    keywords: ['sd', 'microsd', 'file', 'storage'],
    types: ['File'],
    support: 'native',
    install: installSD,
  },
  {
    id: 'ili9341',
    name: 'ILI9341 / TFT_eSPI',
    author: 'Adafruit, Bodmer',
    version: 'sim',
    category: 'Display',
    description: 'Layar TFT ILI9341 240×320 lewat SPI.',
    headers: ['Adafruit_ILI9341.h', 'TFT_eSPI.h'],
    keywords: ['tft', 'ili9341', 'display', 'spi'],
    types: ['Adafruit_ILI9341', 'TFT_eSPI'],
    support: 'native',
    install: installILI9341,
  },
]

export const BUILTIN_BY_HEADER = new Map<string, SimLibrary>()
for (const library of BUILTIN_LIBRARIES) {
  for (const header of library.headers) BUILTIN_BY_HEADER.set(header.toLowerCase(), library)
}
