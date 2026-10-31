/**
 * LangServer (`servers/lang/app.py`): tokenizing, case, hashing, base64,
 * regex search and replace, and `str.format` templates, statement for
 * statement. Upstream's tools that call another tool's `.fn` (count_words,
 * word_freq, ngrams, snake_case and the rest) get an unawaited coroutine
 * back, the tools being async, so they fail on it as they do upstream.
 *
 * `regex_search` and `replace` run a model's pattern with Python's `re`:
 * the pattern is parsed as `re._parser` parses it (its syntax, its errors
 * and their positions) and written out as a JS RegExp (`v` mode) that
 * matches what it matches, with Python's classes (`\w` a letter, a number
 * or `_`, `\s` `str.isspace`'s characters), anchors (`$` before a final
 * newline) and `.`; `findall` and `sub` then walk the matches as sre does,
 * an empty match next to the last one included. Conditional groups and
 * `\N{...}` have no JS form here. `template_render` is `str.format` over
 * JSON values: its field syntax, conversions and format-spec mini-language.
 */
import { createHash } from 'node:crypto'

import { PyError } from '../common.ts'
import {
  PyFloat,
  SPACE,
  b64decode,
  big,
  decodeUtf8,
  encode,
  exactDouble,
  lower,
  parseFloatStr,
  pyType,
  repr,
  reprFloat,
  reprStr,
  str,
  strip,
  title,
  upper,
} from '../../../../../workspace/py.ts'
import { type ParamSpec, plainTools } from '../tool.ts'

// --- Python's re ---

/** A pattern as JS runs it: its source and flags, and Python's group count and names. */
interface Compiled {
  source: string
  flags: string
  groups: number
  names: Map<string, number>
}

interface Flags {
  i: boolean
  m: boolean
  s: boolean
  x: boolean
  a: boolean
}

const WORD = '[\\p{L}\\p{N}_]'
const NOT_WORD = '[^\\p{L}\\p{N}_]'
const SPACE_CLASS = `[${SPACE.replace(/\\x([0-9a-f]{2})/g, '\\u{$1}').replace(/\\u([0-9a-f]{4})/g, '\\u{$1}')}]`
const NOT_SPACE = `[^${SPACE_CLASS.slice(1)}`

const lit = (cp: number) => `\\u{${cp.toString(16)}}`
const ASCII_LETTERS = /^[A-Za-z]$/
const DIGITS = /^[0-9]$/
const OCT = /^[0-7]$/
const HEX = /^[0-9a-fA-F]$/
const MAXREPEAT = 4294967295
const MAXWIDTH = 2 ** 53

/** One parsed item: its JS source, its width (min, max), and what kind it is (`at` anchors, `repeat`s). */
interface Item {
  js: string
  lo: number
  hi: number
  kind?: 'at' | 'repeat'
}

/** `re.error`'s text: the message, and where, with the line and column if the pattern has lines. */
function reError(pattern: string[], msg: string, pos?: number): PyError {
  if (pos === undefined) return new PyError(msg)
  const before = pattern.slice(0, pos)
  if (pattern.includes('\n')) {
    const line = before.filter((c) => c === '\n').length + 1
    const col = pos - before.lastIndexOf('\n')
    return new PyError(`${msg} at position ${pos} (line ${line}, column ${col})`)
  }
  return new PyError(`${msg} at position ${pos}`)
}

class Parser {
  private readonly p: string[]
  private pos = 0
  private groups = 1
  private readonly names = new Map<string, number>()
  private readonly open = new Set<number>()
  private lookbehindBad = false
  private atomics = 0
  private readonly global: Flags = { i: false, m: false, s: false, x: false, a: false }

  constructor(pattern: string) {
    this.p = Array.from(pattern)
  }

  private error(msg: string, pos?: number): PyError {
    return reError(this.p, msg, pos)
  }
  private get next(): string | undefined {
    return this.p[this.pos]
  }
  private match(c: string): boolean {
    if (this.p[this.pos] === c) {
      this.pos++
      return true
    }
    return false
  }
  /** The tokenizer's next token: a character, or a backslash and the one after it. */
  private get(): string | undefined {
    const c = this.p[this.pos]
    if (c === undefined) return undefined
    if (c === '\\') {
      const d = this.p[this.pos + 1]
      if (d === undefined) throw this.error('bad escape (end of pattern)', this.pos)
      this.pos += 2
      return c + d
    }
    this.pos++
    return c
  }
  private getwhile(n: number, ok: RegExp): string {
    let out = ''
    while (out.length < n && this.next !== undefined && ok.test(this.next)) out += this.p[this.pos++]
    return out
  }
  private getuntil(end: string, what: string): string {
    let name = ''
    for (;;) {
      const c = this.p[this.pos]
      if (c === undefined) {
        if (!name) throw this.error(`missing ${what}`, this.pos)
        throw this.error(`missing ${end}, unterminated name`, this.pos - name.length)
      }
      this.pos++
      if (c === end) {
        if (!name) throw this.error(`missing ${what}`, this.pos - 1)
        return name
      }
      name += c
    }
  }
  private checkName(name: string, offset: number): void {
    if (!/^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*$/u.test(name)) {
      throw this.error(`bad character in group name ${reprStr(name)}`, this.pos - offset)
    }
  }

  compile(): Compiled {
    const body = this.parseSub(this.global, 0)
    if (this.next !== undefined) {
      if (this.next === ')') throw this.error('unbalanced parenthesis', this.pos)
      throw this.error('bogus characters at end of regular expression', this.pos)
    }
    if (this.lookbehindBad) throw new PyError('look-behind requires fixed-width pattern')
    return { source: body.js, flags: this.global.i ? 'i' : '', groups: this.groups - 1, names: this.names }
  }

  private parseSub(flags: Flags, nested: number): Item {
    const items = [this.parse(flags, nested)]
    while (this.match('|')) items.push(this.parse(flags, nested))
    if (items.length === 1) return items[0]!
    return { js: `(?:${items.map((i) => i.js).join('|')})`, lo: Math.min(...items.map((i) => i.lo)), hi: Math.max(...items.map((i) => i.hi)) }
  }

