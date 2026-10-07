// ============================================================
// KodyUno — runtime values
//
// The interpreter keeps C values in the closest JS shape: numbers stay
// numbers, `String` and `char*` are JS strings, arrays and objects are
// reference types so pointer-ish semantics work without real pointers.
// ============================================================
import type { Param, Stmt, TypeInfo } from './ast'

export type Value =
  | number
  | string
  | boolean
  | CChar
  | CFloat
  | CArray
  | CObject
  | CFunction
  | null
  | undefined

/**
 * A `char`. It has to stay distinct from a plain number because Arduino
 * prints it as a character: `Serial.print(c)` and `str += c` append a
 * letter, while arithmetic on it still works on the code point.
 */
export class CChar {
  code: number

  constructor(code: number) {
    this.code = code
  }
}

/** A variable slot. Passing the slot itself is how `int &x` params work. */
export interface Slot {
  value: Value
  type: TypeInfo
  isConst: boolean
}

/**
 * A number whose C type is float/double, handed to print()/String(). JS has
 * one number type, so 25.0 would otherwise print as "25"; Arduino prints
 * floats with decimals ("25.00") even when they are whole.
 */
export class CFloat {
  value: number

  constructor(value: number) {
    this.value = value
  }
}

export class CArray {
  elements: Value[]
  elemType: TypeInfo

  constructor(elements: Value[], elemType: TypeInfo) {
    this.elements = elements
    this.elemType = elemType
  }

  get length(): number {
    return this.elements.length
  }
}

export type NativeMethod = (args: Value[]) => Value | Promise<Value>

/** A library instance or a user struct/class value. */
export class CObject {
  /** Synchronous boolean conversion for native resource handles. */
  truthValue?: () => boolean
  className: string
  fields: Record<string, Value>
  methods: Record<string, NativeMethod>

  constructor(className: string, fields: Record<string, Value> = {}, methods: Record<string, NativeMethod> = {}) {
    this.className = className
    this.fields = fields
    this.methods = methods
  }
}

export interface CFunction {
  __fn: true
  name: string
  params: Param[]
  body: Stmt[]
  /** Bound receiver for methods declared inside a user class. */
  self?: CObject
}

export type NativeFunction = (args: Value[]) => Value | Promise<Value>

export function isCallable(value: Value): value is CFunction {
  return typeof value === 'object' && value !== null && (value as CFunction).__fn === true
}

// ------------------------------------------------------------
// Conversions
// ------------------------------------------------------------

export function toNumber(value: Value): number {
  if (value instanceof CObject && value.truthValue) return value.truthValue() ? 1 : 0
  if (typeof value === 'number') return value
  if (value instanceof CFloat) return value.value
  if (value instanceof CChar) return value.code
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (value instanceof CArray) return value.length
  if (value === null || value === undefined) return 0
  return 1
}

export function toBool(value: Value): boolean {
  if (typeof value === 'string') return value.length > 0
  if (value instanceof CChar) return value.code !== 0
  return toNumber(value) !== 0
}

/**
 * `double` is 32-bit on AVR (Uno/Nano/Mega) and 64-bit on ESP. Set per run
 * from the board, so float printing rounds like the target's core does.
 */
let singlePrecisionDouble = true
export function setDoubleIsFloat(single: boolean) { singlePrecisionDouble = single }

/**
 * Arduino core `Print::printFloat` (AVR and ESP32 cores share it): add half a
 * unit of the last digit, then peel digits off with repeated ×10, all in the
 * target's double. On AVR that is single precision, so 23.375 prints "23.37".
 */
export function printFloat(value: number, digits = 2): string {
  const d = singlePrecisionDouble ? Math.fround : (x: number) => x
  let number = d(value)
  if (Number.isNaN(number)) return 'nan'
  if (!Number.isFinite(number)) return 'inf'
  if (number > 4294967040.0 || number < -4294967040.0) return 'ovf'
  let out = ''
  if (number < 0) { out = '-'; number = -number }
  let rounding = d(0.5)
  for (let i = 0; i < digits; i++) rounding = d(rounding / 10)
  number = d(number + rounding)
  const intPart = Math.trunc(number)
  let remainder = d(number - intPart)
  out += String(intPart)
  if (digits > 0) out += '.'
  for (let i = 0; i < digits; i++) {
    remainder = d(remainder * 10)
    const digit = Math.trunc(remainder)
    out += String(digit)
    remainder = d(remainder - digit)
  }
  return out
}

/** How `print(value)` renders it on a Print stream (Serial, LCD, OLED). */
export function printText(value: Value, digits = 2): string {
  if (value instanceof CFloat) return printFloat(value.value, digits)
  if (typeof value === 'number' && !Number.isInteger(value)) return printFloat(value, digits)
  return toDisplayString(value, digits)
}

/** How a value prints through Serial.print or String concatenation. */
export function toDisplayString(value: Value, digits = 2): string {
  if (typeof value === 'string') return value
  if (value instanceof CChar) return value.code === 0 ? '' : String.fromCharCode(value.code)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof CFloat) {
    if (!Number.isFinite(value.value)) return Number.isNaN(value.value) ? 'nan' : value.value > 0 ? 'inf' : '-inf'
    return value.value.toFixed(digits)
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf'
    return value.toFixed(digits)
  }
  if (value instanceof CArray) {
    return value.elements.map((item) => toDisplayString(item, digits)).join('')
  }
  if (value instanceof CObject) return `<${value.className}>`
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Wrap a number into the range of an n-bit integer. */
export function truncateInt(value: number, bits: number, unsigned: boolean): number {
  if (bits <= 0) return value
  const truncated = Math.trunc(value)
  if (bits === 1) return truncated === 0 ? 0 : 1
  const span = 2 ** bits
  let wrapped = ((truncated % span) + span) % span
  if (!unsigned && wrapped >= span / 2) wrapped -= span
  return wrapped
}

/** Default value for a freshly declared variable of a given type. */
export function defaultValueFor(type: TypeInfo): Value {
  if (type.pointer > 0) return null
  switch (type.name) {
    case 'String':
      return ''
    case 'char':
      return new CChar(0)
    case 'float':
    case 'double':
      return 0
    case 'bool':
    case 'boolean':
      return false
    case 'void':
      return null
    default:
      return 0
  }
}
