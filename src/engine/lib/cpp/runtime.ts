// ============================================================
// KodyUno — C++ interpreter
//
// Walks the AST from parser.ts. Everything runs in the browser tab: there
// is no compile server, so a sketch costs the user's own CPU and nothing
// else. Execution is async so `delay()` can yield to the browser and the
// canvas keeps animating while the sketch runs.
//
// Time model: one virtual microsecond per real microsecond, multiplied by
// the speed setting. `millis()`, `micros()` and `delay()` all read the same
// clock, so timing-based sketches (blink-without-delay, debounce) behave.
// ============================================================
import {
  isIntegerType,
  typeBits,
  type Expr,
  type Param,
  type Stmt,
  type TypeInfo,
} from './ast'
import {
  CArray,
  CChar,
  CObject,
  defaultValueFor,
  CFloat,
  isCallable,
  toBool,
  toDisplayString,
  toNumber,
  truncateInt,
  type CFunction,
  type NativeFunction,
  type Slot,
  type Value,
} from './values'
import type { Hardware, PinMode } from './hardware'

export class RuntimeError extends Error {
  readonly line?: number

  constructor(message: string, line?: number) {
    super(line ? `${message} (baris ${line})` : message)
    this.name = 'RuntimeError'
    this.line = line
  }
}

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  value: Value

  constructor(value: Value) {
    this.value = value
  }
}
export class StopSignal {}

const BREAK = new BreakSignal()
const CONTINUE = new ContinueSignal()

// ------------------------------------------------------------
// Scopes
// ------------------------------------------------------------

/** <math.h> functions and Arduino macros whose result is a double. */
const FLOAT_FUNCTIONS = new Set(['sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10',
  'fabs', 'floor', 'ceil', 'fmod', 'fmin', 'fmax', 'hypot', 'cbrt', 'trunc', 'radians', 'degrees', 'sq'])
/** Library methods that return float/double in their real headers. */
const FLOAT_METHODS = new Set(['readTemperature', 'readHumidity', 'computeHeatIndex', 'get_units', 'get_value',
  'getTempCByIndex', 'getTempFByIndex', 'getTempC', 'getTempF', 'toFloat', 'toDouble', 'getAngleX', 'getAngleY', 'getAngleZ',
  'getAccX', 'getAccY', 'getAccZ', 'getGyroX', 'getGyroY', 'getGyroZ', 'getTemp', 'readPressure', 'readAltitude',
  'getTemperature', 'getHumidity', 'readTempC', 'readTempF', 'readLightLevel', 'getKelvin', 'getCelsius'])

class Env {
  private slots = new Map<string, Slot>()
  readonly parent: Env | null

  constructor(parent: Env | null = null) {
    this.parent = parent
  }

  declare(name: string, slot: Slot) {
    this.slots.set(name, slot)
  }

  /** Share an existing slot under a new name — how reference params bind. */
  bind(name: string, slot: Slot) {
    this.slots.set(name, slot)
  }

  find(name: string): Slot | undefined {
    let env: Env | null = this
    while (env) {
      const slot = env.slots.get(name)
      if (slot) return slot
      env = env.parent
    }
    return undefined
  }

  hasLocal(name: string): boolean {
    return this.slots.has(name)
  }
}

/** An assignable location: a variable slot, an array cell, or an object field. */
interface Place {
  get(): Value
  set(value: Value): void
  type?: TypeInfo
}

// ------------------------------------------------------------
// Interpreter
// ------------------------------------------------------------

export interface InterpreterOptions {
  hardware: Hardware
  /** Wall-clock multiplier: 1 = real time, 10 = ten times faster. */
  speed?: number
  /** Called when the sketch prints to Serial. */
  onSerial?: (text: string) => void
  /** Called for simulator-level warnings (bad pin, unsupported call). */
  onWarning?: (text: string) => void
}

const YIELD_CHECK_OPS = 256
/** Longest the interpreter may hold the main thread before yielding. */
const BUSY_BUDGET_MS = 6
const MAX_FRAME_DEPTH = 200

export class Interpreter {
  readonly globals = new Env()
  readonly hardware: Hardware
  speed: number

  private onSerial: (text: string) => void
  private onWarning: (text: string) => void
  private stopped = false
  private startWall = 0
  private opCounter = 0
  private lastYield = 0
  private frameDepth = 0
  /** Interrupt handlers registered through attachInterrupt(). */
  private interrupts = new Map<string, { fn: Value; mode: string; last: number }>()
  /** Warnings already reported, so a loop cannot flood the serial monitor. */
  private warnedOnce = new Set<string>()
  private yieldChannel: MessageChannel | null = null
  private yieldWaiters: (() => void)[] = []

  constructor(options: InterpreterOptions) {
    this.hardware = options.hardware
    this.speed = options.speed ?? 1
    this.onSerial = options.onSerial ?? (() => {})
    this.onWarning = options.onWarning ?? (() => {})
  }