  private parse(flags: Flags, nested: number): Item {
    const seq: Item[] = []
    const first = this.pos === 0
    for (;;) {
      const c = this.next
      if (c === undefined || c === '|' || c === ')') break
      const here = this.pos
      if (flags.x) {
        if (/^[ \t\n\r\v\f]$/.test(c)) {
          this.pos++
          continue
        }
        if (c === '#') {
          while (this.next !== undefined && this.next !== '\n') this.pos++
          continue
        }
      }
      const tok = this.get()!
      if (tok[0] === '\\') seq.push(this.escape(tok, flags, here))
      else if (!'.[{()*+?^$|'.includes(tok)) seq.push({ js: lit(tok.codePointAt(0)!), lo: 1, hi: 1 })
      else if (tok === '[') seq.push(this.charClass(flags, here))
      else if ('*+?{'.includes(tok)) {
        let lo: number
        let hi: number
        if (tok === '*') [lo, hi] = [0, MAXREPEAT]
        else if (tok === '+') [lo, hi] = [1, MAXREPEAT]
        else if (tok === '?') [lo, hi] = [0, 1]
        else {
          if (this.next === '}') {
            seq.push({ js: lit(0x7b), lo: 1, hi: 1 })
            continue
          }
          ;[lo, hi] = [0, MAXREPEAT]
          const a = this.getwhile(Infinity, DIGITS)
          let b: string
          if (this.match(',')) b = this.getwhile(Infinity, DIGITS)
          else b = a
          if (!this.match('}')) {
            seq.push({ js: lit(0x7b), lo: 1, hi: 1 })
            this.pos = here + 1
            continue
          }
          if (a) {
            lo = Number(a)
            if (lo >= MAXREPEAT) throw new PyError('the repetition number is too large')
          }
          if (b) {
            hi = Number(b)
            if (hi >= MAXREPEAT) throw new PyError('the repetition number is too large')
            if (hi < lo) throw this.error('min repeat greater than max repeat', here + 1)
          }
        }
        const item = seq.at(-1)
        if (!item || item.kind === 'at') throw this.error('nothing to repeat', here)
        if (item.kind === 'repeat') throw this.error('multiple repeat', here)
        const q = tok === '{' ? `{${lo},${hi === MAXREPEAT ? '' : hi}}` : tok
        let js: string
        if (this.match('?')) js = `(?:${item.js})${q}?`
        else if (this.match('+')) js = this.atomic(`(?:${item.js})${q}`)
        else js = `(?:${item.js})${q}`
        seq[seq.length - 1] = { js, lo: item.lo * lo, hi: hi === MAXREPEAT ? MAXWIDTH : Math.min(item.hi * hi, MAXWIDTH), kind: 'repeat' }
      } else if (tok === '.') seq.push({ js: flags.s ? '[\\s\\S]' : '[^\\n]', lo: 1, hi: 1 })
      else if (tok === '(') {
        const item = this.group(flags, nested, here, first && seq.length === 0)
        if (item === 'global') {
          continue
        }
        if (item) seq.push(item)
      } else if (tok === '^') seq.push({ js: flags.m ? '(?<![^\\n])' : '(?<![\\s\\S])', lo: 0, hi: 0, kind: 'at' })
      else if (tok === '$') seq.push({ js: flags.m ? '(?![^\\n])' : '(?=\\n?(?![\\s\\S]))', lo: 0, hi: 0, kind: 'at' })
    }
    return { js: seq.map((i) => i.js).join(''), lo: seq.reduce((s, i) => s + i.lo, 0), hi: Math.min(seq.reduce((s, i) => s + i.hi, 0), MAXWIDTH) }
  }

  /** An atomic group: what it matched first, kept (a lookahead's capture, then a backreference to it). */
  private atomic(js: string): string {
    const name = `_a${++this.atomics}`
    return `(?:(?=(?<${name}>${js}))\\k<${name}>)`
  }

  private group(flags: Flags, nested: number, start: number, first: boolean): Item | null | 'global' {
    let capture = true
    let atomic = false
    let name: string | null = null
    let local: Flags | null = null
    // A scoped (?i:...) or (?-i:...) is JS's own; the other flags shape the translation.
    let caseFlag = ''
    if (this.match('?')) {
      const c = this.get()
      if (c === undefined) throw this.error('unexpected end of pattern', this.pos)
      if (c === 'P') {
        if (this.match('<')) {
          name = this.getuntil('>', 'group name')
          this.checkName(name, name.length + 1)
        } else if (this.match('=')) {
          const ref = this.getuntil(')', 'group name')
          this.checkName(ref, ref.length + 1)
          const gid = this.names.get(ref)
          if (gid === undefined) throw this.error(`unknown group name ${reprStr(ref)}`, this.pos - ref.length - 1)
          if (this.open.has(gid)) throw this.error('cannot refer to an open group', this.pos - ref.length - 1)
          return { js: `\\k<_g${gid}>`, lo: 0, hi: MAXWIDTH }
        } else {
          const d = this.get()
          if (d === undefined) throw this.error('unexpected end of pattern', this.pos)
          throw this.error(`unknown extension ?P${d}`, this.pos - d.length - 2)
        }
      } else if (c === ':') capture = false
      else if (c === '#') {
        for (;;) {
          if (this.next === undefined) throw this.error('missing ), unterminated comment', start)
          if (this.get() === ')') break
        }
        return null
      } else if ('=!<'.includes(c)) {
        let kind = c
        let behind = false
        if (c === '<') {
          const d = this.get()
          if (d === undefined) throw this.error('unexpected end of pattern', this.pos)
          if (!'=!'.includes(d)) throw this.error(`unknown extension ?<${d}`, this.pos - d.length - 2)
          kind = d
          behind = true
        }
        const sub = this.parseSub(flags, nested + 1)
        if (!this.match(')')) throw this.error('missing ), unterminated subpattern', start)
        if (behind && sub.lo !== sub.hi) this.lookbehindBad = true
        return { js: `(?:(?${behind ? '<' : ''}${kind}${sub.js}))`, lo: 0, hi: 0 }
      } else if (c === '>') {
        capture = false
        atomic = true
      } else if ('aiLmsux-'.includes(c)) {
        const [add, del, global] = this.flags(c)
        if (global) {
          if (!first) throw this.error('global flags not at the start of the expression', start)
          Object.assign(this.global, add)
          Object.assign(flags, add)
          return 'global'
        }
        local = { ...flags, ...add }
        for (const k of Object.keys(del) as (keyof Flags)[]) local[k] = false
        if (add.i) caseFlag = 'i'
        else if (del.i) caseFlag = '-i'
        capture = false
      } else {
        throw this.error(`unknown extension ?${c}`, this.pos - c.length - 1)
      }
    }
    let gid = 0
    if (capture) {
      gid = this.groups++
      if (name !== null) {
        if (this.names.has(name)) {
          throw this.error(`redefinition of group name ${reprStr(name)} as group ${gid}; was group ${this.names.get(name)}`, this.pos - name.length - 1)
        }
        this.names.set(name, gid)
      }
      this.open.add(gid)
    }
    const sub = this.parseSub(local ?? flags, nested + 1)
    if (!this.match(')')) throw this.error('missing ), unterminated subpattern', start)
    if (capture) this.open.delete(gid)
    let js = capture ? `(?<_g${gid}>${sub.js})` : `(?${caseFlag}:${sub.js})`
    if (atomic) js = this.atomic(sub.js)
    return { js, lo: sub.lo, hi: sub.hi }
  }

  /** Inline flags after `(?`: [added, removed, global]. */
  private flags(c: string): [Partial<Flags>, Partial<Flags>, boolean] {
    const add: Partial<Flags> = {}
    const del: Partial<Flags> = {}
    const set = (target: Partial<Flags>, ch: string) => {
      if (ch === 'L') throw this.error("bad inline flags: cannot use 'L' flag with a str pattern", this.pos)
      if (ch === 'u') return
      target[ch as keyof Flags] = true
    }
    let ch: string | undefined = c
    if (c !== '-') {
      for (;;) {
        set(add, ch!)
        ch = this.get()
        if (ch === undefined) throw this.error('missing -, : or )', this.pos)
        if (')-:'.includes(ch)) break
        if (!'aiLmsux'.includes(ch)) {
          throw this.error(ASCII_LETTERS.test(ch) ? 'unknown flag' : 'missing -, : or )', this.pos - ch.length)
        }
      }
    }
    if (ch === ')') return [add, del, true]
    if (ch === '-') {
      ch = this.get()
      if (ch === undefined) throw this.error('missing flag', this.pos)
      if (!'imsx'.includes(ch)) {
        throw this.error(ASCII_LETTERS.test(ch) ? 'unknown flag' : 'missing flag', this.pos - ch.length)
      }
      for (;;) {
        set(del, ch!)
        ch = this.get()
        if (ch === undefined) throw this.error('missing :', this.pos)
        if (ch === ':') break
        if (!'imsx'.includes(ch)) throw this.error(ASCII_LETTERS.test(ch) ? 'unknown flag' : 'missing :', this.pos - ch.length)
      }
    }
    return [add, del, false]
  }

