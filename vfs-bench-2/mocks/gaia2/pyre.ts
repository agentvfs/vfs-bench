/**
 * Python's `re.compile(pattern, flags)` for a str pattern, as a JavaScript
 * RegExp, for the Gaia2 fakes whose commands take a regex
 * (`re.compile(query, re.IGNORECASE)` and `re.search`).
 *
 * The pattern is parsed as CPython 3.12's `re._parser` parses it, statement
 * for statement where it decides what is an error, so a bad pattern raises
 * the `re.error` Python raises, with its message and position
 * (`nothing to repeat at position 0`); the compiler's look-behind width
 * check and the `OverflowError` for huge repeats are kept too. A good
 * pattern is emitted as a RegExp (flag `v`) with Python's meaning:
 *
 * - `.` is any character but `\n` (any with DOTALL); `^`, `$`, `\A`, `\Z`
 *   are Python's anchors (`$` also before a final `\n`; MULTILINE lines end
 *   at `\n` only);
 * - `\d`, `\w`, `\s`, `\b` are Python's Unicode classes (`\w` letters,
 *   numbers and `_`; `\s` `str.isspace()`), or ASCII ones under `(?a)`;
 * - escapes Python allows (`\x41`, `A`, `\U0001F600`, octal, `\-` and
 *   any other non-letter) become the literal; group references are
 *   renumbered; inline flags (`(?i)`, `(?s:...)`, `(?-i:...)`, `(?x)`
 *   verbose) are applied as Python applies them;
 * - atomic groups and possessive repeats (`(?>...)`, `a*+`) are emulated
 *   with a look-ahead and a back-reference.
 *
 * What differs: conditional groups (`(?(1)a|b)`) and named characters
 * (`\N{EM DASH}`) raise a NotImplementedError; IGNORECASE is JavaScript's
 * simple case folding, where Python's adds a few special folds (and keeps
 * them under `(?a)`); Python's FutureWarnings for possible nested sets are
 * not printed.
 */
import { PyError } from './store.ts'
import { strRepr } from './pyrepr.ts'

const MAXREPEAT = 4294967295
const MAXCODE = 4294967295
const SPECIAL = '.\\[{()*+?^$|'
const REPEAT = '*+?{'
const DIGITS = '0123456789'
const OCTDIGITS = '01234567'
const HEXDIGITS = '0123456789abcdefABCDEF'
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\v', '\f'])
const FLAGS = 'iLmsxatu'

const isLetter = (c: string) => /^[A-Za-z]$/.test(c)
/** `len(s)` in code points. */
const cplen = (s: string) => Array.from(s).length
const hex = (cp: number) => `\\u{${cp.toString(16)}}`

/** Python's `str.isspace()` characters, as class contents. */
const SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const ASCII_SPACE = ' \\t\\n\\r\\f\\v'
const WORD = '\\p{L}\\p{N}_'
const ASCII_WORD = 'a-zA-Z0-9_'

type Flag = 'i' | 'L' | 'm' | 's' | 'x' | 'a' | 't' | 'u'
type Flags = Partial<Record<Flag, boolean>>

/** A piece of the RegExp's source: text, a capture's opening (by id) or a back-reference to one. */
type Part = string | { open: number } | { ref: number }

type Op = 'LITERAL' | 'IN' | 'ANY' | 'AT' | 'REPEAT' | 'SUBPATTERN' | 'ASSERT' | 'GROUPREF' | 'ATOMIC' | 'BRANCH'

interface Item {
  op: Op
  parts: Part[]
  lo: number
  hi: number
}

interface Sub {
  parts: Part[]
  lo: number
  hi: number
}

/** `re.error(msg, pattern, pos)`'s `str()`. */
function reError(msg: string, pattern: string[] | null, pos: number | null): PyError {
  if (pattern !== null && pos !== null) {
    msg = `${msg} at position ${pos}`
    if (pattern.includes('\n')) {
      const before = pattern.slice(0, pos)
      const lineno = before.filter((c) => c === '\n').length + 1
      const colno = pos - before.lastIndexOf('\n')
      msg = `${msg} (line ${lineno}, column ${colno})`
    }
  }
  return new PyError('re.error', msg)
}

