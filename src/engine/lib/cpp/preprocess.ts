// ============================================================
// KodyUno — C++ preprocessor
//
// Handles the directives sketches actually use: #include, #define (both
// object-like and function-like), and conditional compilation. Everything
// runs on the token stream so macro bodies keep their own tokens instead of
// being re-lexed as text.
// ============================================================
import { tokenize, type Token, CppSyntaxError } from './lexer'

export interface Macro {
  name: string
  /** undefined for object-like macros. */
  params?: string[]
  body: Token[]
}

export interface PreprocessOptions {
  /** Macros defined before the sketch is seen (board defines, ARDUINO, …). */
  predefined?: Record<string, string>
  /** Header text to splice in for `#include`, keyed by header name. */
  headerSource?: (header: string) => string | undefined
}

export interface PreprocessResult {
  tokens: Token[]
  /** Every header the sketch asked for, in order, duplicates removed. */
  includes: string[]
  macros: Map<string, Macro>
}

const MAX_EXPANSIONS = 5000

function parseDirective(text: string): { name: string; rest: string } {
  const match = text.match(/^#\s*(\w+)\s*([\s\S]*)$/)
  if (!match) return { name: '', rest: '' }
  return { name: match[1], rest: match[2].replace(/\\\s*\n/g, ' ').trim() }
}

function defineMacro(rest: string): Macro | null {
  const fnMatch = rest.match(/^(\w+)\(([^)]*)\)\s*([\s\S]*)$/)
  if (fnMatch) {
    const params = fnMatch[2].trim() === '' ? [] : fnMatch[2].split(',').map((p) => p.trim())
    return { name: fnMatch[1], params, body: tokenize(fnMatch[3]).slice(0, -1) }
  }
  const objMatch = rest.match(/^(\w+)\s*([\s\S]*)$/)
  if (!objMatch) return null
  return { name: objMatch[1], body: tokenize(objMatch[2]).slice(0, -1) }
}

/** Evaluate a #if expression well enough for guard patterns in real sketches. */
function evalCondition(expr: string, macros: Map<string, Macro>): boolean {
  const replaced = expr
    .replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, name) => (macros.has(name) ? '1' : '0'))
    .replace(/defined\s+(\w+)/g, (_, name) => (macros.has(name) ? '1' : '0'))
    .replace(/\b[A-Za-z_]\w*\b/g, (name) => {
      const macro = macros.get(name)
      if (!macro) return '0'
      const first = macro.body[0]
      return first && first.type === 'num' ? String(first.num) : '1'
    })
  try {
    // Only digits and operators survive the replacements above.
    if (!/^[\d\s+\-*/%()<>=!&|^~]*$/.test(replaced)) return false
    return Boolean(new Function(`return (${replaced || '0'})`)())
  } catch {
    return false
  }
}

/** Expand macros in a token list, guarding against recursive definitions. */
function expand(tokens: Token[], macros: Map<string, Macro>): Token[] {
  const out: Token[] = []
  let budget = MAX_EXPANSIONS
  const active = new Set<string>()

  const walk = (list: Token[]) => {
    let i = 0
    while (i < list.length) {
      const token = list[i]
      if (token.type !== 'ident' || active.has(token.value)) {
        out.push(token)
        i++
        continue
      }
      const macro = macros.get(token.value)
      if (!macro) {
        out.push(token)
        i++
        continue
      }
      if (budget-- <= 0) throw new CppSyntaxError('Ekspansi #define berulang tanpa henti', token.line, token.col)

      if (!macro.params) {
        active.add(macro.name)
        walk(macro.body)
        active.delete(macro.name)
        i++
        continue
      }

      // function-like: collect the parenthesised argument list
      if (list[i + 1]?.value !== '(') {
        out.push(token)
        i++
        continue
      }
      let depth = 0
      let j = i + 1
      const args: Token[][] = []
      let current: Token[] = []
      for (; j < list.length; j++) {
        const t = list[j]
        if (t.value === '(') {
          depth++
          if (depth === 1) continue
        }
        if (t.value === ')') {
          depth--
          if (depth === 0) {
            args.push(current)
            break
          }
        }
        if (t.value === ',' && depth === 1) {
          args.push(current)
          current = []
          continue
        }
        current.push(t)
      }
      const substituted: Token[] = []
      for (const bodyToken of macro.body) {
        const index = macro.params.indexOf(bodyToken.value)
        if (bodyToken.type === 'ident' && index >= 0) substituted.push(...(args[index] ?? []))
        else substituted.push(bodyToken)
      }
      active.add(macro.name)
      walk(substituted)
      active.delete(macro.name)
      i = j + 1
    }
  }

  walk(tokens)
  return out
}

export function preprocess(source: string, options: PreprocessOptions = {}): PreprocessResult {
  const macros = new Map<string, Macro>()
  for (const [name, value] of Object.entries(options.predefined ?? {})) {
    const macro = defineMacro(`${name} ${value}`)
    if (macro) macros.set(macro.name, macro)
  }

  const includes: string[] = []
  const seenHeaders = new Set<string>()

  /** Directive processing is recursive so an included header behaves the same. */
  const run = (text: string, depth: number): Token[] => {
    if (depth > 8) return []
    const raw = tokenize(text)
    const kept: Token[] = []
    /** One entry per open #if — `taking` says whether this branch emits code. */
    const stack: { taking: boolean; done: boolean; parent: boolean }[] = []
    const emitting = () => stack.every((frame) => frame.taking)

    for (const token of raw) {
      if (token.type === 'eof') continue
      if (token.type !== 'preproc') {
        if (emitting()) kept.push(token)
        continue
      }

      const { name, rest } = parseDirective(token.value)
      switch (name) {
        case 'ifdef':
        case 'ifndef':
        case 'if': {
          const parent = emitting()
          const value =
            name === 'ifdef' ? macros.has(rest.trim())
              : name === 'ifndef' ? !macros.has(rest.trim())
              : evalCondition(rest, macros)
          stack.push({ taking: parent && value, done: parent && value, parent })
          break
        }
        case 'elif': {
          const frame = stack[stack.length - 1]
          if (!frame) break
          const value = !frame.done && frame.parent && evalCondition(rest, macros)
          frame.taking = value
          frame.done = frame.done || value
          break
        }
        case 'else': {
          const frame = stack[stack.length - 1]
          if (!frame) break
          frame.taking = frame.parent && !frame.done
          frame.done = true
          break
        }
        case 'endif':
          stack.pop()
          break
        case 'define': {
          if (!emitting()) break
          const macro = defineMacro(rest)
          if (macro) macros.set(macro.name, macro)
          break
        }
        case 'undef':
          if (emitting()) macros.delete(rest.trim())
          break
        case 'include': {
          if (!emitting()) break
          const header = rest.replace(/^[<"]|[>"]$/g, '').trim()
          if (!header) break
          if (!seenHeaders.has(header)) {
            seenHeaders.add(header)
            includes.push(header)
            const body = options.headerSource?.(header)
            if (body) kept.push(...run(body, depth + 1))
          }
          break
        }
        default:
          // #pragma, #line, #error and friends: nothing to do in the simulator
          break
      }
    }
    return kept
  }

  const kept = run(source, 0)
  const expanded = expand(kept, macros)
  expanded.push({ type: 'eof', value: '', line: expanded[expanded.length - 1]?.line ?? 1, col: 1 })
  return { tokens: expanded, includes, macros }
}
