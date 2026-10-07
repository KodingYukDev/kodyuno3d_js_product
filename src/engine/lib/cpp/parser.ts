// ============================================================
// KodyUno — C++ parser
//
// Recursive-descent parser over the token stream, producing the AST in
// ast.ts. It covers the slice of C++ that Arduino sketches and simple
// libraries live in: declarations, functions, structs/enums/classes,
// full expression precedence, and every loop form.
//
// Declarations and expressions are told apart with a type-name table that
// grows as structs, classes, typedefs and library types are discovered.
// ============================================================
import { CppSyntaxError, type Token } from './lexer'
import {
  makeType,
  VOID_TYPE,
  type Expr,
  type Param,
  type Program,
  type Stmt,
  type TypeInfo,
  type VarDeclarator,
} from './ast'

const BASE_TYPES = new Set([
  'void', 'bool', 'boolean', 'char', 'byte', 'short', 'int', 'long', 'float', 'double',
  'signed', 'unsigned', 'size_t', 'word', 'String',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'auto',
])

const QUALIFIERS = new Set(['const', 'static', 'volatile', 'extern', 'inline', 'register', 'constexpr', 'PROGMEM', 'virtual', 'explicit', 'friend'])

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='])

/** Binary operator precedence, highest binds tightest. */
const BINARY_PRECEDENCE: Record<string, number> = {
  '*': 10, '/': 10, '%': 10,
  '+': 9, '-': 9,
  '<<': 8, '>>': 8,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '==': 6, '!=': 6,
  '&': 5,
  '^': 4,
  '|': 3,
}

export interface ParseOptions {
  /** Extra type names known up front — library classes, mostly. */
  knownTypes?: Iterable<string>
}