const unsupported = (what: string) => new PyError('NotImplementedError', `${what} are not supported in this regex engine`)

/** `re._parser.Tokenizer` over the pattern's code points. */
class Tokenizer {
  readonly s: string[]
  index = 0
  next: string | null = null
  constructor(pattern: string) {
    this.s = Array.from(pattern)
    this.advance()
  }
  private advance(): void {
    let index = this.index
    if (index >= this.s.length) {
      this.next = null
      return
    }
    let char = this.s[index]!
    if (char === '\\') {
      index += 1
      if (index >= this.s.length) throw reError('bad escape (end of pattern)', this.s, this.s.length - 1)
      char += this.s[index]!
    }
    this.index = index + 1
    this.next = char
  }
  match(char: string): boolean {
    if (char === this.next) {
      this.advance()
      return true
    }
    return false
  }
  get(): string | null {
    const t = this.next
    this.advance()
    return t
  }
  getwhile(n: number, charset: string): string {
    let result = ''
    for (let i = 0; i < n; i++) {
      const c = this.next
      if (c === null || c.length !== 1 || !charset.includes(c)) break
      result += c
      this.advance()
    }
    return result
  }
  getuntil(terminator: string, name: string): string {
    let result = ''
    for (;;) {
      const c = this.next
      this.advance()
      if (c === null) {
        if (!result) throw this.error(`missing ${name}`)
        throw this.error(`missing ${terminator}, unterminated name`, cplen(result))
      }
      if (c === terminator) {
        if (!result) throw this.error(`missing ${name}`, 1)
        break
      }
      result += c
    }
    return result
  }
  tell(): number {
    return this.index - (this.next === null ? 0 : cplen(this.next))
  }
  seek(index: number): void {
    this.index = index
    this.advance()
  }
  error(msg: string, offset = 0): PyError {
    return reError(msg, this.s, this.tell() - offset)
  }
  checkgroupname(name: string, offset: number): void {
    if (!/^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(name)) throw this.error(`bad character in group name ${strRepr(name)}`, cplen(name) + offset)
  }
}

/** `re._parser.State`, with what the emitter needs. */
class State {
  flags: Flags = {}
  groupdict = new Map<string, number>()
  groupwidths: ([number, number] | null)[] = [null]
  lookbehindgroups: number | null = null
  /** Each look-behind's width, in the order the compiler meets them. */
  lookbehinds: ([number, number] | null)[] = []
  /** Ids for the captures that emulate atomic groups (negative, so apart from Python's groups). */
  helpers = 0
  get groups(): number {
    return this.groupwidths.length
  }
  opengroup(name: string | null): number {
    const gid = this.groups
    this.groupwidths.push(null)
    if (name !== null) {
      const ogid = this.groupdict.get(name)
      if (ogid !== undefined) throw new PyError('re.error', `redefinition of group name ${strRepr(name)} as group ${gid}; was group ${ogid}`)
      this.groupdict.set(name, gid)
    }
    return gid
  }
  checkgroup(gid: number): boolean {
    return gid < this.groups && this.groupwidths[gid] !== null
  }
  checklookbehindgroup(gid: number, source: Tokenizer): void {
    if (this.lookbehindgroups !== null) {
      if (!this.checkgroup(gid)) throw source.error('cannot refer to an open group')
      if (gid >= this.lookbehindgroups) throw source.error('cannot refer to group defined in the same lookbehind subpattern')
    }
  }
}

/** The flags in force for an item: the pattern's, then its scoped groups'. */
const on = (state: State, scoped: Flags, flag: Flag): boolean => scoped[flag] ?? state.flags[flag] ?? false

type Category = 'd' | 'D' | 's' | 'S' | 'w' | 'W'