  /** `\d` and its kin, in or out of a class. */
  private category(c: string, flags: Flags): string | null {
    const a = flags.a
    switch (c) {
      case 'd':
        return a ? '[0-9]' : '\\p{Nd}'
      case 'D':
        return a ? '[^0-9]' : '\\P{Nd}'
      case 'w':
        return a ? '[a-zA-Z0-9_]' : WORD
      case 'W':
        return a ? '[^a-zA-Z0-9_]' : NOT_WORD
      case 's':
        return a ? '[ \\t\\n\\r\\f\\v]' : SPACE_CLASS
      case 'S':
        return a ? '[^ \\t\\n\\r\\f\\v]' : NOT_SPACE
    }
    return null
  }

  /** `\x..`, `\u....`, `\U........`: the character, or an error. */
  private hexEscape(tok: string, here: number): number | null {
    const c = tok[1]!
    const n = c === 'x' ? 2 : c === 'u' ? 4 : c === 'U' ? 8 : 0
    if (!n) return null
    const digits = this.getwhile(n, HEX)
    if (digits.length !== n) throw this.error(`incomplete escape ${tok}${digits}`, here)
    const v = parseInt(digits, 16)
    if (v > 0x10ffff) throw this.error(`bad escape ${tok}${digits}`, here)
    return v
  }

  private static readonly ESCAPES: Record<string, number> = { a: 7, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92 }

  private escape(tok: string, flags: Flags, here: number): Item {
    const c = tok[1]!
    const word = flags.a ? '[a-zA-Z0-9_]' : WORD
    if (c === 'A') return { js: '(?<![\\s\\S])', lo: 0, hi: 0, kind: 'at' }
    if (c === 'Z') return { js: '(?![\\s\\S])', lo: 0, hi: 0, kind: 'at' }
    if (c === 'b') return { js: `(?:(?<=${word})(?!${word})|(?<!${word})(?=${word}))`, lo: 0, hi: 0, kind: 'at' }
    if (c === 'B') return { js: `(?:(?<=${word})(?=${word})|(?<!${word})(?!${word}))`, lo: 0, hi: 0, kind: 'at' }
    const cat = this.category(c, flags)
    if (cat) return { js: cat, lo: 1, hi: 1 }
    if (c in Parser.ESCAPES) return { js: lit(Parser.ESCAPES[c]!), lo: 1, hi: 1 }
    const hex = this.hexEscape(tok, here)
    if (hex !== null) return { js: lit(hex), lo: 1, hi: 1 }
    if (c === 'N') throw this.error(`bad escape ${tok}`, here)
    if (c === '0') {
      const more = this.getwhile(2, OCT)
      return { js: lit(parseInt(`0${more}`, 8)), lo: 1, hi: 1 }
    }
    if (DIGITS.test(c)) {
      let esc = c
      if (this.next !== undefined && DIGITS.test(this.next)) {
        esc += this.p[this.pos++]
        if (OCT.test(esc[0]!) && OCT.test(esc[1]!) && this.next !== undefined && OCT.test(this.next)) {
          esc += this.p[this.pos++]
          const v = parseInt(esc, 8)
          if (v > 0o377) throw this.error(`octal escape value \\${esc} outside of range 0-0o377`, here)
          return { js: lit(v), lo: 1, hi: 1 }
        }
      }
      const group = Number(esc)
      if (group < this.groups) {
        if (this.open.has(group)) throw this.error('cannot refer to an open group', here)
        return { js: `\\k<_g${group}>`, lo: 0, hi: MAXWIDTH }
      }
      throw this.error(`invalid group reference ${group}`, here + 1)
    }
    if (ASCII_LETTERS.test(c)) throw this.error(`bad escape ${tok}`, here)
    return { js: lit(c.codePointAt(0)!), lo: 1, hi: 1 }
  }

  /** A class escape: [JS, the character if it is one]. */
  private classEscape(tok: string, flags: Flags, here: number): [string, number | null] {
    const c = tok[1]!
    if (c === 'b') return [lit(8), 8]
    if (c in Parser.ESCAPES) return [lit(Parser.ESCAPES[c]!), Parser.ESCAPES[c]!]
    const cat = this.category(c, flags)
    if (cat) return [cat, null]
    const hex = this.hexEscape(tok, here)
    if (hex !== null) return [lit(hex), hex]
    if (OCT.test(c)) {
      const esc = c + this.getwhile(2, OCT)
      const v = parseInt(esc, 8)
      if (v > 0o377) throw this.error(`octal escape value \\${esc} outside of range 0-0o377`, here)
      return [lit(v), v]
    }
    if (DIGITS.test(c) || ASCII_LETTERS.test(c)) throw this.error(`bad escape ${tok}`, here)
    const cp = c.codePointAt(0)!
    return [lit(cp), cp]
  }

  private charClass(flags: Flags, here: number): Item {
    const negate = this.match('^')
    const parts: string[] = []
    for (;;) {
      const at = this.pos
      const tok = this.get()
      if (tok === undefined) throw this.error('unterminated character set', here)
      if (tok === ']' && parts.length > 0) break
      const [js1, cp1] = tok[0] === '\\' ? this.classEscape(tok, flags, at) : [lit(tok.codePointAt(0)!), tok.codePointAt(0)!]
      if (this.match('-')) {
        const at2 = this.pos
        const that = this.get()
        if (that === undefined) throw this.error('unterminated character set', here)
        if (that === ']') {
          parts.push(js1, lit(0x2d))
          break
        }
        const [, cp2] = that[0] === '\\' ? this.classEscape(that, flags, at2) : [null, that.codePointAt(0)!]
        if (cp1 === null || cp2 === null || cp2 < cp1) throw this.error(`bad character range ${tok}-${that}`, at)
        parts.push(`${lit(cp1)}-${lit(cp2)}`)
      } else parts.push(js1)
    }
    // A JS class needs at least one member; Python's `[^]...` cannot be empty.
    return { js: `[${negate ? '^' : ''}${parts.map((p) => (p.startsWith('\\u{') ? p : p.startsWith('[') ? p : `[${p}]`)).join('')}]`, lo: 1, hi: 1 }
  }
}

const cache = new Map<string, Compiled>()

/** `re.compile(pattern)`, as a JS pattern, or the `re.error` Python raises. */
function compile(pattern: string): Compiled {
  let c = cache.get(pattern)
  if (!c) {
    c = new Parser(pattern).compile()
    cache.set(pattern, c)
  }
  return c
}

/** A match: where it is and its groups (undefined where a group took no part). */
interface Match {
  start: number
  end: number
  text: string
  groups: (string | undefined)[]
}

