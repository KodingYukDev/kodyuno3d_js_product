// ============================================================
// KodyUno — C++ lexer
//
// Turns Arduino sketch text into tokens. Comments are stripped, numeric
// literals keep their radix, and integer/float suffixes (U, L, F) are
// dropped since the interpreter carries the numeric type on the value.
// ============================================================

export type TokenType = 'num' | 'str' | 'char' | 'ident' | 'punct' | 'preproc' | 'eof'

export interface Token {
  type: TokenType
  value: string
  /** Numeric literals carry their parsed value and whether they are integral. */
  num?: number
  isInt?: boolean
  line: number
  col: number
}

export class CppSyntaxError extends Error {
  readonly line: number
  readonly col: number

  constructor(message: string, line: number, col: number) {
    super(`${message} (baris ${line})`)
    this.name = 'CppSyntaxError'
    this.line = line
    this.col = col
  }
}

// Longest-first so '<<=' wins over '<<' wins over '<'.
const PUNCTUATORS = [
  '<<=', '>>=', '...', '->*',
  '++', '--', '->', '::', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '?', ':',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '#',
]

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'

const ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v',
}

function readEscape(src: string, i: number): { char: string; next: number } {
  const c = src[i]
  if (c === 'x') {
    let hex = ''
    let j = i + 1
    while (j < src.length && /[0-9a-fA-F]/.test(src[j]) && hex.length < 2) hex += src[j++]
    return { char: String.fromCharCode(parseInt(hex, 16) || 0), next: j }
  }
  return { char: ESCAPES[c] ?? c, next: i + 1 }
}

/** Parse a C numeric literal, honouring 0x / 0b / 0 prefixes and suffixes. */
export function parseNumericLiteral(text: string): { value: number; isInt: boolean } {
  const body = text.replace(/[uUlL]+$/, '')
  if (/^0[xX]/.test(body)) return { value: parseInt(body.slice(2), 16), isInt: true }
  if (/^0[bB]/.test(body)) return { value: parseInt(body.slice(2), 2), isInt: true }
  if (/[.eEfF]/.test(body)) return { value: parseFloat(body.replace(/[fF]$/, '')), isInt: false }
  if (/^0[0-7]+$/.test(body)) return { value: parseInt(body.slice(1), 8), isInt: true }
  return { value: parseInt(body, 10), isInt: true }
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  const col = () => i - lineStart + 1

  const push = (type: TokenType, value: string, extra: Partial<Token> = {}) => {
    tokens.push({ type, value, line, col: col(), ...extra })
  }

  while (i < src.length) {
    const c = src[i]

    // ---- whitespace ----
    if (c === '\n') {
      line++
      i++
      lineStart = i
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++
      continue
    }

    // ---- comments ----
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          line++
          lineStart = i + 1
        }
        i++
      }
      i += 2
      continue
    }

    // ---- preprocessor line (already normalised by the preprocessor) ----
    if (c === '#') {
      const start = i
      while (i < src.length && src[i] !== '\n') {
        // a backslash keeps the directive going on the next line
        if (src[i] === '\\' && src[i + 1] === '\n') {
          line++
          i += 2
          lineStart = i
          continue
        }
        i++
      }
      push('preproc', src.slice(start, i))
      continue
    }

    // ---- numbers ----
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = i
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X' || src[i + 1] === 'b' || src[i + 1] === 'B')) {
        i += 2
        while (i < src.length && /[0-9a-fA-F]/.test(src[i])) i++
      } else {
        while (i < src.length && (isDigit(src[i]) || src[i] === '.')) i++
        if (src[i] === 'e' || src[i] === 'E') {
          i++
          if (src[i] === '+' || src[i] === '-') i++
          while (i < src.length && isDigit(src[i])) i++
        }
      }
      while (i < src.length && /[uUlLfF]/.test(src[i])) i++
      const text = src.slice(start, i)
      const parsed = parseNumericLiteral(text)
      push('num', text, { num: parsed.value, isInt: parsed.isInt })
      continue
    }

    // ---- strings ----
    if (c === '"') {
      i++
      let out = ''
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          const esc = readEscape(src, i + 1)
          out += esc.char
          i = esc.next
        } else {
          if (src[i] === '\n') line++
          out += src[i++]
        }
      }
      i++
      push('str', out)
      continue
    }

    // ---- char literals ----
    if (c === "'") {
      i++
      let ch = ''
      if (src[i] === '\\') {
        const esc = readEscape(src, i + 1)
        ch = esc.char
        i = esc.next
      } else {
        ch = src[i++]
      }
      if (src[i] === "'") i++
      push('char', ch, { num: ch.charCodeAt(0) || 0, isInt: true })
      continue
    }

    // ---- identifiers / keywords ----
    if (isIdentStart(c)) {
      const start = i
      while (i < src.length && isIdentPart(src[i])) i++
      push('ident', src.slice(start, i))
      continue
    }

    // ---- punctuators ----
    const punct = PUNCTUATORS.find((p) => src.startsWith(p, i))
    if (punct) {
      push('punct', punct)
      i += punct.length
      continue
    }

    throw new CppSyntaxError(`Karakter tidak dikenal '${c}'`, line, col())
  }

  tokens.push({ type: 'eof', value: '', line, col: col() })
  return tokens
}