/** A category escape as class contents (`\d` inside `[...]`). */
function category(c: Category, ascii: boolean): string {
  switch (c) {
    case 'd': return ascii ? '0-9' : '\\p{Nd}'
    case 'D': return ascii ? '[^0-9]' : '\\P{Nd}'
    case 's': return ascii ? ASCII_SPACE : SPACE
    case 'S': return `[^${ascii ? ASCII_SPACE : SPACE}]`
    case 'w': return ascii ? ASCII_WORD : WORD
    case 'W': return `[^${ascii ? ASCII_WORD : WORD}]`
  }
}

const unit = (op: Op, text: string): Item => ({ op, parts: [text], lo: 1, hi: 1 })
const at = (text: string): Item => ({ op: 'AT', parts: [text], lo: 0, hi: 0 })

const START = '(?<![\\s\\S])'
const END = '(?![\\s\\S])'

function boundary(word: string, negate: boolean): string {
  const w = `[${word}]`
  // Python's \B never matches in an empty string (CPython 3.12's sre).
  return negate ? `(?!${START}${END})(?:(?<=${w})(?=${w})|(?<!${w})(?!${w}))` : `(?:(?<=${w})(?!${w})|(?<!${w})(?=${w}))`
}

/** A class escape (`_class_escape`): class contents, or a code point. */
function classEscape(source: Tokenizer, escape: string): { cat: Category } | { cp: number } {
  const simple: Record<string, number> = { '\\a': 7, '\\b': 8, '\\f': 12, '\\n': 10, '\\r': 13, '\\t': 9, '\\v': 11, '\\\\': 92 }
  if (escape in simple) return { cp: simple[escape]! }
  if (/^\\[dDsSwW]$/.test(escape)) return { cat: escape[1] as Category }
  const c = escape.slice(1)
  if (c === 'x') {
    escape += source.getwhile(2, HEXDIGITS)
    if (cplen(escape) !== 4) throw source.error(`incomplete escape ${escape}`, cplen(escape))
    return { cp: parseInt(escape.slice(2), 16) }
  }
  if (c === 'u') {
    escape += source.getwhile(4, HEXDIGITS)
    if (cplen(escape) !== 6) throw source.error(`incomplete escape ${escape}`, cplen(escape))
    return { cp: parseInt(escape.slice(2), 16) }
  }
  if (c === 'U') {
    escape += source.getwhile(8, HEXDIGITS)
    if (cplen(escape) !== 10) throw source.error(`incomplete escape ${escape}`, cplen(escape))
    const cp = parseInt(escape.slice(2), 16)
    if (cp > 0x10ffff) throw source.error(`bad escape ${escape}`, cplen(escape))
    return { cp }
  }
  if (c === 'N') throw unsupported('named characters (\\N{...})')
  if (OCTDIGITS.includes(c)) {
    escape += source.getwhile(2, OCTDIGITS)
    const cp = parseInt(escape.slice(1), 8)
    if (cp > 0o377) throw source.error(`octal escape value ${escape} outside of range 0-0o377`, cplen(escape))
    return { cp }
  }
  if (DIGITS.includes(c)) throw source.error(`bad escape ${escape}`, cplen(escape))
  if (cplen(escape) === 2) {
    if (isLetter(c)) throw source.error(`bad escape ${escape}`, cplen(escape))
    return { cp: c.codePointAt(0)! }
  }
  throw source.error(`bad escape ${escape}`, cplen(escape))
}