/** Each match as sre's `finditer` finds them: after an empty match, the next must not be empty where it ended. */
function* finditer(c: Compiled, text: string): Generator<Match> {
  const re = new RegExp(c.source, `${c.flags}gv`)
  let pos = 0
  let mustAdvance = false
  const read = (m: RegExpExecArray): Match => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0],
    groups: Array.from({ length: c.groups }, (_, i) => m.groups?.[`_g${i + 1}`]),
  })
  while (pos <= text.length) {
    let m: RegExpExecArray | null = null
    if (mustAdvance) {
      // A match at pos that ends past it, else the next search from the next character.
      const before = Array.from(text.slice(0, pos)).length
      const sticky = new RegExp(`(?:${c.source})(?<=^[\\s\\S]{${before + 1},})`, `${c.flags}yv`)
      sticky.lastIndex = pos
      m = sticky.exec(text)
      if (!m) {
        if (pos >= text.length) return
        pos += text.codePointAt(pos)! > 0xffff ? 2 : 1
        re.lastIndex = pos
        m = re.exec(text)
      }
    } else {
      re.lastIndex = pos
      m = re.exec(text)
    }
    // V8 tries a lookbehind between a surrogate pair's halves, where no
    // Python position is: skip such a match to the next code point.
    while (m && m.index > 0 && m.index < text.length && /[\uD800-\uDBFF]/.test(text[m.index - 1]!) && /[\uDC00-\uDFFF]/.test(text[m.index]!)) {
      re.lastIndex = m.index + 1
      m = re.exec(text)
    }
    if (!m) return
    const match = read(m)
    yield match
    mustAdvance = match.end === match.start
    pos = match.end
  }
}

/** `re.findall(pattern, text)`: whole matches, a group's text, or tuples (lists) of them. */
function findall(pattern: string, text: string): unknown[] {
  const c = compile(pattern)
  const out: unknown[] = []
  for (const m of finditer(c, text)) {
    if (c.groups === 0) out.push(m.text)
    else if (c.groups === 1) out.push(m.groups[0] ?? '')
    else out.push(m.groups.map((g) => g ?? ''))
  }
  return out
}

/** `parse_template(repl, pattern)`: literal text and group numbers. */
function template(repl: string, c: Compiled): (string | number)[] {
  const s = Array.from(repl)
  const out: (string | number)[] = []
  let literal = ''
  let pos = 0
  const error = (msg: string, at: number) => reError(s, msg, at)
  const addGroup = (index: number, at: number) => {
    if (index > c.groups) throw error(`invalid group reference ${index}`, at)
    out.push(literal, index)
    literal = ''
  }
  while (pos < s.length) {
    const ch = s[pos++]!
    if (ch !== '\\') {
      literal += ch
      continue
    }
    if (pos >= s.length) throw error('bad escape (end of pattern)', s.length - 1)
    const c1 = s[pos++]!
    if (c1 === 'g') {
      if (s[pos] !== '<') throw error('missing <', pos)
      pos++
      let name = ''
      for (;;) {
        const d = s[pos]
        if (d === undefined) {
          if (!name) throw error('missing group name', pos)
          throw error('missing >, unterminated name', pos - name.length)
        }
        pos++
        if (d === '>') break
        name += d
      }
      if (!name) throw error('missing group name', pos - 1)
      let index: number
      if (/^[0-9]+$/.test(name)) {
        index = Number(name)
        if (index >= 1073741823) throw error(`invalid group reference ${index}`, pos - name.length - 1)
      } else {
        if (!/^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*$/u.test(name)) {
          throw error(`bad character in group name ${reprStr(name)}`, pos - name.length - 1)
        }
        const found = c.names.get(name)
        if (found === undefined) throw new PyError(`unknown group name '${name}'`)
        index = found
      }
      addGroup(index, pos - name.length - 1)
    } else if (c1 === '0') {
      let digits = '0'
      if (s[pos] !== undefined && OCT.test(s[pos]!)) {
        digits += s[pos++]
        if (s[pos] !== undefined && OCT.test(s[pos]!)) digits += s[pos++]
      }
      literal += String.fromCodePoint(parseInt(digits, 8) & 0xff)
    } else if (DIGITS.test(c1)) {
      let esc = c1
      let octal = false
      if (s[pos] !== undefined && DIGITS.test(s[pos]!)) {
        esc += s[pos++]
        if (OCT.test(c1) && OCT.test(esc[1]!) && s[pos] !== undefined && OCT.test(s[pos]!)) {
          esc += s[pos++]
          octal = true
          const v = parseInt(esc, 8)
          if (v > 0o377) throw error(`octal escape value \\${esc} outside of range 0-0o377`, pos - esc.length - 1)
          literal += String.fromCodePoint(v)
        }
      }
      if (!octal) addGroup(Number(esc), pos - esc.length)
    } else {
      const esc: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' }
      if (c1 in esc) literal += esc[c1]
      else if (ASCII_LETTERS.test(c1)) throw error(`bad escape \\${c1}`, pos - 2)
      else literal += `\\${c1}`
    }
  }
  out.push(literal)
  return out
}

/** `re.sub(pattern, repl, text)`. */
function sub(pattern: string, repl: string, text: string): string {
  const c = compile(pattern)
  const parts = template(repl, c)
  let out = ''
  let last = 0
  for (const m of finditer(c, text)) {
    out += text.slice(last, m.start)
    for (const part of parts) out += typeof part === 'number' ? (part === 0 ? m.text : (m.groups[part - 1] ?? '')) : part
    last = m.end
  }
  return out + text.slice(last)
}

// --- str.format, as `template_render` runs a model's template ---

/** `ascii(v)`: its repr with every character past ASCII escaped. */
function ascii(v: unknown): string {
  return Array.from(repr(v), (c) => {
    const cp = c.codePointAt(0)!
    if (cp < 0x80) return c
    return cp <= 0xff ? `\\x${cp.toString(16).padStart(2, '0')}` : cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : `\\U${cp.toString(16).padStart(8, '0')}`
  }).join('')
}

/** A parsed format spec (`parse_internal_render_format_spec`). */
interface Spec {
  fill: string
  align: string
  sign: string
  z: boolean
  alt: boolean
  width: number
  grouping: string
  precision: number
  type: string
}

function parseSpec(spec: string, typeName: string, defaultAlign: string, defaultType = ''): Spec {
  const s = Array.from(spec)
  let pos = 0
  const out: Spec = { fill: ' ', align: defaultAlign, sign: '', z: false, alt: false, width: -1, grouping: '', precision: -1, type: '' }
  let fillGiven = false
  let alignGiven = false
  const isAlign = (c: string | undefined) => c !== undefined && '<>=^'.includes(c)
  if (s.length - pos >= 2 && isAlign(s[pos + 1])) {
    out.fill = s[pos]!
    out.align = s[pos + 1]!
    fillGiven = alignGiven = true
    pos += 2
  } else if (isAlign(s[pos])) {
    out.align = s[pos]!
    alignGiven = true
    pos++
  }
  if (s[pos] !== undefined && '+- '.includes(s[pos]!)) out.sign = s[pos++]!
  if (s[pos] === 'z') {
    out.z = true
    pos++
  }
  if (s[pos] === '#') {
    out.alt = true
    pos++
  }
  if (s[pos] === '0' && !fillGiven) {
    out.fill = '0'
    if (!alignGiven && defaultAlign === '>') out.align = '='
    pos++
  }
  const integer = (): number => {
    let digits = ''
    while (s[pos] !== undefined && /^[0-9]$/.test(s[pos]!)) digits += s[pos++]
    if (digits.length > 18 && BigInt(digits) > 9223372036854775807n) throw new PyError('Too many decimal digits in format string')
    return digits ? Number(digits) : -1
  }
  out.width = integer()
  if (s[pos] === ',' || s[pos] === '_') {
    out.grouping = s[pos++]!
    if (s[pos] === ',' || s[pos] === '_') {
      if (s[pos] === out.grouping) throw new PyError(`Cannot specify '${out.grouping}' with '${out.grouping}'.`)
      throw new PyError("Cannot specify both ',' and '_'.")
    }
  }
  if (s[pos] === '.') {
    pos++
    out.precision = integer()
    if (out.precision < 0) throw new PyError('Format specifier missing precision')
  }
  if (s.length - pos > 1) throw new PyError(`Invalid format specifier '${spec}' for object of type '${typeName}'`)
  if (s.length - pos === 1) out.type = s[pos]!
  if (out.grouping) {
    const ok = out.grouping === ',' ? 'deEfFgG%' : 'deEfFgG%boxX'
    const type = out.type || defaultType
    if (type !== '' && !ok.includes(type)) throw new PyError(`Cannot specify '${out.grouping}' with '${type}'.`)
  }
  return out
}