  // ---------- clock ----------

  /** Simulated microseconds since the sketch started. */
  micros(): number {
    return Math.round((performance.now() - this.startWall) * 1000 * this.speed)
  }

  millis(): number {
    return Math.floor(this.micros() / 1000)
  }

  stop() {
    this.stopped = true
    this.yieldChannel?.port1.close()
    this.yieldChannel?.port2.close()
    this.yieldChannel = null
    for (const resolve of this.yieldWaiters.splice(0)) resolve()
  }

  get isStopped(): boolean {
    return this.stopped
  }

  private async sleepReal(ms: number) {
    if (ms <= 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Hand the main thread back so the browser can lay out and paint.
   *
   * A MessagePort task is used instead of setTimeout because browsers clamp
   * timers to roughly one per second in a background tab — with setTimeout a
   * sketch would crawl to a stop the moment the student switched tabs. Port
   * messages are ordinary tasks, so the page still gets to render between
   * them when it is visible.
   */
  private yieldToHost(): Promise<void> {
    if (!this.yieldChannel) {
      if (typeof MessageChannel === 'undefined') {
        return new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        const waiting = this.yieldWaiters
        this.yieldWaiters = []
        for (const resolve of waiting) resolve()
      }
      this.yieldChannel = channel
    }
    return new Promise<void>((resolve) => {
      this.yieldWaiters.push(resolve)
      this.yieldChannel!.port2.postMessage(0)
    })
  }

  /** Give the browser a slice back, and honour a stop request. */
  private async tick() {
    if (this.stopped) throw new StopSignal()
    if (++this.opCounter < YIELD_CHECK_OPS) return
    this.opCounter = 0
    const now = performance.now()
    if (now - this.lastYield < BUSY_BUDGET_MS) return
    this.lastYield = now
    await this.yieldToHost()
    this.lastYield = performance.now()
    if (this.stopped) throw new StopSignal()
  }

  warn(message: string, once = true) {
    if (once) {
      if (this.warnedOnce.has(message)) return
      this.warnedOnce.add(message)
    }
    this.onWarning(message)
  }

  print(text: string) {
    this.onSerial(text)
    this.hardware.serialWrite(text)
  }

  // ---------- program ----------

  /**
   * Hoist every global declaration and function, then run setup() once and
   * loop() until stopped. Returns when the sketch is stopped or throws.
   */
  async run(program: { body: Stmt[] }) {
    this.stopped = false
    this.startWall = performance.now()
    this.lastYield = this.startWall

    // functions first so a global initialiser may call one
    for (const stmt of program.body) {
      if (stmt.kind === 'funcDecl' && stmt.body) this.declareFunction(stmt, this.globals)
      if (stmt.kind === 'classDecl') this.declareClass(stmt)
      if (stmt.kind === 'enumDecl') {
        for (const entry of stmt.entries) {
          this.globals.declare(entry.name, { value: entry.value, type: { ...INT_TYPE }, isConst: true })
        }
      }
    }

    for (const stmt of program.body) {
      if (stmt.kind === 'funcDecl' || stmt.kind === 'classDecl' || stmt.kind === 'enumDecl') continue
      await this.exec(stmt, this.globals)
    }

    const setup = this.globals.find('setup')
    const loop = this.globals.find('loop')
    if (!setup && !loop) {
      throw new RuntimeError('Sketch tidak punya setup() maupun loop()')
    }

    try {
      if (setup && isCallable(setup.value)) await this.callFunction(setup.value, [])
      while (!this.stopped) {
        if (loop && isCallable(loop.value)) await this.callFunction(loop.value, [])
        else break
        await this.pumpInterrupts()
        // A sketch whose loop() returns immediately would otherwise never
        // reach the op-count yield, so give the browser a frame every pass.
        await this.yieldToHost()
        this.lastYield = performance.now()
        if (this.stopped) break
      }
    } catch (error) {
      if (error instanceof StopSignal) return
      throw error
    }
  }

  // ---------- declarations ----------

  private declareFunction(stmt: Extract<Stmt, { kind: 'funcDecl' }>, env: Env) {
    const fn: CFunction = { __fn: true, name: stmt.name, params: stmt.params, body: stmt.body ?? [] }
    env.declare(stmt.name, { value: fn, type: stmt.returnType, isConst: true })
  }

  private userClasses = new Map<string, Extract<Stmt, { kind: 'classDecl' }>>()

  private declareClass(stmt: Extract<Stmt, { kind: 'classDecl' }>) {
    this.userClasses.set(stmt.name, stmt)
  }

  private structs = new Map<string, { type: TypeInfo; name: string }[]>()

  // ---------- statements ----------

  async exec(stmt: Stmt, env: Env): Promise<void> {
    await this.tick()
    switch (stmt.kind) {
      case 'empty':
        return
      case 'block': {
        const scope = new Env(env)
        for (const inner of stmt.body) await this.exec(inner, scope)
        return
      }
      case 'expr':
        await this.eval(stmt.expr, env)
        return
      case 'varDecl':
        await this.execVarDecl(stmt, env)
        return
      case 'funcDecl':
        if (stmt.body) this.declareFunction(stmt, env)
        return
      case 'structDecl':
        this.structs.set(stmt.name, stmt.fields)
        if (stmt.typedefName) this.structs.set(stmt.typedefName, stmt.fields)
        return
      case 'classDecl':
        this.declareClass(stmt)
        return
      case 'enumDecl':
        for (const entry of stmt.entries) {
          env.declare(entry.name, { value: entry.value, type: { ...INT_TYPE }, isConst: true })
        }
        return
      case 'if':
        if (toBool(await this.eval(stmt.cond, env))) await this.exec(stmt.then, env)
        else if (stmt.other) await this.exec(stmt.other, env)
        return
      case 'while':
        while (toBool(await this.eval(stmt.cond, env))) {
          try {
            await this.exec(stmt.body, env)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (!(signal instanceof ContinueSignal)) throw signal
          }
          await this.tick()
        }
        return
      case 'doWhile':
        do {
          try {
            await this.exec(stmt.body, env)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (!(signal instanceof ContinueSignal)) throw signal
          }
          await this.tick()
        } while (toBool(await this.eval(stmt.cond, env)))
        return
      case 'for': {
        const scope = new Env(env)
        if (stmt.init) await this.exec(stmt.init, scope)
        while (stmt.cond === null || toBool(await this.eval(stmt.cond, scope))) {
          try {
            await this.exec(stmt.body, scope)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (!(signal instanceof ContinueSignal)) throw signal
          }
          if (stmt.update) await this.eval(stmt.update, scope)
          await this.tick()
        }
        return
      }
      case 'forEach': {
        const iterable = await this.eval(stmt.iterable, env)
        const items = iterable instanceof CArray ? iterable.elements
          : typeof iterable === 'string' ? [...iterable].map((c) => c.charCodeAt(0))
          : []
        for (const item of items) {
          const scope = new Env(env)
          scope.declare(stmt.name, { value: item, type: stmt.declType, isConst: false })
          try {
            await this.exec(stmt.body, scope)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (!(signal instanceof ContinueSignal)) throw signal
          }
          await this.tick()
        }
        return
      }
      case 'switch': {
        const disc = toNumber(await this.eval(stmt.disc, env))
        const scope = new Env(env)
        let matched = -1
        for (let i = 0; i < stmt.cases.length; i++) {
          const test = stmt.cases[i].test
          if (test && toNumber(await this.eval(test, scope)) === disc) {
            matched = i
            break
          }
        }
        if (matched < 0) matched = stmt.cases.findIndex((entry) => entry.test === null)
        if (matched < 0) return
        try {
          // C switch falls through until a break
          for (let i = matched; i < stmt.cases.length; i++) {
            for (const inner of stmt.cases[i].body) await this.exec(inner, scope)
          }
        } catch (signal) {
          if (!(signal instanceof BreakSignal)) throw signal
        }
        return
      }
      case 'return':
        throw new ReturnSignal(stmt.value ? await this.eval(stmt.value, env) : null)
      case 'break':
        throw BREAK
      case 'continue':
        throw CONTINUE
    }
  }

  private async execVarDecl(stmt: Extract<Stmt, { kind: 'varDecl' }>, env: Env) {
    for (const declarator of stmt.declarators) {
      // ---- array ----
      if (declarator.arraySize !== null) {
        let elements: Value[] = []
        if (declarator.init && declarator.init.kind === 'initList') {
          for (const item of declarator.init.items) elements.push(await this.eval(item, env))
        } else if (declarator.init && declarator.init.kind === 'str') {
          elements = [...declarator.init.value].map((c) => new CChar(c.charCodeAt(0)))
          elements.push(new CChar(0))
        }
        if (declarator.arraySize !== 'auto') {
          const size = Math.max(0, Math.trunc(toNumber(await this.eval(declarator.arraySize, env))))
          while (elements.length < size) elements.push(defaultValueFor(stmt.type))
          elements.length = Math.max(size, elements.length)
        }
        env.declare(declarator.name, {
          value: new CArray(elements, stmt.type),
          type: stmt.type,
          isConst: stmt.type.isConst,
        })
        continue
      }

      // ---- copy-initialised: `String s = "hi"`, `Servo a = b` ----
      if (declarator.init) {
        const initial = await this.eval(declarator.init, env)
        env.declare(declarator.name, {
          value: initial instanceof CObject ? initial : this.coerce(initial, stmt.type),
          type: stmt.type,
          isConst: stmt.type.isConst,
        })
        continue
      }

      // ---- library / user class instance ----
      const constructed = await this.constructIfClass(stmt.type, declarator.ctorArgs ?? [], env)
      if (constructed !== undefined) {
        env.declare(declarator.name, { value: constructed, type: stmt.type, isConst: false })
        continue
      }

      // ---- plain variable ----
      let value: Value
      if (declarator.ctorArgs && declarator.ctorArgs.length === 1) {
        value = this.coerce(await this.eval(declarator.ctorArgs[0], env), stmt.type)
      } else {
        value = defaultValueFor(stmt.type)
      }
      env.declare(declarator.name, { value, type: stmt.type, isConst: stmt.type.isConst })
    }
  }

  /** Build a library object or a user struct/class, or undefined if the type is plain. */
  private async constructIfClass(type: TypeInfo, args: Expr[], env: Env): Promise<Value | undefined> {
    if (type.pointer > 0) return undefined

    const factory = this.classFactories.get(type.name)
    if (factory) {
      const values: Value[] = []
      for (const arg of args) values.push(await this.eval(arg, env))
      return factory(values)
    }

    const userClass = this.userClasses.get(type.name)
    if (userClass) {
      const instance = new CObject(type.name)
      const classEnv = new Env(this.globals)
      classEnv.declare('this', { value: instance, type, isConst: true })
      for (const member of userClass.members) {
        if (member.kind === 'varDecl') {
          for (const declarator of member.declarators) {
            instance.fields[declarator.name] = declarator.init
              ? this.coerce(await this.eval(declarator.init, classEnv), member.type)
              : defaultValueFor(member.type)
          }
        }
        if (member.kind === 'funcDecl' && member.body) {
          const fn: CFunction = { __fn: true, name: member.name, params: member.params, body: member.body, self: instance }
          instance.fields[`__method_${member.name}`] = fn
        }
      }
      const ctor = instance.fields[`__method_${type.name}`]
      if (isCallable(ctor)) {
        const values: Value[] = []
        for (const arg of args) values.push(await this.eval(arg, env))
        await this.callFunction(ctor, values)
      }
      return instance
    }

    const structFields = this.structs.get(type.name)
    if (structFields) {
      const instance = new CObject(type.name)
      for (const field of structFields) instance.fields[field.name] = defaultValueFor(field.type)
      return instance
    }

    return undefined
  }

  /** Library classes registered by the library layer. */
  readonly classFactories = new Map<string, (args: Value[]) => Value>()

  // ---------- calls ----------

  async callFunction(fn: CFunction, args: Value[], argPlaces: (Place | null)[] = []): Promise<Value> {
    if (++this.frameDepth > MAX_FRAME_DEPTH) {
      this.frameDepth--
      throw new RuntimeError('Rekursi terlalu dalam — cek fungsi yang memanggil dirinya sendiri')
    }
    const scope = new Env(this.globals)
    if (fn.self) {
      // Inside a method, member names resolve without `this->`, so every
      // field and sibling method is bound to a slot backed by the object.
      const self = fn.self
      scope.declare('this', { value: self, type: { ...INT_TYPE }, isConst: true })
      for (const key of Object.keys(self.fields)) {
        const isMethod = key.startsWith('__method_')
        const name = isMethod ? key.slice('__method_'.length) : key
        scope.bind(name, {
          get value() {
            return self.fields[key]
          },
          set value(next: Value) {
            self.fields[key] = next
          },
          type: { ...INT_TYPE },
          isConst: isMethod,
        } as Slot)
      }
    }

    fn.params.forEach((param: Param, index) => {
      const place = argPlaces[index]
      // `int &x` shares the caller's storage, everything else copies
      if (param.type.isReference && place) {
        scope.bind(param.name, {
          get value() {
            return place.get()
          },
          set value(next: Value) {
            place.set(next)
          },
          type: param.type,
          isConst: false,
        } as Slot)
        return
      }
      const raw = index < args.length ? args[index] : undefined
      const value = raw === undefined
        ? defaultValueFor(param.type)
        : param.isArray || param.type.pointer > 0
          ? raw
          : this.coerce(raw, param.type)
      scope.declare(param.name, { value, type: param.type, isConst: false })
    })

    try {
      for (const stmt of fn.body) await this.exec(stmt, scope)
      return null
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value
      throw signal
    } finally {
      this.frameDepth--
    }
  }

  // ---------- expressions ----------

  async eval(expr: Expr, env: Env): Promise<Value> {
    switch (expr.kind) {
      case 'num':
        return expr.isChar ? new CChar(expr.value) : expr.value
      case 'str':
        return expr.value
      case 'ident': {
        const slot = env.find(expr.name)
        if (!slot) throw new RuntimeError(`'${expr.name}' belum dideklarasikan`, expr.line)
        return slot.value
      }
      case 'initList': {
        const items: Value[] = []
        for (const item of expr.items) items.push(await this.eval(item, env))
        return new CArray(items, { ...INT_TYPE })
      }
      case 'comma': {
        let last: Value = null
        for (const item of expr.items) last = await this.eval(item, env)
        return last
      }
      case 'cast': {
        const value = await this.eval(expr.operand, env)
        return this.coerce(value, expr.type)
      }
      case 'sizeof': {
        if (expr.type) return sizeOfType(expr.type, this.hardware.board.arch === 'avr')
        const value = expr.operand ? await this.eval(expr.operand, env) : 0
        if (value instanceof CArray) return value.length * sizeOfType(value.elemType, this.hardware.board.arch === 'avr')
        if (typeof value === 'string') return value.length + 1
        return 2
      }
      case 'logical': {
        const left = toBool(await this.eval(expr.left, env))
        if (expr.op === '&&') return left ? (toBool(await this.eval(expr.right, env)) ? 1 : 0) : 0
        return left ? 1 : toBool(await this.eval(expr.right, env)) ? 1 : 0
      }
      case 'ternary':
        return toBool(await this.eval(expr.cond, env))
          ? this.eval(expr.then, env)
          : this.eval(expr.other, env)
      case 'binary': {
        const left = await this.eval(expr.left, env)
        const right = await this.eval(expr.right, env)
        return applyBinary(expr.op, left, right, expr.line)
      }
      case 'unary':
        return this.evalUnary(expr, env)
      case 'update': {
        const place = await this.place(expr.target, env)
        const before = toNumber(place.get())
        const after = expr.op === '++' ? before + 1 : before - 1
        place.set(place.type ? this.coerce(after, place.type) : after)
        return expr.prefix ? after : before
      }
      case 'assign':
        return this.evalAssign(expr, env)
      case 'index': {
        const target = await this.eval(expr.array, env)
        const index = Math.trunc(toNumber(await this.eval(expr.index, env)))
        if (target instanceof CArray) {
          if (index < 0 || index >= target.elements.length) {
            this.warn(`Index array ${index} di luar batas (panjang ${target.elements.length})`)
            return 0
          }
          return target.elements[index]
        }
        if (typeof target === 'string') return new CChar(target.charCodeAt(index) || 0)
        return 0
      }
      case 'member':
        return this.evalMember(expr, env)
      case 'call':
        return this.evalCall(expr, env)
    }
  }

  private async evalUnary(expr: Extract<Expr, { kind: 'unary' }>, env: Env): Promise<Value> {
    // `&x` yields the value itself: arrays and objects are already references
    if (expr.op === '&') return this.eval(expr.operand, env)
    if (expr.op === '*') {
      const value = await this.eval(expr.operand, env)
      return value instanceof CArray ? value.elements[0] ?? 0 : value
    }
    const value = await this.eval(expr.operand, env)
    switch (expr.op) {
      case '!':
        return toBool(value) ? 0 : 1
      case '-':
        return -toNumber(value)
      case '+':
        return toNumber(value)
      case '~':
        return ~Math.trunc(toNumber(value))
      default:
        throw new RuntimeError(`Operator '${expr.op}' belum didukung`, expr.line)
    }
  }

  private async evalAssign(expr: Extract<Expr, { kind: 'assign' }>, env: Env): Promise<Value> {
    const place = await this.place(expr.target, env)
    let value = await this.eval(expr.value, env)
    if (expr.op !== '=') {
      const op = expr.op.slice(0, -1)
      value = applyBinary(op, place.get(), value, expr.line)
    }
    const coerced = place.type ? this.coerce(value, place.type) : value
    place.set(coerced)
    return coerced
  }

  /** Resolve an lvalue to something readable and writable. */
  private async place(expr: Expr, env: Env): Promise<Place> {
    if (expr.kind === 'ident') {
      const slot = env.find(expr.name)
      if (!slot) throw new RuntimeError(`'${expr.name}' belum dideklarasikan`, expr.line)
      if (slot.isConst) throw new RuntimeError(`'${expr.name}' bersifat const dan tidak bisa diubah`, expr.line)
      return {
        get: () => slot.value,
        set: (value) => {
          slot.value = value
        },
        type: slot.type,
      }
    }
    if (expr.kind === 'index') {
      const target = await this.eval(expr.array, env)
      const index = Math.trunc(toNumber(await this.eval(expr.index, env)))
      if (target instanceof CArray) {
        return {
          get: () => target.elements[index],
          set: (value) => {
            if (index < 0) return
            target.elements[index] = value
          },
          type: target.elemType,
        }
      }
      return { get: () => 0, set: () => {} }
    }
    if (expr.kind === 'member') {
      const object = await this.eval(expr.object, env)
      if (object instanceof CObject) {
        return {
          get: () => object.fields[expr.property],
          set: (value) => {
            object.fields[expr.property] = value
          },
        }
      }
      return { get: () => 0, set: () => {} }
    }
    if (expr.kind === 'unary' && expr.op === '*') {
      return this.place(expr.operand, env)
    }
    throw new RuntimeError('Sisi kiri tanda "=" bukan variabel yang bisa diisi')
  }

  private async evalMember(expr: Extract<Expr, { kind: 'member' }>, env: Env): Promise<Value> {
    const object = await this.eval(expr.object, env)
    if (object instanceof CObject) {
      if (expr.property in object.fields) return object.fields[expr.property]
      const method = object.methods[expr.property]
      if (method) return method([])
      const userMethod = object.fields[`__method_${expr.property}`]
      if (userMethod !== undefined) return userMethod
      return 0
    }
    if (object instanceof CArray && expr.property === 'length') return object.length
    if (typeof object === 'string') {
      const result = callStringMethod(object, expr.property, [])
      if (result !== undefined) return result.value
    }
    return 0
  }

  private async evalCall(expr: Extract<Expr, { kind: 'call' }>, env: Env): Promise<Value> {
    // ---- method call: obj.method(args) ----
    if (expr.callee.kind === 'member') {
      const memberExpr = expr.callee
      const object = await this.eval(memberExpr.object, env)
      const args: Value[] = []
      for (const arg of expr.args) args.push(await this.eval(arg, env))
      if (memberExpr.property === 'print' || memberExpr.property === 'println') this.markFloats(expr.args, args, env)

      if (object instanceof CObject) {
        const native = object.methods[memberExpr.property]
        if (native) return native(args)
        const userMethod = object.fields[`__method_${memberExpr.property}`]
        if (isCallable(userMethod)) return this.callFunction(userMethod, args)
        this.warn(`Method '${memberExpr.property}' tidak tersedia pada ${object.className}`)
        return 0
      }

      if (typeof object === 'string') {
        const result = callStringMethod(object, memberExpr.property, args)
        if (result) {
          if (result.mutated !== undefined) {
            try {
              const place = await this.place(memberExpr.object, env)
              place.set(result.mutated)
            } catch {
              // calling a mutating method on a temporary is harmless here
            }
          }
          return result.value
        }
        this.warn(`String tidak punya method '${memberExpr.property}'`)
        return 0
      }

      if (object instanceof CArray) {
        if (memberExpr.property === 'size' || memberExpr.property === 'length') return object.length
      }
      this.warn(`Method '${memberExpr.property}' dipanggil pada nilai yang bukan objek`)
      return 0
    }

    // ---- plain call ----
    if (expr.callee.kind !== 'ident') {
      const callee = await this.eval(expr.callee, env)
      if (isCallable(callee)) {
        const args: Value[] = []
        for (const arg of expr.args) args.push(await this.eval(arg, env))
        return this.callFunction(callee, args)
      }
      throw new RuntimeError('Yang dipanggil bukan fungsi', expr.line)
    }

    const name = expr.callee.name

    // constructing a temporary: `String(x)`, `Servo()`
    const slot = env.find(name)
    if (!slot) {
      const factory = this.classFactories.get(name)
      if (factory) {
        const args: Value[] = []
        for (const arg of expr.args) args.push(await this.eval(arg, env))
        if (name === 'String') this.markFloats(expr.args, args, env)
        return factory(args)
      }
      throw new RuntimeError(`Fungsi '${name}' tidak dikenal`, expr.line)
    }

    const args: Value[] = []
    const places: (Place | null)[] = []
    for (const arg of expr.args) {
      args.push(await this.eval(arg, env))
      places.push(await this.tryPlace(arg, env))
    }

    if (isCallable(slot.value)) return this.callFunction(slot.value, args, places)
    if (typeof slot.value === 'function') return (slot.value as unknown as NativeFunction)(args)
    throw new RuntimeError(`'${name}' bukan fungsi`, expr.line)
  }

  /** Box the first argument when its C type is floating point (see CFloat). */
  private markFloats(exprs: Expr[], args: Value[], env: Env) {
    if (exprs.length && typeof args[0] === 'number' && this.isFloatExpr(exprs[0], env)) args[0] = new CFloat(args[0])
  }

  /** Static type check: does this expression have type float/double in C? */
  private isFloatExpr(expr: Expr, env: Env): boolean {
    const floatType = (type?: TypeInfo) => !!type && type.pointer === 0 && (type.name === 'float' || type.name === 'double')
    switch (expr.kind) {
      case 'num': return !expr.isInt && !expr.isChar
      case 'ident': return floatType(env.find(expr.name)?.type)
      case 'cast': return floatType(expr.type)
      case 'unary': return (expr.op === '-' || expr.op === '+') && this.isFloatExpr(expr.operand, env)
      case 'binary': return ['+', '-', '*', '/'].includes(expr.op) && (this.isFloatExpr(expr.left, env) || this.isFloatExpr(expr.right, env))
      case 'ternary': return this.isFloatExpr(expr.then, env) || this.isFloatExpr(expr.other, env)
      case 'assign': return this.isFloatExpr(expr.target, env)
      case 'index': return expr.array.kind === 'ident' && floatType(env.find(expr.array.name)?.type)
      case 'call': {
        if (expr.callee.kind === 'ident') {
          if (FLOAT_FUNCTIONS.has(expr.callee.name)) return true
          const slot = env.find(expr.callee.name)
          return !!slot && isCallable(slot.value) && floatType(slot.type)
        }
        return expr.callee.kind === 'member' && FLOAT_METHODS.has(expr.callee.property)
      }
      default: return false
    }
  }

  private async tryPlace(expr: Expr, env: Env): Promise<Place | null> {
    if (expr.kind !== 'ident' && expr.kind !== 'index' && expr.kind !== 'member') return null
    try {
      return await this.place(expr, env)
    } catch {
      return null
    }
  }

  // ---------- helpers exposed to the standard library ----------

  /** Apply a declared type to a value: integer truncation, String coercion. */
  coerce(value: Value, type: TypeInfo): Value {
    if (type.pointer > 0) return value
    if (type.name === 'String') return typeof value === 'string' ? value : toDisplayString(value)
    if (type.name === 'float' || type.name === 'double') return toNumber(value)
    if (type.name === 'bool' || type.name === 'boolean') return toBool(value)
    if (type.name === 'char') return new CChar(truncateInt(toNumber(value), 8, type.isUnsigned))
    if (isIntegerType(type)) {
      const bits = typeBits(type) || 32
      const width = type.name === 'int' || type.name === 'unsigned' ? this.intBits() : bits
      return truncateInt(toNumber(value), width, type.isUnsigned)
    }
    return value
  }

  /** `int` is 16-bit on AVR and 32-bit everywhere else KodyUno simulates. */
  intBits(): number {
    return this.hardware.board.arch === 'avr' ? 16 : 32
  }

  defineGlobal(name: string, value: Value, isConst = true) {
    this.globals.declare(name, { value, type: { ...INT_TYPE }, isConst })
  }

  defineNative(name: string, fn: NativeFunction) {
    // native functions are stored as raw JS functions and detected on call
    this.globals.declare(name, { value: fn as unknown as Value, type: { ...INT_TYPE }, isConst: true })
  }

  registerClass(name: string, factory: (args: Value[]) => Value) {
    this.classFactories.set(name, factory)
  }

  // ---------- delays & interrupts ----------

  async delay(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) {
      await this.tick()
      return
    }
    const realMs = ms / this.speed
    const deadline = performance.now() + realMs
    // Sliced so stop() lands quickly even on a long delay. Waits shorter than
    // a timer's practical resolution yield through the message channel, which
    // also keeps the timing honest in a background tab.
    while (performance.now() < deadline) {
      if (this.stopped) throw new StopSignal()
      const remaining = deadline - performance.now()
      if (remaining > 20) await this.sleepReal(Math.min(remaining - 5, 25))
      else await this.yieldToHost()
      await this.pumpInterrupts()
    }
  }

  async delayMicroseconds(us: number) {
    const realMs = us / 1000 / this.speed
    if (realMs < 1) {
      // too short to sleep on: burn it against the simulated clock instead
      await this.tick()
      return
    }
    await this.delay(us / 1000)
  }

  attachInterrupt(pin: number | string, handler: Value, mode: string) {
    this.interrupts.set(String(pin), { fn: handler, mode, last: this.hardware.digitalRead(pin) })
  }

  detachInterrupt(pin: number | string) {
    this.interrupts.delete(String(pin))
  }

  /** Run any pin-change handlers whose condition became true. */
  private async pumpInterrupts() {
    if (this.interrupts.size === 0) return
    for (const [pin, entry] of this.interrupts) {
      const current = this.hardware.digitalRead(pin)
      if (current === entry.last) continue
      const rising = entry.last === 0 && current === 1
      const falling = entry.last === 1 && current === 0
      entry.last = current
      const fire =
        entry.mode === 'CHANGE' ||
        (entry.mode === 'RISING' && rising) ||
        (entry.mode === 'FALLING' && falling) ||
        (entry.mode === 'LOW' && current === 0)
      if (fire && isCallable(entry.fn)) await this.callFunction(entry.fn, [])
    }
  }
}

const INT_TYPE: TypeInfo = {
  name: 'int',
  isConst: false,
  isStatic: false,
  isUnsigned: false,
  pointer: 0,
  isReference: false,
  templateArgs: [],
}

function sizeOfType(type: TypeInfo, avr: boolean): number {
  if (type.pointer > 0) return avr ? 2 : 4
  switch (type.name) {
    case 'bool':
    case 'boolean':
    case 'char':
    case 'byte':
    case 'int8_t':
    case 'uint8_t':
      return 1
    case 'short':
    case 'int16_t':
    case 'uint16_t':
    case 'word':
      return 2
    case 'int':
    case 'size_t':
      return avr ? 2 : 4
    case 'long':
    case 'float':
    case 'int32_t':
    case 'uint32_t':
      return 4
    case 'double':
      return avr ? 4 : 8
    default:
      return 2
  }
}

// ------------------------------------------------------------
// Operators
// ------------------------------------------------------------

function applyBinary(op: string, left: Value, right: Value, line?: number): Value {
  // String concatenation wins whenever either side is textual
  if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
    return toDisplayString(left) + toDisplayString(right)
  }
  if (typeof left === 'string' && typeof right === 'string') {
    switch (op) {
      case '==': return left === right ? 1 : 0
      case '!=': return left !== right ? 1 : 0
      case '<': return left < right ? 1 : 0
      case '>': return left > right ? 1 : 0
      case '<=': return left <= right ? 1 : 0
      case '>=': return left >= right ? 1 : 0
    }
  }