/** An escape outside a class (`_escape`). */
function escapeItem(source: Tokenizer, escape: string, state: State, scoped: Flags): Item {
  const ascii = on(state, scoped, 'a')
  switch (escape) {
    case '\\A': return at(START)
    case '\\Z': return at(END)
    case '\\b': return at(ascii ? boundary(ASCII_WORD, false) : boundary(WORD, false))
    case '\\B': return at(ascii ? boundary(ASCII_WORD, true) : boundary(WORD, true))
  }
  if (/^\\[dDsSwW]$/.test(escape)) return unit('IN', `[${category(escape[1] as Category, ascii)}]`)
  const simple: Record<string, number> = { '\\a': 7, '\\f': 12, '\\n': 10, '\\r': 13, '\\t': 9, '\\v': 11, '\\\\': 92 }
  if (escape in simple) return unit('LITERAL', hex(simple[escape]!))
  const c = escape.slice(1)
  if (c === 'x' || c === 'u' || c === 'U' || c === 'N') {
    const r = classEscape(source, escape)
    return unit('LITERAL', hex((r as { cp: number }).cp))
  }
  if (c === '0') {
    escape += source.getwhile(2, OCTDIGITS)
    return unit('LITERAL', hex(parseInt(escape.slice(1), 8)))
  }
  if (DIGITS.includes(c)) {
    if (source.next !== null && source.next.length === 1 && DIGITS.includes(source.next)) {
      escape += source.get()!
      if (OCTDIGITS.includes(escape[1]!) && OCTDIGITS.includes(escape[2]!) && source.next !== null && source.next.length === 1 && OCTDIGITS.includes(source.next)) {
        escape += source.get()!
        const cp = parseInt(escape.slice(1), 8)
        if (cp > 0o377) throw source.error(`octal escape value ${escape} outside of range 0-0o377`, cplen(escape))
        return unit('LITERAL', hex(cp))
      }
    }
    const group = parseInt(escape.slice(1), 10)
    if (group < state.groups) {
      if (!state.checkgroup(group)) throw source.error('cannot refer to an open group', cplen(escape))
      state.checklookbehindgroup(group, source)
      const [lo, hi] = state.groupwidths[group]!
      return { op: 'GROUPREF', parts: ['(?:', { ref: group }, ')'], lo, hi }
    }
    throw source.error(`invalid group reference ${group}`, cplen(escape) - 1)
  }
  if (cplen(escape) === 2) {
    if (isLetter(c)) throw source.error(`bad escape ${escape}`, cplen(escape))
    return unit('LITERAL', hex(c.codePointAt(0)!))
  }
  throw source.error(`bad escape ${escape}`, cplen(escape))
}

/** `_parse_sub`: an alternation. */
function parseSub(source: Tokenizer, state: State, verbose: boolean, nested: number, scoped: Flags): Sub {
  const items: Sub[] = []
  for (;;) {
    items.push(parse(source, state, verbose, nested + 1, scoped, !nested && items.length === 0))
    if (!source.match('|')) break
    if (!nested) verbose = state.flags.x ?? false
  }
  if (items.length === 1) return items[0]!
  const parts: Part[] = ['(?:']
  items.forEach((item, i) => {
    if (i > 0) parts.push('|')
    parts.push(...item.parts)
  })
  parts.push(')')
  return { parts, lo: Math.min(...items.map((x) => x.lo)), hi: Math.max(...items.map((x) => x.hi)) }
}

/** `_parse_flags`: a scoped group's flags, or null for global ones (now in `state.flags`). */
function parseFlags(source: Tokenizer, state: State, char: string | null): { add: Flags; del: Flags } | null {
  const add: Flags = {}
  const del: Flags = {}
  const isFlag = (c: string | null): c is Flag => c !== null && c.length === 1 && FLAGS.includes(c)
  const typeFlags = (f: Flags) => (['a', 'L', 'u'] as Flag[]).filter((x) => f[x])
  if (char !== '-') {
    for (;;) {
      const flag = char as Flag
      if (flag === 'L') throw source.error("bad inline flags: cannot use 'L' flag with a str pattern")
      add[flag] = true
      if ((flag === 'a' || flag === 'u') && typeFlags(add).length > 1) throw source.error("bad inline flags: flags 'a', 'u' and 'L' are incompatible")
      char = source.get()
      if (char === null) throw source.error('missing -, : or )')
      if (')-:'.includes(char) && char.length === 1) break
      if (!isFlag(char)) throw source.error(/^\p{L}$/u.test(char) ? 'unknown flag' : 'missing -, : or )', cplen(char))
    }
  }
  if (char === ')') {
    Object.assign(state.flags, add)
    return null
  }
  if (add.t) throw source.error('bad inline flags: cannot turn on global flag', 1)
  if (char === '-') {
    char = source.get()
    if (char === null) throw source.error('missing flag')
    if (!isFlag(char)) throw source.error(/^\p{L}$/u.test(char) ? 'unknown flag' : 'missing flag', cplen(char))
    for (;;) {
      const flag = char as Flag
      if (flag === 'a' || flag === 'u' || flag === 'L') throw source.error("bad inline flags: cannot turn off flags 'a', 'u' and 'L'")
      del[flag] = true
      char = source.get()
      if (char === null) throw source.error('missing :')
      if (char === ':') break
      if (!isFlag(char)) throw source.error(/^\p{L}$/u.test(char) ? 'unknown flag' : 'missing :', cplen(char))
    }
  }
  if (del.t) throw source.error('bad inline flags: cannot turn off global flag', 1)
  if ((Object.keys(add) as Flag[]).some((f) => del[f])) throw source.error('bad inline flags: flag turned on and off', 1)
  return { add, del }
}