/** Pad a finished field to its width (strings, and numbers not padded by '='). */
function align(text: string, spec: Spec): string {
  const n = Array.from(text).length
  if (spec.width <= n) return text
  const pad = spec.width - n
  if (spec.align === '<') return text + spec.fill.repeat(pad)
  if (spec.align === '^') return spec.fill.repeat(Math.floor(pad / 2)) + text + spec.fill.repeat(pad - Math.floor(pad / 2))
  return spec.fill.repeat(pad) + text
}

/** `_PyUnicode_InsertThousandsGrouping`: digits grouped, zero-filled to `minWidth` when padding with zeros. */
function group(digits: string, sep: string, size: number, minWidth: number): string {
  if (!sep) return digits.length >= minWidth ? digits : '0'.repeat(minWidth - digits.length) + digits
  const groups: string[] = []
  let remaining = digits.length
  let end = digits.length
  for (;;) {
    const l = Math.min(size, Math.max(remaining, minWidth, 1))
    const zeros = Math.max(0, l - remaining)
    const chars = Math.max(0, Math.min(remaining, l))
    groups.unshift('0'.repeat(zeros) + digits.slice(end - chars, end))
    end -= chars
    remaining -= chars
    minWidth -= l
    if (remaining <= 0 && minWidth <= 0) break
    minWidth -= sep.length
  }
  return groups.join(sep)
}

/** A number's parts laid out as `fill_number` does: sign, prefix, grouped digits, the rest. */
function number(sign: string, prefix: string, digits: string, rest: string, spec: Spec, groupSize: number): string {
  const sep = spec.grouping
  const minWidth = spec.fill === '0' && spec.align === '=' ? spec.width - sign.length - prefix.length - Array.from(rest).length : 0
  const grouped = group(digits, sep, groupSize, minWidth)
  const body = grouped + rest
  const n = sign.length + prefix.length + Array.from(body).length
  if (spec.width > n && spec.align === '=') return sign + prefix + spec.fill.repeat(spec.width - n) + body
  return align(sign + prefix + body, spec)
}

function signOf(negative: boolean, spec: Spec): string {
  if (negative) return '-'
  return spec.sign === '+' ? '+' : spec.sign === ' ' ? ' ' : ''
}

/** The exact value of a double as a fraction num / 2**k (k >= 0), num >= 0. */
function fraction(x: number): [bigint, bigint] {
  const [m, e] = exactDouble(Math.abs(x))
  return e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)]
}

/** round(num/den) half to even. */
function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den
  const r = num % den
  return r * 2n > den || (r * 2n === den && q % 2n === 1n) ? q + 1n : q
}

/** |x| to `nd` places: its digits (integer part, fraction) correctly rounded, as dtoa's mode 3. */
function fixedDigits(x: number, nd: number): [string, string] {
  const [num, den] = fraction(x)
  const q = roundDiv(num * 10n ** BigInt(nd), den).toString().padStart(nd + 1, '0')
  return [q.slice(0, q.length - nd), q.slice(q.length - nd)]
}

/** |x| to `p` significant digits (x nonzero): the digits and the exponent of the first, as dtoa's mode 2 before stripping. */
function sigDigits(x: number, p: number): [string, number] {
  const [num, den] = fraction(x)
  let e = Math.floor(Math.log10(Math.abs(x)))
  // Adjust e so that 10**e <= |x| < 10**(e+1), exactly.
  const pow = (k: number) => (k >= 0 ? [10n ** BigInt(k), 1n] : [1n, 10n ** BigInt(-k)])
  for (;;) {
    const [a, b] = pow(e)
    if (num * b < a * den) e--
    else {
      const [c, d] = pow(e + 1)
      if (num * d >= c * den) e++
      else break
    }
  }
  const shift = p - 1 - e
  let q = shift >= 0 ? roundDiv(num * 10n ** BigInt(shift), den) : roundDiv(num, den * 10n ** BigInt(-shift))
  if (q >= 10n ** BigInt(p)) {
    q /= 10n
    e += 1
  }
  return [q.toString(), e]
}