export function parse(tokens: Token[], options: ParseOptions = {}): Program {
  const types = new Set<string>([...BASE_TYPES, ...(options.knownTypes ?? [])])
  let pos = 0

  // ---------- token helpers ----------
  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)]
  const at = (value: string, offset = 0) => peek(offset).value === value && peek(offset).type !== 'str'
  const atType = (type: Token['type'], offset = 0) => peek(offset).type === type
  const next = (): Token => tokens[pos++]
  const eat = (value: string): boolean => {
    if (at(value)) {
      pos++
      return true
    }
    return false
  }
  const expect = (value: string): Token => {
    if (!at(value)) {
      const token = peek()
      throw new CppSyntaxError(`Diharapkan '${value}' tapi menemukan '${token.value || 'akhir file'}'`, token.line, token.col)
    }
    return next()
  }
  const isDone = () => peek().type === 'eof'

  // ---------- types ----------

  const looksLikeTypeName = (token: Token) => token.type === 'ident' && types.has(token.value)

  /** True when the tokens at `pos` open a declaration rather than an expression. */
  function atDeclaration(): boolean {
    let i = 0
    let sawType = false
    while (QUALIFIERS.has(peek(i).value)) i++
    if (at('struct', i) || at('class', i) || at('enum', i) || at('typedef', i) || at('union', i)) return true
    while (looksLikeTypeName(peek(i))) {
      sawType = true
      i++
      // `unsigned long`, `long long`, … keep consuming
      if (peek(i).value === '::' ) {
        i += 2
        continue
      }
      if (looksLikeTypeName(peek(i))) continue
      break
    }
    if (!sawType) return false
    if (at('<', i)) {
      // template arguments — skip to the matching '>'
      let depth = 0
      while (!isDone() && i < tokens.length) {
        if (at('<', i)) depth++
        if (at('>', i)) {
          depth--
          i++
          if (depth === 0) break
          continue
        }
        i++
      }
    }
    while (at('*', i) || at('&', i) || QUALIFIERS.has(peek(i).value)) i++
    // a declaration must name something
    return peek(i).type === 'ident' && !types.has(peek(i).value)
  }

  function parseType(): TypeInfo {
    let isConst = false
    let isStatic = false
    let isUnsigned = false
    while (QUALIFIERS.has(peek().value)) {
      const q = next().value
      if (q === 'const' || q === 'constexpr') isConst = true
      if (q === 'static') isStatic = true
    }

    const parts: string[] = []
    while (looksLikeTypeName(peek())) {
      const word = next().value
      if (word === 'unsigned') isUnsigned = true
      if (word !== 'signed' && word !== 'unsigned') parts.push(word)
      else if (!looksLikeTypeName(peek())) parts.push('int')
      if (at('::')) {
        next()
        continue
      }
    }
    if (parts.length === 0) parts.push('int')

    const templateArgs: TypeInfo[] = []
    if (at('<')) {
      next()
      while (!at('>') && !isDone()) {
        if (looksLikeTypeName(peek())) templateArgs.push(parseType())
        else next()
        eat(',')
      }
      eat('>')
    }

    let pointer = 0
    let isReference = false
    while (at('*') || at('&')) {
      if (next().value === '*') pointer++
      else isReference = true
    }
    while (QUALIFIERS.has(peek().value)) next()

    // `long long` and `unsigned long` collapse to their widest member
    const name = parts.includes('long') && parts.length > 1 && !parts.includes('double')
      ? 'long'
      : parts[parts.length - 1]

    return { name, isConst, isStatic, isUnsigned, pointer, isReference, templateArgs }
  }

  // ---------- expressions ----------

  function parsePrimary(): Expr {
    const token = peek()

    if (token.type === 'num') {
      next()
      return { kind: 'num', value: token.num ?? 0, isInt: token.isInt ?? true }
    }
    if (token.type === 'char') {
      next()
      return { kind: 'num', value: token.num ?? 0, isInt: true, isChar: true }
    }
    if (token.type === 'str') {
      next()
      let value = token.value
      // adjacent string literals concatenate
      while (peek().type === 'str') value += next().value
      return { kind: 'str', value }
    }
    if (at('(')) {
      next()
      // C-style cast: '(' type ')' expression
      if (looksLikeTypeName(peek()) && !at(')', 1)) {
        const save = pos
        try {
          const type = parseType()
          if (at(')')) {
            next()
            if (!at(';') && !at(',') && !at(')')) {
              return { kind: 'cast', type, operand: parseUnary() }
            }
          }
          pos = save
        } catch {
          pos = save
        }
      } else if (looksLikeTypeName(peek()) && at(')', 1)) {
        const type = parseType()
        expect(')')
        return { kind: 'cast', type, operand: parseUnary() }
      }
      const items: Expr[] = [parseExpression()]
      while (eat(',')) items.push(parseExpression())
      expect(')')
      return items.length === 1 ? items[0] : { kind: 'comma', items }
    }
    if (at('{')) {
      next()
      const items: Expr[] = []
      while (!at('}') && !isDone()) {
        items.push(parseAssignment())
        if (!eat(',')) break
      }
      expect('}')
      return { kind: 'initList', items }
    }
    if (at('sizeof')) {
      next()
      if (at('(')) {
        next()
        if (looksLikeTypeName(peek())) {
          const type = parseType()
          expect(')')
          return { kind: 'sizeof', type }
        }
        const operand = parseExpression()
        expect(')')
        return { kind: 'sizeof', operand }
      }
      return { kind: 'sizeof', operand: parseUnary() }
    }
    if (token.type === 'ident') {
      next()
      // qualified names (`Serial::x`, `std::min`) flatten to the last segment
      let name = token.value
      while (at('::')) {
        next()
        name = next().value
      }
      return { kind: 'ident', name, line: token.line }
    }

    throw new CppSyntaxError(`Token tidak terduga '${token.value || 'akhir file'}'`, token.line, token.col)
  }

  function parsePostfix(): Expr {
    let expr = parsePrimary()
    for (;;) {
      if (at('(')) {
        const line = peek().line
        next()
        const args: Expr[] = []
        while (!at(')') && !isDone()) {
          args.push(parseAssignment())
          if (!eat(',')) break
        }
        expect(')')
        expr = { kind: 'call', callee: expr, args, line }
      } else if (at('[')) {
        const line = peek().line
        next()
        const index = parseExpression()
        expect(']')
        expr = { kind: 'index', array: expr, index, line }
      } else if (at('.') || at('->')) {
        const line = peek().line
        const arrow = next().value === '->'
        const property = next().value
        expr = { kind: 'member', object: expr, property, arrow, line }
      } else if (at('++') || at('--')) {
        const op = next().value as '++' | '--'
        expr = { kind: 'update', op, target: expr, prefix: false }
      } else {
        return expr
      }
    }
  }

  function parseUnary(): Expr {
    const token = peek()
    if (at('++') || at('--')) {
      next()
      return { kind: 'update', op: token.value as '++' | '--', target: parseUnary(), prefix: true }
    }
    if (at('!') || at('-') || at('+') || at('~') || at('*') || at('&')) {
      next()
      return { kind: 'unary', op: token.value, operand: parseUnary(), line: token.line }
    }
    if (at('new')) {
      next()
      return parseUnary()
    }
    return parsePostfix()
  }

  function parseBinary(minPrecedence: number): Expr {
    let left = parseUnary()
    for (;;) {
      const token = peek()
      if (token.type !== 'punct') break
      const precedence = BINARY_PRECEDENCE[token.value]
      if (precedence === undefined || precedence < minPrecedence) break
      next()
      const right = parseBinary(precedence + 1)
      left = { kind: 'binary', op: token.value, left, right, line: token.line }
    }
    return left
  }

  function parseLogicalAnd(): Expr {
    let left = parseBinary(0)
    while (at('&&')) {
      next()
      left = { kind: 'logical', op: '&&', left, right: parseBinary(0) }
    }
    return left
  }

  function parseLogicalOr(): Expr {
    let left = parseLogicalAnd()
    while (at('||')) {
      next()
      left = { kind: 'logical', op: '||', left, right: parseLogicalAnd() }
    }
    return left
  }

  function parseTernary(): Expr {
    const cond = parseLogicalOr()
    if (!at('?')) return cond
    next()
    const then = parseAssignment()
    expect(':')
    return { kind: 'ternary', cond, then, other: parseAssignment() }
  }

  function parseAssignment(): Expr {
    const left = parseTernary()
    const token = peek()
    if (token.type === 'punct' && ASSIGN_OPS.has(token.value)) {
      next()
      return { kind: 'assign', op: token.value, target: left, value: parseAssignment(), line: token.line }
    }
    return left
  }

  function parseExpression(): Expr {
    return parseAssignment()
  }

  // ---------- declarations ----------

  function parseDeclarators(): VarDeclarator[] {
    const declarators: VarDeclarator[] = []
    do {
      while (at('*') || at('&')) next()
      const nameToken = next()
      const declarator: VarDeclarator = {
        name: nameToken.value,
        arraySize: null,
        extraDims: [],
        init: null,
        ctorArgs: null,
      }
      let dim = 0
      while (at('[')) {
        next()
        const size = at(']') ? null : parseExpression()
        expect(']')
        if (dim === 0) declarator.arraySize = size ?? 'auto'
        else declarator.extraDims.push(size)
        dim++
      }
      if (eat('=')) {
        declarator.init = parseAssignment()
      } else if (at('(')) {
        next()
        const args: Expr[] = []
        while (!at(')') && !isDone()) {
          args.push(parseAssignment())
          if (!eat(',')) break
        }
        expect(')')
        declarator.ctorArgs = args
      }
      declarators.push(declarator)
    } while (eat(','))
    return declarators
  }

  function parseParams(): Param[] {
    expect('(')
    const params: Param[] = []
    while (!at(')') && !isDone()) {
      if (at('void') && at(')', 1)) {
        next()
        break
      }
      if (at('...')) {
        next()
        break
      }
      const type = parseType()
      let name = ''
      if (peek().type === 'ident') name = next().value
      let isArray = false
      while (at('[')) {
        next()
        if (!at(']')) parseExpression()
        expect(']')
        isArray = true
      }
      let defaultValue: Expr | null = null
      if (eat('=')) defaultValue = parseAssignment()
      params.push({ type, name, isArray, defaultValue })
      if (!eat(',')) break
    }
    expect(')')
    return params
  }

  function parseStruct(isTypedef: boolean): Stmt {
    const keyword = next().value // struct | class | union
    let name = ''
    if (peek().type === 'ident' && !at('{')) name = next().value

    if (!at('{')) {
      // forward declaration or `struct Foo bar;`
      if (name) types.add(name)
      const declarators = peek().type === 'ident' ? parseDeclarators() : []
      eat(';')
      return declarators.length
        ? { kind: 'varDecl', type: makeType(name), declarators, line: peek().line }
        : { kind: 'empty' }
    }

    expect('{')
    const fields: { type: TypeInfo; name: string }[] = []
    const members: Stmt[] = []
    while (!at('}') && !isDone()) {
      if (at('public') || at('private') || at('protected')) {
        next()
        eat(':')
        continue
      }
      if (eat(';')) continue
      if (at('~')) {
        // destructor: parse and discard, the simulator has no lifetime model
        next()
        next()
        parseParams()
        if (at('{')) parseBlock()
        eat(';')
        continue
      }
      if (peek().type === 'ident' && peek().value === name && at('(', 1)) {
        const ctorLine = peek().line
        next()
        const ctorParams = parseParams()
        while (at(':') && !at('{')) {
          // member initialiser list — evaluated as plain assignments is not
          // worth the complexity, so it is skipped up to the body
          while (!at('{') && !isDone()) next()
        }
        const ctorBody = at('{') ? (parseBlock() as { kind: 'block'; body: Stmt[] }).body : null
        eat(';')
        members.push({ kind: 'funcDecl', name, returnType: VOID_TYPE, params: ctorParams, body: ctorBody, line: ctorLine })
        continue
      }
      const member = parseStatement()
      members.push(member)
      if (member.kind === 'varDecl') {
        for (const declarator of member.declarators) fields.push({ type: member.type, name: declarator.name })
      }
    }
    expect('}')

    let typedefName: string | null = null
    if (peek().type === 'ident') typedefName = next().value
    eat(';')

    if (name) types.add(name)
    if (typedefName) types.add(typedefName)
    void isTypedef

    if (keyword === 'class' && members.some((m) => m.kind === 'funcDecl')) {
      return { kind: 'classDecl', name: name || typedefName || 'Anon', members }
    }
    return { kind: 'structDecl', name: name || typedefName || 'Anon', fields, typedefName }
  }

  function parseEnum(): Stmt {
    next() // enum
    eat('class')
    if (peek().type === 'ident' && !at('{')) types.add(next().value)
    expect('{')
    const entries: { name: string; value: number }[] = []
    let counter = 0
    while (!at('}') && !isDone()) {
      const name = next().value
      if (eat('=')) {
        const expr = parseAssignment()
        counter = expr.kind === 'num' ? expr.value : counter
      }
      entries.push({ name, value: counter })
      counter++
      if (!eat(',')) break
    }
    expect('}')
    if (peek().type === 'ident') types.add(next().value)
    eat(';')
    return { kind: 'enumDecl', entries }
  }

  function parseTypedef(): Stmt {
    next() // typedef
    if (at('struct') || at('class') || at('union')) return parseStruct(true)
    if (at('enum')) return parseEnum()
    parseType()
    // skip function-pointer typedefs and friends up to the terminator
    let alias = ''
    while (!at(';') && !isDone()) {
      const token = next()
      if (token.type === 'ident') alias = token.value
    }
    eat(';')
    if (alias) types.add(alias)
    return { kind: 'empty' }
  }

  // ---------- statements ----------

  function parseBlock(): Stmt {
    expect('{')
    const body: Stmt[] = []
    while (!at('}') && !isDone()) body.push(parseStatement())
    expect('}')
    return { kind: 'block', body }
  }

  function parseFor(): Stmt {
    next() // for
    expect('(')

    // range-for: `for (auto value : list)`
    const save = pos
    if (atDeclaration()) {
      const declType = parseType()
      const name = peek().type === 'ident' ? next().value : ''
      if (at(':')) {
        next()
        const iterable = parseExpression()
        expect(')')
        return { kind: 'forEach', declType, name, iterable, body: parseStatement() }
      }
      pos = save
    }

    let init: Stmt | null = null
    if (!at(';')) init = parseStatement()
    else next()

    const cond = at(';') ? null : parseExpression()
    expect(';')
    const update = at(')') ? null : parseExpression()
    expect(')')
    return { kind: 'for', init, cond, update, body: parseStatement() }
  }

  function parseSwitch(): Stmt {
    next() // switch
    expect('(')
    const disc = parseExpression()
    expect(')')
    expect('{')
    const cases: { test: Expr | null; body: Stmt[] }[] = []
    while (!at('}') && !isDone()) {
      if (at('case') || at('default')) {
        const isDefault = next().value === 'default'
        const test = isDefault ? null : parseExpression()
        expect(':')
        cases.push({ test, body: [] })
        continue
      }
      const stmt = parseStatement()
      if (cases.length === 0) cases.push({ test: null, body: [] })
      cases[cases.length - 1].body.push(stmt)
    }
    expect('}')
    return { kind: 'switch', disc, cases }
  }

  function parseStatement(): Stmt {
    const token = peek()

    if (at(';')) {
      next()
      return { kind: 'empty' }
    }
    if (at('{')) return parseBlock()
    if (at('typedef')) return parseTypedef()
    if (at('struct') || at('class') || at('union')) return parseStruct(false)
    if (at('enum')) return parseEnum()
    if (at('using') || at('namespace')) {
      while (!at(';') && !at('{') && !isDone()) next()
      if (at('{')) return parseBlock()
      eat(';')
      return { kind: 'empty' }
    }
    if (at('template')) {
      next()
      if (at('<')) {
        let depth = 0
        do {
          if (at('<')) depth++
          if (at('>')) depth--
          next()
        } while (depth > 0 && !isDone())
      }
      return parseStatement()
    }

    if (at('if')) {
      next()
      expect('(')
      const cond = parseExpression()
      expect(')')
      const then = parseStatement()
      const other = eat('else') ? parseStatement() : null
      return { kind: 'if', cond, then, other }
    }
    if (at('while')) {
      next()
      expect('(')
      const cond = parseExpression()
      expect(')')
      return { kind: 'while', cond, body: parseStatement() }
    }
    if (at('do')) {
      next()
      const body = parseStatement()
      expect('while')
      expect('(')
      const cond = parseExpression()
      expect(')')
      eat(';')
      return { kind: 'doWhile', cond, body }
    }
    if (at('for')) return parseFor()
    if (at('switch')) return parseSwitch()
    if (at('return')) {
      next()
      const value = at(';') ? null : parseExpression()
      eat(';')
      return { kind: 'return', value, line: token.line }
    }
    if (at('break')) {
      next()
      eat(';')
      return { kind: 'break' }
    }
    if (at('continue')) {
      next()
      eat(';')
      return { kind: 'continue' }
    }
    if (at('goto')) {
      next()
      next()
      eat(';')
      return { kind: 'empty' }
    }

    // `MyClass::MyClass(...)` — an out-of-line constructor has no return type
    if (token.type === 'ident' && at('::', 1) && peek(2).type === 'ident' && at('(', 3)) {
      next()
      next()
      const name = next().value
      const params = parseParams()
      while (at(':') && !at('{')) {
        while (!at('{') && !isDone()) next()
      }
      const body = at('{') ? (parseBlock() as { kind: 'block'; body: Stmt[] }).body : null
      eat(';')
      return { kind: 'funcDecl', name, returnType: VOID_TYPE, params, body, line: token.line }
    }

    if (atDeclaration()) {
      const type = parseType()
      // constructor / destructor inside a class body
      if (at('(') && type.name) {
        const params = parseParams()
        const body = at('{') ? (parseBlock() as { kind: 'block'; body: Stmt[] }).body : null
        eat(';')
        return { kind: 'funcDecl', name: type.name, returnType: VOID_TYPE, params, body, line: token.line }
      }

      // function definition: `type name(params) { … }`
      //
      // `LiquidCrystal_I2C lcd(0x27, 16, 2);` looks identical until you read
      // inside the parentheses: a parameter list opens with a type (or is
      // empty), a constructor call opens with a value.
      const opensParameterList = () =>
        at(')', 2) || at('void', 2) || looksLikeTypeName(peek(2)) || QUALIFIERS.has(peek(2).value)

      if (peek().type === 'ident' && at('(', 1) && opensParameterList()) {
        const name = next().value
        const params = parseParams()
        while (at('const') || at('override') || at('noexcept')) next()
        if (at('{')) {
          const block = parseBlock() as { kind: 'block'; body: Stmt[] }
          return { kind: 'funcDecl', name, returnType: type, params, body: block.body, line: token.line }
        }
        eat(';')
        return { kind: 'funcDecl', name, returnType: type, params, body: null, line: token.line }
      }

      // `Class::method(...) { … }` out-of-line definition
      if (peek().type === 'ident' && at('::', 1)) {
        next()
        next()
        const name = next().value
        const params = parseParams()
        const body = at('{') ? (parseBlock() as { kind: 'block'; body: Stmt[] }).body : null
        eat(';')
        return { kind: 'funcDecl', name, returnType: type, params, body, line: token.line }
      }

      const declarators = parseDeclarators()
      eat(';')
      return { kind: 'varDecl', type, declarators, line: token.line }
    }

    // labels (`myLabel:`) are skipped
    if (token.type === 'ident' && at(':', 1) && !at('::', 1)) {
      next()
      next()
      return { kind: 'empty' }
    }

    const expr = parseExpression()
    eat(';')
    return { kind: 'expr', expr, line: token.line }
  }

  const body: Stmt[] = []
  while (!isDone()) body.push(parseStatement())
  return { body }
}