/** `_parse`: a sequence. */
function parse(source: Tokenizer, state: State, verbose: boolean, nested: number, scoped: Flags, first = false): Sub {
  const items: Item[] = []
  for (;;) {
    let char = source.next
    if (char === null) break
    if (char === '|' || char === ')') break
    source.get()
    if (verbose) {
      if (WHITESPACE.has(char)) continue
      if (char === '#') {
        for (;;) {
          const c = source.get()
          if (c === null || c === '\n') break
        }
        continue
      }
    }
    if (char[0] === '\\') items.push(escapeItem(source, char, state, scoped))
    else if (!SPECIAL.includes(char)) items.push(unit('LITERAL', hex(char.codePointAt(0)!)))
    else if (char === '[') items.push(charset(source, state, scoped))
    else if (REPEAT.includes(char)) {
      const here = source.tell()
      let min: number
      let max: number
      if (char === '?') [min, max] = [0, 1]
      else if (char === '*') [min, max] = [0, MAXREPEAT]
      else if (char === '+') [min, max] = [1, MAXREPEAT]
      else {
        if (source.next === '}') {
          items.push(unit('LITERAL', hex(0x7b)))
          continue
        }
        ;[min, max] = [0, MAXREPEAT]
        let lo = ''
        let hi = ''
        while (source.next !== null && source.next.length === 1 && DIGITS.includes(source.next)) lo += source.get()
        if (source.match(',')) {
          while (source.next !== null && source.next.length === 1 && DIGITS.includes(source.next)) hi += source.get()
        } else hi = lo
        if (!source.match('}')) {
          items.push(unit('LITERAL', hex(0x7b)))
          source.seek(here)
          continue
        }
        if (lo) {
          min = Number(lo)
          if (min >= MAXREPEAT) throw new PyError('OverflowError', 'the repetition number is too large')
        }
        if (hi) {
          max = Number(hi)
          if (max >= MAXREPEAT) throw new PyError('OverflowError', 'the repetition number is too large')
          if (max < min) throw source.error('min repeat greater than max repeat', source.tell() - here)
        }
      }
      const item = items[items.length - 1]
      if (item === undefined || item.op === 'AT') throw source.error('nothing to repeat', source.tell() - here + cplen(char))
      if (item.op === 'REPEAT') throw source.error('multiple repeat', source.tell() - here + cplen(char))
      const q = char === '{' ? `{${min},${max === MAXREPEAT ? '' : max}}` : char
      const lo = item.lo * min
      const hi = max === MAXREPEAT && item.hi ? Infinity : item.hi * max
      let parts: Part[]
      if (source.match('?')) parts = ['(?:', ...item.parts, ')', q, '?']
      else if (source.match('+')) {
        const h = -++state.helpers
        parts = ['(?:(?=', { open: h }, '(?:', ...item.parts, ')', q, '))', { ref: h }, ')']
      } else parts = ['(?:', ...item.parts, ')', q]
      items[items.length - 1] = { op: 'REPEAT', parts, lo, hi }
    } else if (char === '.') items.push(unit('ANY', on(state, scoped, 's') ? '[\\s\\S]' : '[^\\n]'))
    else if (char === '(') {
      const start = source.tell() - 1
      let capture = true
      let atomic = false
      let name: string | null = null
      let flags: { add: Flags; del: Flags } | null = null
      if (source.match('?')) {
        char = source.get()
        if (char === null) throw source.error('unexpected end of pattern')
        if (char === 'P') {
          if (source.match('<')) {
            name = source.getuntil('>', 'group name')
            source.checkgroupname(name, 1)
          } else if (source.match('=')) {
            name = source.getuntil(')', 'group name')
            source.checkgroupname(name, 1)
            const gid = state.groupdict.get(name)
            if (gid === undefined) throw source.error(`unknown group name ${strRepr(name)}`, cplen(name) + 1)
            if (!state.checkgroup(gid)) throw source.error('cannot refer to an open group', cplen(name) + 1)
            state.checklookbehindgroup(gid, source)
            const [lo, hi] = state.groupwidths[gid]!
            items.push({ op: 'GROUPREF', parts: ['(?:', { ref: gid }, ')'], lo, hi })
            continue
          } else {
            char = source.get()
            if (char === null) throw source.error('unexpected end of pattern')
            throw source.error(`unknown extension ?P${char}`, cplen(char) + 2)
          }
        } else if (char === ':') capture = false
        else if (char === '#') {
          for (;;) {
            if (source.next === null) throw source.error('missing ), unterminated comment', source.tell() - start)
            if (source.get() === ')') break
          }
          continue
        } else if (char === '=' || char === '!' || char === '<') {
          let dir = 1
          let outer: number | null = null
          let slot = -1
          if (char === '<') {
            char = source.get()
            if (char === null) throw source.error('unexpected end of pattern')
            if (char !== '=' && char !== '!') throw source.error(`unknown extension ?<${char}`, cplen(char) + 2)
            dir = -1
            outer = state.lookbehindgroups
            if (outer === null) state.lookbehindgroups = state.groups
            slot = state.lookbehinds.push(null) - 1
          }
          const p = parseSub(source, state, verbose, nested + 1, scoped)
          if (dir < 0) {
            if (outer === null) state.lookbehindgroups = null
            state.lookbehinds[slot] = [p.lo, p.hi]
          }
          if (!source.match(')')) throw source.error('missing ), unterminated subpattern', source.tell() - start)
          const head = dir < 0 ? (char === '=' ? '(?<=' : '(?<!') : char === '=' ? '(?=' : '(?!'
          items.push({ op: 'ASSERT', parts: [head, ...p.parts, ')'], lo: 0, hi: 0 })
          continue
        } else if (char === '(') throw unsupported('conditional groups ((?(...)...))')
        else if (char === '>') {
          capture = false
          atomic = true
        } else if (char.length === 1 && (FLAGS.includes(char) || char === '-')) {
          flags = parseFlags(source, state, char)
          if (flags === null) {
            if (!first || items.length > 0) throw source.error('global flags not at the start of the expression', source.tell() - start)
            verbose = state.flags.x ?? false
            continue
          }
          capture = false
        } else throw source.error(`unknown extension ?${char}`, cplen(char) + 1)
      }
      let group: number | null = null
      if (capture) {
        try {
          group = state.opengroup(name)
        } catch (error) {
          if (error instanceof PyError) throw source.error(error.message, cplen(name ?? '') + 1)
          throw error
        }
      }
      const subVerbose = (verbose || (flags?.add.x ?? false)) && !(flags?.del.x ?? false)
      let inner = scoped
      if (flags !== null) {
        inner = { ...scoped }
        for (const f of Object.keys(flags.add) as Flag[]) inner[f] = true
        for (const f of Object.keys(flags.del) as Flag[]) inner[f] = false
      }
      const p = parseSub(source, state, subVerbose, nested + 1, inner)
      if (!source.match(')')) throw source.error('missing ), unterminated subpattern', source.tell() - start)
      if (group !== null) {
        state.groupwidths[group] = [p.lo, p.hi]
        items.push({ op: 'SUBPATTERN', parts: [{ open: group }, ...p.parts, ')'], lo: p.lo, hi: p.hi })
      } else if (atomic) {
        const h = -++state.helpers
        items.push({ op: 'ATOMIC', parts: ['(?:(?=', { open: h }, ...p.parts, '))', { ref: h }, ')'], lo: p.lo, hi: p.hi })
      } else {
        const head = flags?.add.i ? '(?i:' : flags?.del.i ? '(?-i:' : '(?:'
        items.push({ op: 'SUBPATTERN', parts: [head, ...p.parts, ')'], lo: p.lo, hi: p.hi })
      }
    } else if (char === '^') items.push(at(on(state, scoped, 'm') ? '(?<![^\\n])' : START))
    else if (char === '$') items.push(at(on(state, scoped, 'm') ? '(?![^\\n])' : `(?=\\n?${END})`))
  }
  const parts: Part[] = []
  let lo = 0
  let hi = 0
  for (const item of items) {
    parts.push(...item.parts)
    lo += item.lo
    hi += item.hi
  }
  return { parts, lo, hi }
}

