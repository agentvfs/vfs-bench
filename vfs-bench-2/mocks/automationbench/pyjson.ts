/**
 * `json.loads(text)`, failing as Python's decoder does: a `JSONDecodeError`
 * (a ValueError) whose text is the decoder's message and position
 * (`Expecting value: line 1 column 1 (char 0)`), positions counted in code
 * points as Python counts them. The scanner follows CPython's `json.decoder`
 * and `json.scanner` (as mocks/gaia2's does); the value is `loads`'s.
 */
import { PyError, loads, type Py } from './py.ts'

export class JSONDecodeError extends PyError {
  constructor(message: string) {
    super('json.decoder.JSONDecodeError', message)
  }
}

export function jsonLoads(input: string): Py {
  const text = [...input]
  const WS = ' \t\n\r'
  const fail = (msg: string, pos: number): never => {
    const before = text.slice(0, pos)
    const line = before.filter((c) => c === '\n').length + 1
    const col = pos - before.lastIndexOf('\n')
    throw new JSONDecodeError(`${msg}: line ${line} column ${col} (char ${pos})`)
  }
  const ws = (i: number) => {
    while (i < text.length && WS.includes(text[i]!)) i++
    return i
  }
  const startsWith = (word: string, i: number) => text.slice(i, i + word.length).join('') === word
  class Stop {
    readonly at: number
    constructor(at: number) {
      this.at = at
    }
  }
  const string = (end: number): number => {
    const begin = end - 1
    for (;;) {
      if (end >= text.length) fail('Unterminated string starting at', begin)
      const ch = text[end]!
      if (ch === '"') return end + 1
      if (ch === '\\') {
        const esc = text[end + 1]
        if (esc === undefined) fail('Unterminated string starting at', begin)
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(end + 2, end + 6).join(''))) fail('Invalid \\uXXXX escape', end + 1)
          end += 6
        } else if ('"\\/bfnrt'.includes(esc!)) end += 2
        else fail('Invalid \\escape', end)
      } else if (ch.codePointAt(0)! < 0x20) fail('Invalid control character at', end)
      else end += 1
    }
  }
  const scan = (idx: number): number => {
    const ch = text[idx]
    if (ch === undefined) throw new Stop(idx)
    if (ch === '"') return string(idx + 1)
    if (ch === '{') return object(idx + 1)
    if (ch === '[') return array(idx + 1)
    for (const word of ['null', 'true', 'false', 'NaN', 'Infinity', '-Infinity']) {
      if (startsWith(word, idx)) return idx + word.length
    }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(text.slice(idx, idx + 400).join(''))
    if (m !== null) return idx + [...m[0]].length
    throw new Stop(idx)
  }
  const value = (idx: number): number => {
    try {
      return scan(idx)
    } catch (stop) {
      if (stop instanceof Stop) return fail('Expecting value', stop.at)
      throw stop
    }
  }
  const object = (end: number): number => {
    let next = text[end] ?? ''
    if (next !== '"') {
      if (next !== '' && WS.includes(next)) {
        end = ws(end)
        next = text[end] ?? ''
      }
      if (next === '}') return end + 1
      if (next !== '"') fail('Expecting property name enclosed in double quotes', end)
    }
    end += 1
    for (;;) {
      end = string(end)
      if (text[end] !== ':') {
        end = ws(end)
        if (text[end] !== ':') fail("Expecting ':' delimiter", end)
      }
      end = value(ws(end + 1))
      end = ws(end)
      next = text[end] ?? ''
      end += 1
      if (next === '}') return end
      if (next !== ',') fail("Expecting ',' delimiter", end - 1)
      end = ws(end)
      next = text[end] ?? ''
      end += 1
      if (next !== '"') fail('Expecting property name enclosed in double quotes', end - 1)
    }
  }
  const array = (end: number): number => {
    end = ws(end)
    if (text[end] === ']') return end + 1
    for (;;) {
      end = ws(value(end))
      const next = text[end] ?? ''
      end += 1
      if (next === ']') return end
      if (next !== ',') fail("Expecting ',' delimiter", end - 1)
      end = ws(end)
    }
  }
  let end = value(ws(0))
  end = ws(end)
  if (end !== text.length) fail('Extra data', end)
  // NaN and Infinity, which JSON.parse refuses, read as null; strings are kept.
  return loads(input.replace(/"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g, (token) => (token.startsWith('"') ? token : 'null')))
}