/** `PyOS_double_to_string(x, type, precision, flags)` for e, f, g, r and their upper cases. */
function floatText(x: number, type: string, precision: number, alt: boolean, addDot0: boolean): string {
  const upper = 'EFG'.includes(type)
  const t = type.toLowerCase()
  if (!Number.isFinite(x)) {
    const s = Number.isNaN(x) ? 'nan' : 'inf'
    return upper ? s.toUpperCase() : s
  }
  if (t === 'r') return reprFloat(Math.abs(x))
  const expText = (e: number) => `${upper ? 'E' : 'e'}${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  if (t === 'f') {
    const [ip, fp] = fixedDigits(x, precision)
    return fp ? `${ip}.${fp}` : alt ? `${ip}.` : ip
  }
  if (t === 'e') {
    if (x === 0) return `0${precision > 0 ? `.${'0'.repeat(precision)}` : alt ? '.' : ''}${expText(0)}`
    const [d, e] = sigDigits(x, precision + 1)
    return `${d[0]}${d.length > 1 ? `.${d.slice(1)}` : alt ? '.' : ''}${expText(e)}`
  }
  // 'g': p significant digits, trailing zeros dropped unless alt.
  const p = precision === 0 ? 1 : precision
  let digits: string
  let decpt: number
  if (x === 0) [digits, decpt] = ['0', 1]
  else {
    const [d, e] = sigDigits(x, p)
    digits = alt ? d : d.replace(/0+$/, '') || '0'
    decpt = e + 1
  }
  const useExp = decpt <= -4 || decpt > (addDot0 ? p - 1 : p)
  let vEnd = alt ? p : digits.length
  let exp = 0
  if (useExp) {
    exp = decpt - 1
    decpt = 1
  }
  const vStart = decpt <= 0 ? decpt - 1 : 0
  vEnd = !useExp && addDot0 ? Math.max(vEnd, decpt + 1) : Math.max(vEnd, decpt)
  const digit = (i: number) => (i < 0 || i >= digits.length ? '0' : digits[i]!)
  let out = ''
  for (let i = vStart; i < vEnd; i++) {
    if (i === decpt) out += '.'
    out += digit(i)
  }
  if (vEnd === decpt) out += '.'
  if (out.endsWith('.') && !alt) out = out.slice(0, -1)
  return useExp ? out + expText(exp) : out
}

/** `format(float, spec)`. */
function formatFloat(x: number, spec: Spec, typeName: string): string {
  let type = spec.type
  if (!'eEfFgGn%'.includes(type) || type === '') {
    if (type !== '') throw new PyError(`Unknown format code '${type}' for object of type '${typeName}'`)
  }
  let precision = spec.precision
  let addDot0 = false
  let defaultPrecision = 6
  if (type === '') {
    addDot0 = true
    type = 'r'
    defaultPrecision = 0
  }
  if (type === 'n') type = 'g'
  let v = x
  let pct = false
  if (type === '%') {
    type = 'f'
    v *= 100
    pct = true
  }
  if (precision < 0) precision = defaultPrecision
  else if (type === 'r') type = 'g'
  let text = floatText(v, type, precision, spec.alt, addDot0)
  let negative = v < 0 || Object.is(v, -0)
  if (Number.isNaN(v)) negative = false
  if (spec.z && negative && /^[0.]*(?:[eE].*)?$/.test(text.replace(/[eE][+-]\d+$/, ''))) negative = false
  if (pct) text += '%'
  const m = /^(\d*)(.*)$/s.exec(text)!
  const intPart = Number.isFinite(v) ? m[1]! : ''
  const rest = Number.isFinite(v) ? m[2]! : text
  return number(signOf(negative, spec), '', intPart, rest, spec, 3)
}

/** `format(int, spec)`. */
function formatInt(n: bigint, spec: Spec, typeName: string): string {
  const type = spec.type
  if ('eEfFgG%'.includes(type) && type !== '') {
    const f = Number(n)
    if (!Number.isFinite(f)) throw new PyError('int too large to convert to float')
    return formatFloat(f, spec, typeName)
  }
  if (!'bcdoxXn'.includes(type) && type !== '') throw new PyError(`Unknown format code '${type}' for object of type '${typeName}'`)
  if (spec.precision >= 0) throw new PyError('Precision not allowed in integer format specifier')
  if (spec.z) throw new PyError('Negative zero coercion (z) not allowed in integer format specifier')
  if (type === 'c') {
    if (spec.sign) throw new PyError("Sign not allowed with integer format specifier 'c'")
    if (spec.alt) throw new PyError("Alternate form (#) not allowed with integer format specifier 'c'")
    if (n < 0n || n > 0x10ffffn) throw new PyError('%c arg not in range(0x110000)')
    return align(String.fromCodePoint(Number(n)), spec)
  }
  const radix = type === 'b' ? 2 : type === 'o' ? 8 : type === 'x' || type === 'X' ? 16 : 10
  let digits = (n < 0n ? -n : n).toString(radix)
  if (type === 'X') digits = digits.toUpperCase()
  const prefix = spec.alt && radix !== 10 ? `0${type === 'X' ? 'X' : type}` : ''
  return number(signOf(n < 0n, spec), prefix, digits, '', spec, radix === 10 ? 3 : 4)
}

/** `format(value, spec)` for a JSON value. */
function formatValue(v: unknown, spec: string): string {
  if (spec === '') return str(v)
  const typeName = pyType(v)
  if (typeof v === 'string') {
    const sp = parseSpec(spec, typeName, '<', 's')
    if (sp.type !== '' && sp.type !== 's') throw new PyError(`Unknown format code '${sp.type}' for object of type 'str'`)
    if (sp.sign === ' ') throw new PyError('Space not allowed in string format specifier')
    if (sp.sign) throw new PyError('Sign not allowed in string format specifier')
    if (sp.z) throw new PyError('Negative zero coercion (z) not allowed in string format specifier')
    if (sp.alt) throw new PyError('Alternate form (#) not allowed in string format specifier')
    if (sp.align === '=') throw new PyError("'=' alignment not allowed in string format specifier")
    const cs = Array.from(v)
    return align(sp.precision >= 0 ? cs.slice(0, sp.precision).join('') : v, sp)
  }
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') {
    if (typeof v === 'number' && !Number.isInteger(v)) return formatFloat(v, parseSpec(spec, 'float', '>'), 'float')
    return formatInt(big(v), parseSpec(spec, typeName, '>', 'd'), typeName)
  }
  if (v instanceof PyFloat) return formatFloat(v.v, parseSpec(spec, 'float', '>'), 'float')
  throw new PyError(`unsupported format string passed to ${typeName}.__format__`)
}

/** A field's value: its first name from the keyword arguments, then each `.attr` and `[key]`. */
function fieldValue(name: string, values: Record<string, unknown>): unknown {
  const cs = Array.from(name)
  let i = 0
  let first = ''
  while (i < cs.length && cs[i] !== '.' && cs[i] !== '[') first += cs[i++]
  if (first === '' || /^[0-9]+$/.test(first)) {
    throw new PyError(`Replacement index ${first === '' ? 0 : BigInt(first)} out of range for positional args tuple`)
  }
  if (!Object.hasOwn(values, first)) throw new PyError(reprStr(first))
  let obj: unknown = values[first]
  while (i < cs.length) {
    if (cs[i] === '.') {
      i++
      let attr = ''
      while (i < cs.length && cs[i] !== '.' && cs[i] !== '[') attr += cs[i++]
      if (attr === '') throw new PyError('Empty attribute in format string')
      if ((attr === 'real' || attr === 'imag') && (typeof obj === 'number' || typeof obj === 'bigint' || typeof obj === 'boolean' || obj instanceof PyFloat)) {
        obj = attr === 'real' ? (typeof obj === 'boolean' ? Number(obj) : obj) : obj instanceof PyFloat ? new PyFloat(0) : 0
      } else throw new PyError(`'${pyType(obj)}' object has no attribute '${attr}'`)
    } else if (cs[i] === '[') {
      i++
      let key = ''
      while (i < cs.length && cs[i] !== ']') key += cs[i++]
      if (i >= cs.length) throw new PyError("Missing ']' in format string")
      i++
      const index = /^[0-9]+$/.test(key) ? Number(key) : null
      if (Array.isArray(obj)) {
        if (index === null) throw new PyError('list indices must be integers or slices, not str')
        if (index >= obj.length) throw new PyError('list index out of range')
        obj = obj[index]
      } else if (typeof obj === 'string') {
        if (index === null) throw new PyError("string indices must be integers, not 'str'")
        const chars = Array.from(obj)
        if (index >= chars.length) throw new PyError('string index out of range')
        obj = chars[index]
      } else if (obj !== null && typeof obj === 'object' && !(obj instanceof PyFloat)) {
        const k = index === null ? key : String(index)
        if (index !== null || !Object.hasOwn(obj, k)) throw new PyError(index === null ? reprStr(key) : String(index))
        obj = (obj as Record<string, unknown>)[k]
      } else throw new PyError(`'${pyType(obj)}' object is not subscriptable`)
    } else {
      throw new PyError("Only '.' or '[' may follow ']' in format field specifier")
    }
  }
  return obj
}

/** `template.format(**values)`: `MarkupIterator` over the template, each field rendered. */
function render(template: string, values: Record<string, unknown>, depth = 2): string {
  if (depth <= 0) throw new PyError('Max string recursion exceeded')
  const s = Array.from(template)
  let pos = 0
  let out = ''
  while (pos < s.length) {
    // Literal text up to a '{' or '}'.
    let c = ''
    let markup = false
    while (pos < s.length) {
      c = s[pos++]!
      if (c === '{' || c === '}') {
        markup = true
        break
      }
      out += c
    }
    if (!markup) break
    const atEnd = pos >= s.length
    if (c === '}' && (atEnd || s[pos] !== '}')) throw new PyError("Single '}' encountered in format string")
    if (atEnd && c === '{') throw new PyError("Single '{' encountered in format string")
    if (s[pos] === c) {
      out += c
      pos++
      continue
    }
    // `parse_field`: the name up to '}', ':' or '!' (brackets skipped), then a conversion and a spec.
    const nameStart = pos
    let end = ''
    while (pos < s.length) {
      const d = s[pos++]!
      if (d === '{') throw new PyError("unexpected '{' in field name")
      if (d === '[') {
        while (pos < s.length && s[pos] !== ']') pos++
        continue
      }
      if (d === '}' || d === ':' || d === '!') {
        end = d
        break
      }
    }
    const name = s.slice(nameStart, end ? pos - 1 : pos).join('')
    let conversion = ''
    let spec = ''
    let expand = false
    if (end === '!' || end === ':') {
      let specFollows = true
      if (end === '!') {
        if (pos >= s.length) throw new PyError('end of string while looking for conversion specifier')
        conversion = s[pos++]!
        if (pos < s.length) {
          const d = s[pos++]!
          if (d === '}') specFollows = false
          else if (d !== ':') throw new PyError("expected ':' after conversion specifier")
        }
      }
      if (specFollows) {
        const specStart = pos
        let count = 1
        let closed = false
        while (pos < s.length) {
          const d = s[pos++]!
          if (d === '{') {
            expand = true
            count++
          } else if (d === '}') {
            count--
            if (count === 0) {
              spec = s.slice(specStart, pos - 1).join('')
              closed = true
              break
            }
          }
        }
        if (!closed) throw new PyError("unmatched '{' in format spec")
      }
    } else if (end !== '}') throw new PyError("expected '}' before end of string")
    let value = fieldValue(name, values)
    if (conversion) {
      if (conversion === 'r') value = repr(value)
      else if (conversion === 's') value = str(value)
      else if (conversion === 'a') value = ascii(value)
      else {
        const cp = conversion.codePointAt(0)!
        throw new PyError(`Unknown conversion specifier ${cp > 32 && cp < 127 ? conversion : `\\x${cp.toString(16)}`}`)
      }
    }
    if (expand) spec = render(spec, values, depth - 1)
    out += formatValue(value, spec)
  }
  return out
}

// --- the tools ---

/** `\w+|[^\<TAB>\n\w ]`: a run of word characters, or one character that is none of those nor a tab, newline or space. */
const TOKEN = /[\p{L}\p{N}_]+|[^\t\n\p{L}\p{N}_ ]/gu

const tokenize = (text: string): string[] => text.match(TOKEN) ?? []

const PY_SPACE_RUN = new RegExp(`[${SPACE}]+`, 'gu')

/** `str.encode("ascii")`, or the UnicodeEncodeError it raises over the run of characters it cannot encode. */
function encodeAscii(s: string): Buffer {
  const cs = Array.from(s)
  const start = cs.findIndex((c) => c.codePointAt(0)! > 0x7f)
  if (start < 0) return Buffer.from(s, 'latin1')
  let end = start
  while (end < cs.length && cs[end]!.codePointAt(0)! > 0x7f) end++
  if (end - start === 1) {
    const cp = cs[start]!.codePointAt(0)!
    const esc = cp <= 0xff ? `x${cp.toString(16).padStart(2, '0')}` : cp <= 0xffff ? `u${cp.toString(16).padStart(4, '0')}` : `U${cp.toString(16).padStart(8, '0')}`
    throw new PyError(`'ascii' codec can't encode character '\\${esc}' in position ${start}: ordinal not in range(128)`)
  }
  throw new PyError(`'ascii' codec can't encode characters in position ${start}-${end - 1}: ordinal not in range(128)`)
}