/** A character set, `[` already read. */
function charset(source: Tokenizer, state: State, scoped: Flags): Item {
  const here = source.tell() - 1
  const ascii = on(state, scoped, 'a')
  const set: string[] = []
  const negate = source.match('^')
  for (;;) {
    const char = source.get()
    if (char === null) throw source.error('unterminated character set', source.tell() - here)
    if (char === ']' && set.length > 0) break
    const code1 = char[0] === '\\' ? classEscape(source, char) : { cp: char.codePointAt(0)! }
    if (source.match('-')) {
      const that = source.get()
      if (that === null) throw source.error('unterminated character set', source.tell() - here)
      if (that === ']') {
        set.push('cat' in code1 ? category(code1.cat, ascii) : hex(code1.cp))
        set.push(hex(0x2d))
        break
      }
      const code2 = that[0] === '\\' ? classEscape(source, that) : { cp: that.codePointAt(0)! }
      const msg = `bad character range ${char}-${that}`
      if (!('cp' in code1) || !('cp' in code2)) throw source.error(msg, cplen(char) + 1 + cplen(that))
      if (code2.cp < code1.cp) throw source.error(msg, cplen(char) + 1 + cplen(that))
      set.push(`${hex(code1.cp)}-${hex(code2.cp)}`)
    } else set.push('cat' in code1 ? category(code1.cat, ascii) : hex(code1.cp))
  }
  return unit('IN', `[${negate ? '^' : ''}${set.join('')}]`)
}

