// ============================================================
// KodyUno — C++ AST
//
// A deliberately small tree: enough to run Arduino sketches faithfully
// without modelling the whole language. Types are kept as descriptors
// rather than a type system — the interpreter uses them for integer
// truncation, array sizing, and picking a library class to construct.
// ============================================================

export interface TypeInfo {
  /** Base name after dropping const/static/unsigned qualifiers: 'int', 'String', 'Servo'. */
  name: string
  isConst: boolean
  isStatic: boolean
  isUnsigned: boolean
  /** Levels of pointer indirection; `char*` is 1. */
  pointer: number
  isReference: boolean
  /** Template arguments, e.g. the `int` in `std::vector<int>` — kept, not used. */
  templateArgs: TypeInfo[]
}

export type Node = Stmt | Expr

// ---------- expressions ----------

export type Expr =
  | { kind: 'num'; value: number; isInt: boolean; isChar?: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; name: string; line: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'logical'; op: '&&' | '||'; left: Expr; right: Expr }
  | { kind: 'unary'; op: string; operand: Expr; line: number }
  | { kind: 'update'; op: '++' | '--'; target: Expr; prefix: boolean }
  | { kind: 'assign'; op: string; target: Expr; value: Expr; line: number }
  | { kind: 'ternary'; cond: Expr; then: Expr; other: Expr }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number }
  | { kind: 'member'; object: Expr; property: string; arrow: boolean; line: number }
  | { kind: 'index'; array: Expr; index: Expr; line: number }
  | { kind: 'cast'; type: TypeInfo; operand: Expr }
  | { kind: 'initList'; items: Expr[] }
  | { kind: 'sizeof'; type?: TypeInfo; operand?: Expr }
  | { kind: 'comma'; items: Expr[] }

// ---------- statements ----------

export interface VarDeclarator {
  name: string
  /** null = plain variable, number = fixed size, 'auto' = size from initialiser. */
  arraySize: Expr | null | 'auto'
  /** Extra dimensions for `int grid[2][3]`. */
  extraDims: (Expr | null)[]
  init: Expr | null
  /** Constructor arguments: `Servo s(9);` and `LiquidCrystal_I2C lcd(0x27,16,2);`. */
  ctorArgs: Expr[] | null
}

export interface Param {
  type: TypeInfo
  name: string
  isArray: boolean
  defaultValue: Expr | null
}

export type Stmt =
  | { kind: 'varDecl'; type: TypeInfo; declarators: VarDeclarator[]; line: number }
  | { kind: 'funcDecl'; name: string; returnType: TypeInfo; params: Param[]; body: Stmt[] | null; line: number }
  | { kind: 'structDecl'; name: string; fields: { type: TypeInfo; name: string }[]; typedefName: string | null }
  | { kind: 'enumDecl'; entries: { name: string; value: number }[] }
  | { kind: 'classDecl'; name: string; members: Stmt[] }
  | { kind: 'block'; body: Stmt[] }
  | { kind: 'if'; cond: Expr; then: Stmt; other: Stmt | null }
  | { kind: 'while'; cond: Expr; body: Stmt }
  | { kind: 'doWhile'; cond: Expr; body: Stmt }
  | { kind: 'for'; init: Stmt | null; cond: Expr | null; update: Expr | null; body: Stmt }
  | { kind: 'forEach'; declType: TypeInfo; name: string; iterable: Expr; body: Stmt }
  | { kind: 'switch'; disc: Expr; cases: { test: Expr | null; body: Stmt[] }[] }
  | { kind: 'return'; value: Expr | null; line: number }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'expr'; expr: Expr; line: number }
  | { kind: 'empty' }

export interface Program {
  body: Stmt[]
}

export const VOID_TYPE: TypeInfo = {
  name: 'void',
  isConst: false,
  isStatic: false,
  isUnsigned: false,
  pointer: 0,
  isReference: false,
  templateArgs: [],
}

export function makeType(name: string, overrides: Partial<TypeInfo> = {}): TypeInfo {
  return { ...VOID_TYPE, name, ...overrides }
}

/** Integer-ish base types get truncated on assignment. */
const INTEGER_TYPES = new Set([
  'int', 'long', 'short', 'char', 'byte', 'bool', 'boolean', 'size_t', 'word',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'unsigned', 'signed',
])

export function isIntegerType(type: TypeInfo): boolean {
  return type.pointer === 0 && INTEGER_TYPES.has(type.name)
}

/** Bit width used when truncating an assignment, or 0 for "leave alone". */
export function typeBits(type: TypeInfo): number {
  switch (type.name) {
    case 'bool':
    case 'boolean':
      return 1
    case 'char':
    case 'byte':
    case 'int8_t':
    case 'uint8_t':
      return 8
    case 'short':
    case 'int16_t':
    case 'uint16_t':
    case 'word':
      return 16
    case 'int':
    case 'int32_t':
    case 'uint32_t':
    case 'long':
    case 'unsigned':
    case 'signed':
    case 'size_t':
      return 32
    default:
      return 0
  }
}