/** `hashlib.new(algo)`'s names: Python's own (exact), then OpenSSL's (any case, trailing spaces dropped). */
const PY_HASHES: Record<string, string> = {
  sha3_224: 'sha3-224',
  sha3_256: 'sha3-256',
  sha3_384: 'sha3-384',
  sha3_512: 'sha3-512',
  shake_128: 'xof',
  shake_256: 'xof',
  blake2b: 'blake2b512',
  blake2s: 'blake2s256',
}
const OPENSSL_HASHES: Record<string, string> = Object.fromEntries(
  Object.entries({
    sha1: ['1.3.14.3.2.26', 'sha-1', 'sha1', 'ssl3-sha1'],
    sha224: ['2.16.840.1.101.3.4.2.4', 'sha-224', 'sha2-224', 'sha224'],
    sha256: ['2.16.840.1.101.3.4.2.1', 'sha-256', 'sha2-256', 'sha256'],
    'sha256-192': ['sha-256/192', 'sha2-256/192', 'sha256-192'],
    sha384: ['2.16.840.1.101.3.4.2.2', 'sha-384', 'sha2-384', 'sha384'],
    sha512: ['2.16.840.1.101.3.4.2.3', 'sha-512', 'sha2-512', 'sha512'],
    'sha512-224': ['2.16.840.1.101.3.4.2.5', 'sha-512/224', 'sha2-512/224', 'sha512-224', 'sha512_224'],
    'sha512-256': ['2.16.840.1.101.3.4.2.6', 'sha-512/256', 'sha2-512/256', 'sha512-256', 'sha512_256'],
    'sha3-224': ['2.16.840.1.101.3.4.2.7', 'sha3-224'],
    'sha3-256': ['2.16.840.1.101.3.4.2.8', 'sha3-256'],
    'sha3-384': ['2.16.840.1.101.3.4.2.9', 'sha3-384'],
    'sha3-512': ['2.16.840.1.101.3.4.2.10', 'sha3-512'],
    'keccak-224': ['keccak-224'],
    'keccak-256': ['keccak-256'],
    'keccak-384': ['keccak-384'],
    'keccak-512': ['keccak-512'],
    xof: ['2.16.840.1.101.3.4.2.11', '2.16.840.1.101.3.4.2.12', 'keccak-kmac-128', 'keccak-kmac-256', 'keccak-kmac128', 'keccak-kmac256', 'shake-128', 'shake-256', 'shake128', 'shake256'],
    blake2s256: ['1.3.6.1.4.1.1722.12.2.2.8', 'blake2s-256', 'blake2s256'],
    blake2b512: ['1.3.6.1.4.1.1722.12.2.1.16', 'blake2b-512', 'blake2b512'],
    sm3: ['1.2.156.10197.1.401', 'sm3'],
    md5: ['1.2.840.113549.2.5', 'md5', 'ssl3-md5'],
    'md5-sha1': ['md5-sha1'],
    ripemd160: ['1.3.36.3.2.1', 'ripemd', 'ripemd-160', 'ripemd160', 'rmd160'],
    null: ['null'],
  }).flatMap(([algo, names]) => names.map((n) => [n, algo])),
)