/**
 * `re.compile(pattern, flags)` for a str pattern, as a RegExp; raises the
 * `re.error` (or OverflowError, ValueError) Python raises for a bad one.
 */
export function compile(pattern: string, options: { ignorecase?: boolean } = {}): RegExp {
  const source = new Tokenizer(pattern)
  const state = new State()
  const sub = parseSub(source, state, false, 0, {})
  if (state.flags.a && state.flags.u) throw new PyError('ValueError', 'ASCII and UNICODE flags are incompatible')
  if (source.next !== null) throw source.error('unbalanced parenthesis')
  for (const width of state.lookbehinds) {
    const [lo, hi] = width!
    if (lo > MAXCODE) throw new PyError('re.error', 'looks too much behind')
    if (lo !== hi) throw new PyError('re.error', 'look-behind requires fixed-width pattern')
  }
  const numbers = new Map<number, number>()
  for (const part of sub.parts) if (typeof part === 'object' && 'open' in part) numbers.set(part.open, numbers.size + 1)
  const text = sub.parts.map((part) => (typeof part === 'string' ? part : 'open' in part ? '(' : `\\${numbers.get(part.ref)}`)).join('')
  return new RegExp(text, options.ignorecase ? 'iv' : 'v')
}

/** `re.search(compiled, text) is not None`. */
export function search(regex: RegExp, text: string): boolean {
  regex.lastIndex = 0
  return regex.test(text)
}