  const a = toNumber(left)
  const b = toNumber(right)
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': {
      if (b === 0) return 0
      const bothInt = Number.isInteger(a) && Number.isInteger(b)
      return bothInt ? Math.trunc(a / b) : a / b
    }
    case '%': return b === 0 ? 0 : Math.trunc(a) % Math.trunc(b)
    case '<<': return Math.trunc(a) * 2 ** Math.trunc(b)
    case '>>': return Math.floor(Math.trunc(a) / 2 ** Math.trunc(b))
    case '<': return a < b ? 1 : 0
    case '>': return a > b ? 1 : 0
    case '<=': return a <= b ? 1 : 0
    case '>=': return a >= b ? 1 : 0
    case '==': return a === b ? 1 : 0
    case '!=': return a !== b ? 1 : 0
    case '&': return Math.trunc(a) & Math.trunc(b)
    case '|': return Math.trunc(a) | Math.trunc(b)
    case '^': return Math.trunc(a) ^ Math.trunc(b)
    default:
      throw new RuntimeError(`Operator '${op}' belum didukung`, line)
  }
}

// ------------------------------------------------------------
// Arduino String methods
// ------------------------------------------------------------

/**
 * Arduino's String mutates in place for trim/toUpperCase/…; the caller
 * writes `mutated` back into the original variable when there is one.
 */