/** Keccak-f[1600] with the original padding (0x01), which OpenSSL's KECCAK-* are and node's createHash lacks. */
function keccak(data: Uint8Array, bits: number): string {
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ]
  const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]
  const M = (1n << 64n) - 1n
  const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M)
  const rate = 200 - (2 * bits) / 8
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate)
  padded.set(data)
  padded[data.length]! ^= 0x01
  padded[padded.length - 1]! ^= 0x80
  const A: bigint[] = Array(25).fill(0n)
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]!)
      A[i] = A[i]! ^ lane
    }
    for (let round = 0; round < 24; round++) {
      const C = [0, 1, 2, 3, 4].map((x) => A[x]! ^ A[x + 5]! ^ A[x + 10]! ^ A[x + 15]! ^ A[x + 20]!)
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5]! ^ rotl(C[(x + 1) % 5]!, 1)
        for (let y = 0; y < 25; y += 5) A[x + y] = A[x + y]! ^ D
      }
      const B: bigint[] = Array(25).fill(0n)
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y]!, ROT[x + 5 * y]!)
      for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) A[x + y] = B[x + y]! ^ (~B[((x + 1) % 5) + y]! & M & B[((x + 2) % 5) + y]!)
      A[0] = A[0]! ^ RC[round]!
    }
  }
  let out = ''
  for (let i = 0; out.length < bits / 4; i++) for (let b = 0; b < 8 && out.length < bits / 4; b++) out += ((A[i]! >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0')
  return out
}

/** `hashlib.new(algo)` over `data`, as `hexdigest()`. */
function hexdigest(algo: string, data: Uint8Array): string {
  const name = PY_HASHES[algo] ?? OPENSSL_HASHES[algo.replace(/ +$/, '').toLowerCase()]
  if (name === undefined) throw new PyError(`unsupported hash type ${algo}`)
  if (name === 'xof') throw new PyError("hexdigest() missing required argument 'length' (pos 1)")
  if (name === 'null') return ''
  if (name.startsWith('keccak-')) return keccak(data, Number(name.slice(7)))
  if (name === 'sha256-192') return createHash('sha256').update(data).digest('hex').slice(0, 48)
  return createHash(name).update(data).digest('hex')
}

/** `text[:length - 3] + "..."` and its kin: Python's slice of code points, negative stops included. */
const head = (cs: string[], stop: number) => cs.slice(0, stop < 0 ? Math.max(0, cs.length + stop) : stop).join('')

/** A tool that calls another tool's `.fn` without awaiting it, and fails on the coroutine. */
const coroutine = (message: string) => () => {
  throw new PyError(message)
}

const text: ParamSpec[] = [['text', 'str']]

export const tools = plainTools({
  tokenize: [text, 'list[str]', ({ text }) => tokenize(text)],
  detokenize: [[['tokens', 'list[str]']], 'string', ({ tokens }) => tokens.join(' ')],
  normalize_whitespace: [text, 'string', ({ text }) => strip(text.replace(PY_SPACE_RUN, ' '))],
  remove_punctuation: [text, 'string', ({ text }) => text.replace(new RegExp(`[^\\p{L}\\p{N}_${SPACE}]`, 'gu'), '')],
  count_words: [text, 'integer', coroutine("object of type 'coroutine' has no len()")],
  word_freq: [text, 'dict', coroutine("'coroutine' object is not iterable")],
  sentence_split: [
    text,
    'list[str]',
    ({ text }) => {
      const sents = strip(text).split(new RegExp(`(?<=[.!?])[${SPACE}]+`, 'u'))
      return sents.filter((s) => s)
    },
  ],
  simple_summarize: [[['text', 'str'], ['max_sentences', 'int', 3]], 'string', coroutine("'coroutine' object is not iterable")],
  levenshtein: [
    [
      ['a', 'str'],
      ['b', 'str'],
    ],
    'integer',
    ({ a, b }) => {
      if (a === b) return 0
      const x = Array.from(a as string)
      const y = Array.from(b as string)
      const dp = Array.from({ length: y.length + 1 }, (_, i) => i)
      for (let i = 1; i <= x.length; i++) {
        let prev = dp[0]!
        dp[0] = i
        for (let j = 1; j <= y.length; j++) {
          const cur = dp[j]!
          dp[j] = x[i - 1] === y[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!)
          prev = cur
        }
      }
      return dp[y.length]
    },
  ],
  jaccard_similarity: [
    [
      ['a', 'str'],
      ['b', 'str'],
    ],
    'number',
    coroutine("'coroutine' object is not iterable"),
  ],
  ngrams: [[['text', 'str'], ['n', 'int', 2]], 'list[str]', coroutine("object of type 'coroutine' has no len()")],
  to_lower: [text, 'string', ({ text }) => lower(text)],
  to_upper: [text, 'string', ({ text }) => upper(text)],
  title_case: [text, 'string', ({ text }) => title(text)],
  snake_case: [text, 'string', coroutine("'coroutine' object is not iterable")],
  camel_case: [text, 'string', coroutine("'coroutine' object is not iterable")],
  slugify: [text, 'string', coroutine("'coroutine' object has no attribute 'lower'")],
  extract_numbers: [
    text,
    'list[float]',
    ({ text }) => (text.match(/-?\p{Nd}+\.?\p{Nd}*/gu) ?? []).map((x: string) => parseFloatStr(x)),
  ],
  hash_text: [
    [
      ['text', 'str'],
      ['algo', 'str', 'sha256'],
    ],
    'string',
    ({ text, algo }) => hexdigest(algo, encode(text)),
  ],
  base64_encode: [text, 'string', ({ text }) => encode(text).toString('base64')],
  base64_decode: [[['b64', 'str']], 'string', ({ b64 }) => decodeUtf8(b64decode(encodeAscii(b64)))],
  is_palindrome: [
    text,
    'boolean',
    ({ text }) => {
      const s = Array.from(lower(text).replace(/[^a-z0-9]/gu, ''))
      return s.join('') === [...s].reverse().join('')
    },
  ],
  regex_search: [
    [
      ['pattern', 'str'],
      ['text', 'str'],
    ],
    'list[str]',
    ({ pattern, text }) => findall(pattern, text),
  ],
  replace: [
    [
      ['pattern', 'str'],
      ['repl', 'str'],
      ['text', 'str'],
    ],
    'string',
    ({ pattern, repl, text }) => sub(pattern, repl, text),
  ],
  truncate: [
    [
      ['text', 'str'],
      ['length', 'int', 100],
    ],
    'string',
    ({ text, length }) => {
      const cs = Array.from(text as string)
      return cs.length <= length ? text : `${head(cs, length - 3)}...`
    },
  ],
  read_time_estimate: [[['text', 'str'], ['wpm', 'int', 200]], 'number', coroutine("unsupported operand type(s) for /: 'coroutine' and 'int'")],
  remove_stopwords: [text, 'string', coroutine("'coroutine' object is not iterable")],
  simple_paraphrase: [text, 'string', coroutine("'coroutine' object is not iterable")],
  syllable_estimate: [
    [['word', 'str']],
    'integer',
    ({ word }) => {
      const w = lower(word).replace(/e(?=\n?$)/u, '')
      return Math.max(1, (w.match(/[aeiouy]+/gu) ?? []).length)
    },
  ],
  ordinal: [
    [['n', 'int']],
    'string',
    ({ n }) => {
      const b = big(n)
      const mod = (k: bigint) => ((b % k) + k) % k
      const suf = 10n <= mod(100n) && mod(100n) <= 20n ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<string, string>)[String(mod(10n))] ?? 'th'
      return `${b}${suf}`
    },
  ],
  count_chars: [text, 'integer', ({ text }) => Array.from(text as string).length],
  template_render: [
    [
      ['template', 'str'],
      ['values', 'dict'],
    ],
    'string',
    ({ template, values }) => render(template, values),
  ],
})