export function callStringMethod(
  self: string,
  name: string,
  args: Value[],
): { value: Value; mutated?: string } | undefined {
  const arg = (i: number) => args[i]
  const num = (i: number) => Math.trunc(toNumber(args[i]))
  const text = (i: number) => toDisplayString(args[i])

  switch (name) {
    case 'length': return { value: self.length }
    case 'charAt': return { value: new CChar(self.charCodeAt(num(0)) || 0) }
    case 'setCharAt': {
      const index = num(0)
      const char = String.fromCharCode(num(1))
      const next = self.slice(0, index) + char + self.slice(index + 1)
      return { value: null, mutated: next }
    }
    case 'substring': {
      const start = num(0)
      const end = args.length > 1 ? num(1) : undefined
      return { value: self.substring(start, end) }
    }
    case 'indexOf': return { value: self.indexOf(text(0), args.length > 1 ? num(1) : 0) }
    case 'lastIndexOf': return { value: self.lastIndexOf(text(0)) }
    case 'startsWith': return { value: self.startsWith(text(0)) ? 1 : 0 }
    case 'endsWith': return { value: self.endsWith(text(0)) ? 1 : 0 }
    case 'equals': return { value: self === text(0) ? 1 : 0 }
    case 'equalsIgnoreCase': return { value: self.toLowerCase() === text(0).toLowerCase() ? 1 : 0 }
    case 'compareTo': return { value: self < text(0) ? -1 : self > text(0) ? 1 : 0 }
    case 'toInt': return { value: Math.trunc(parseFloat(self)) || 0 }
    case 'toFloat':
    case 'toDouble': return { value: parseFloat(self) || 0 }
    case 'trim': return { value: null, mutated: self.trim() }
    case 'toUpperCase': return { value: null, mutated: self.toUpperCase() }
    case 'toLowerCase': return { value: null, mutated: self.toLowerCase() }
    case 'replace': return { value: null, mutated: self.split(text(0)).join(text(1)) }
    case 'remove': {
      const start = num(0)
      const count = args.length > 1 ? num(1) : self.length - start
      return { value: null, mutated: self.slice(0, start) + self.slice(start + count) }
    }
    case 'concat': return { value: null, mutated: self + toDisplayString(arg(0)) }
    case 'c_str': return { value: self }
    case 'isEmpty': return { value: self.length === 0 ? 1 : 0 }
    case 'reserve': return { value: null }
    default:
      return undefined
  }
}
