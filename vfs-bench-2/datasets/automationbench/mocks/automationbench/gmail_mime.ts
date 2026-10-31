/**
 * What upstream's Gmail handlers take from Python's standard library to read
 * a request's message: `base64` (`binascii.a2b_base64`, strict and lenient),
 * `quopri.decodestring` (`binascii.a2b_qp`), and `email.message_from_bytes`
 * under its default policy (compat32: `email.feedparser`, `Message.get`,
 * `get_payload(decode=True)`, `walk`, `get_content_type`).
 *
 * Bytes are carried as binary strings, one char per byte (latin1). A
 * header whose value holds a non-ASCII byte is, under compat32, an
 * `email.header.Header` object rather than a `str`: `HeaderValue` here,
 * whose Python type name upstream's code may trip over.
 */
import type { PyObject } from './py.ts'

/** A binascii.Error. */
export class BinasciiError extends Error {}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]))

/** `binascii.a2b_base64(data, strict_mode=strict)` on a binary string. */
export function a2bBase64(data: string, strict: boolean): string {
  if (strict && data.length > 0 && data[0] === '=') throw new BinasciiError('Leading padding not allowed')
  let out = ''
  let quadPos = 0
  let leftchar = 0
  let pads = 0
  let paddingStarted = false
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]!
    if (ch === '=') {
      paddingStarted = true
      if (strict && quadPos === 0) throw new BinasciiError('Excess padding not allowed')
      if (quadPos >= 2 && quadPos + ++pads >= 4) {
        if (strict && i + 1 < data.length) throw new BinasciiError('Excess data after padding')
        return out
      }
      continue
    }
    const v = B64_INDEX[ch]
    if (v === undefined) {
      if (strict) throw new BinasciiError('Only base64 data is allowed')
      continue
    }
    if (strict && paddingStarted) throw new BinasciiError('Discontinuous padding not allowed')
    pads = 0
    switch (quadPos) {
      case 0:
        quadPos = 1
        leftchar = v
        break
      case 1:
        quadPos = 2
        out += String.fromCharCode(((leftchar << 2) | (v >> 4)) & 0xff)
        leftchar = v & 0x0f
        break
      case 2:
        quadPos = 3
        out += String.fromCharCode(((leftchar << 4) | (v >> 2)) & 0xff)
        leftchar = v & 0x03
        break
      default:
        quadPos = 0
        out += String.fromCharCode(((leftchar << 6) | v) & 0xff)
        leftchar = 0
    }
  }
  if (quadPos !== 0) {
    if (quadPos === 1) {
      const n = [...data].filter((c) => B64_INDEX[c] !== undefined).length
      throw new BinasciiError(`Invalid base64-encoded string: number of data characters (${n}) cannot be 1 more than a multiple of 4`)
    }
    throw new BinasciiError('Incorrect padding')
  }
  return out
}

/** `str.encode("ascii")` of a text `base64` decodes: a ValueError where it is not ASCII. */
export function asciiOnly(text: string): boolean {
  return /^[\x00-\x7f]*$/.test(text)
}

/** `base64.urlsafe_b64decode(text)`; throws as Python does (ValueError, binascii.Error). */
export function urlsafeB64decode(text: string): string {
  if (!asciiOnly(text)) throw new BinasciiError('string argument should contain only ASCII characters')
  return a2bBase64(text.replace(/-/g, '+').replace(/_/g, '/'), false)
}

/** `base64.b64decode(text, validate=validate)`. */
export function b64decode(text: string, validate: boolean): string {
  if (!asciiOnly(text)) throw new BinasciiError('string argument should contain only ASCII characters')
  return a2bBase64(text, validate)
}

/** `bytes.decode("utf-8", errors="replace")` of a binary string. */
export function utf8Replace(bytes: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(bytes, 'latin1'))
}

const HEX = /^[0-9A-Fa-f]$/

/** `quopri.decodestring(data)`: `binascii.a2b_qp(data, header=False)`. */
export function a2bQp(data: string): string {
  let out = ''
  let i = 0
  const n = data.length
  while (i < n) {
    if (data[i] === '=') {
      i++
      if (i >= n) break
      if (data[i] === '\n' || data[i] === '\r') {
        if (data[i] !== '\n') while (i < n && data[i] !== '\n') i++
        if (i < n) i++
      } else if (data[i] === '=') {
        out += '='
        i++
      } else if (i + 1 < n && HEX.test(data[i]!) && HEX.test(data[i + 1]!)) {
        out += String.fromCharCode(parseInt(data.slice(i, i + 2), 16))
        i += 2
      } else out += '='
    } else {
      out += data[i]
      i++
    }
  }
  return out
}

/** `email._encoded_words.decode_b(encoded)`'s value. */
function decodeB(encoded: string): string {
  const padErr = encoded.length % 4
  const missing = padErr ? '==='.slice(0, 4 - padErr) : ''
  try {
    return a2bBase64(encoded + missing, true)
  } catch {
    try {
      return a2bBase64(encoded, false)
    } catch {
      try {
        return a2bBase64(`${encoded}==`, false)
      } catch {
        return encoded
      }
    }
  }
}

/** A compat32 header value with non-ASCII bytes: an `email.header.Header`. */
export class HeaderValue implements PyObject {
  readonly pyType = 'Header'
  readonly raw: string
  constructor(raw: string) {
    this.raw = raw
  }
  pyStr(): string {
    return this.raw
  }
  pyRepr(): string {
    return '<email.header.Header object>'
  }
}

/** One parsed message (`email.message.Message`). */
export class EmailMessage {
  readonly headers: [string, string][] = []
  payload: string | EmailMessage[] | null = null
  defaultType = 'text/plain'

  /** `msg.get(name)`: the first such header, a `HeaderValue` where it holds non-ASCII bytes. */
  get(name: string): string | HeaderValue | null {
    const lower = name.toLowerCase()
    for (const [k, v] of this.headers) {
      if (k.toLowerCase() === lower) return /[^\x00-\x7f]/.test(v) ? new HeaderValue(v) : v
    }
    return null
  }

  private raw(name: string): string | null {
    const lower = name.toLowerCase()
    for (const [k, v] of this.headers) if (k.toLowerCase() === lower) return v
    return null
  }

  isMultipart(): boolean {
    return Array.isArray(this.payload)
  }

  getContentType(): string {
    const value = this.raw('content-type')
    if (value === null) return this.defaultType
    const ctype = value.split(';', 1)[0]!.trim().toLowerCase()
    return ctype.split('/').length - 1 !== 1 ? 'text/plain' : ctype
  }

  getContentMaintype(): string {
    return this.getContentType().split('/')[0]!
  }

  /** `get_boundary()`. */
  getBoundary(): string | null {
    const value = this.raw('content-type')
    if (value === null) return null
    for (const p of parseParams(value).slice(1)) {
      const eq = p.indexOf('=')
      const name = (eq < 0 ? p : p.slice(0, eq)).trim()
      const val = eq < 0 ? '' : p.slice(eq + 1).trim()
      if (name.toLowerCase() === 'boundary') return unquote(val).replace(/\s+$/, '')
    }
    return null
  }

  /** `walk()`: this message, then each part's, depth first. */
  *walk(): Generator<EmailMessage> {
    yield this
    if (Array.isArray(this.payload)) for (const part of this.payload) yield* part.walk()
  }

  /** `get_payload(decode=True)`: the body's bytes, or null for a multipart. */
  decodedPayload(): string | null {
    if (this.isMultipart() || this.payload === null) return null
    const payload = this.payload as string
    const cte = (this.raw('content-transfer-encoding') ?? '').trim().toLowerCase()
    if (cte === 'quoted-printable') return a2bQp(payload)
    if (cte === 'base64') return decodeB(payload.split(/\r\n|\r|\n/).join(''))
    return payload
  }
}

/** `email.message._parseparam`. */
function parseParams(value: string): string[] {
  let s = `;${value}`
  const out: string[] = []
  const quotes = (t: string, end: number) => (t.slice(0, end).split('"').length - 1) - (t.slice(0, end).split('\\"').length - 1)
  while (s.startsWith(';')) {
    s = s.slice(1)
    let end = s.indexOf(';')
    while (end > 0 && quotes(s, end) % 2) end = s.indexOf(';', end + 1)
    if (end < 0) end = s.length
    let f = s.slice(0, end)
    const i = f.indexOf('=')
    if (i >= 0) f = `${f.slice(0, i).trim().toLowerCase()}=${f.slice(i + 1).trim()}`
    out.push(f.trim())
    s = s.slice(end)
  }
  return out
}

/** `email.utils.unquote`. */
function unquote(value: string): string {
  if (value.length > 1) {
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"')
    if (value.startsWith('<') && value.endsWith('>')) return value.slice(1, -1)
  }
  return value
}

const HEADER_RE = /^(From |[\x21-\x39\x3b-\x7e]*:|[\t ])/
const NL_START = /^(\r\n|\r|\n)/
const NL_END = /(\r\n|\r|\n)$/
const BOUNDARY_END = /^(--)?([ \t]*)(\r\n|\r|\n)?$/

/** `email.feedparser.BufferedSubFile`, over all the input at once. */
class Input {
  private readonly lines: string[]
  private readonly eof: ((line: string) => boolean)[] = []
  constructor(text: string) {
    this.lines = text.match(/[^\r\n]*(\r\n|\r|\n)|[^\r\n]+$/g) ?? []
  }
  readline(): string {
    const line = this.lines.shift()
    if (line === undefined) return ''
    for (let i = this.eof.length - 1; i >= 0; i--) {
      if (this.eof[i]!(line)) {
        this.lines.unshift(line)
        return ''
      }
    }
    return line
  }
  unreadline(line: string): void {
    this.lines.unshift(line)
  }
  push(matcher: (line: string) => boolean): void {
    this.eof.push(matcher)
  }
  pop(): void {
    this.eof.pop()
  }
  *[Symbol.iterator](): Generator<string> {
    for (;;) {
      const line = this.readline()
      if (line === '') return
      yield line
    }
  }
}

/** `email.message_from_bytes(data)` (compat32), on a binary string. */
export function messageFromBytes(data: string): EmailMessage {
  const input = new Input(data)
  const stack: EmailMessage[] = []
  let cur: EmailMessage
  let last: EmailMessage
  let root: EmailMessage | undefined

  const newMessage = () => {
    const msg = new EmailMessage()
    if (stack.length > 0 && stack[stack.length - 1]!.getContentType() === 'multipart/digest') msg.defaultType = 'message/rfc822'
    if (stack.length > 0) {
      const parent = stack[stack.length - 1]!
      if (!Array.isArray(parent.payload)) parent.payload = []
      parent.payload.push(msg)
    }
    stack.push(msg)
    cur = msg
    last = msg
    root ??= msg
  }
  const popMessage = () => {
    const popped = stack.pop()!
    cur = stack[stack.length - 1]!
    last = popped
  }

  const parseHeaders = (lines: string[]) => {
    let lastheader = ''
    let lastvalue: string[] = []
    const flush = () => {
      const first = lastvalue[0]!
      const i = first.indexOf(':')
      const name = first.slice(0, i)
      const value = [first.slice(i + 1), ...lastvalue.slice(1)].join('').replace(/^[ \t\r\n]+/, '')
      cur.headers.push([name, value.replace(/[\r\n]+$/, '')])
    }
    for (let lineno = 0; lineno < lines.length; lineno++) {
      const line = lines[lineno]!
      if (line[0] === ' ' || line[0] === '\t') {
        if (!lastheader) continue
        lastvalue.push(line)
        continue
      }
      if (lastheader) {
        flush()
        lastheader = ''
        lastvalue = []
      }
      if (line.startsWith('From ')) {
        if (lineno === 0) continue
        if (lineno === lines.length - 1) {
          input.unreadline(line)
          return
        }
        continue
      }
      const i = line.indexOf(':')
      if (i === 0) continue
      lastheader = line.slice(0, i)
      lastvalue = [line]
    }
    if (lastheader) flush()
  }

  const parsegen = (): void => {
    newMessage()
    const headers: string[] = []
    for (const line of input) {
      if (!HEADER_RE.test(line)) {
        if (!NL_START.test(line)) input.unreadline(line)
        break
      }
      headers.push(line)
    }
    parseHeaders(headers)
    if (cur.getContentType() === 'message/delivery-status') {
      for (;;) {
        input.push((line) => NL_START.test(line))
        parsegen()
        popMessage()
        input.pop()
        input.readline()
        const line = input.readline()
        if (line === '') break
        input.unreadline(line)
      }
      return
    }
    if (cur.getContentMaintype() === 'message') {
      parsegen()
      popMessage()
      return
    }
    if (cur.getContentMaintype() === 'multipart') {
      const boundary = cur.getBoundary()
      if (boundary === null) {
        cur.payload = [...input].join('')
        return
      }
      const separator = `--${boundary}`
      const boundarymatch = (line: string) => line.startsWith(separator) && BOUNDARY_END.exec(line.slice(separator.length))
      let capturingPreamble = true
      const preamble: string[] = []
      let closeSeen = false
      for (;;) {
        let line = input.readline()
        if (line === '') break
        const mo = boundarymatch(line)
        if (mo) {
          if (mo[1]) {
            closeSeen = true
            break
          }
          if (capturingPreamble) {
            capturingPreamble = false
            input.unreadline(line)
            continue
          }
          for (;;) {
            line = input.readline()
            if (!boundarymatch(line)) {
              input.unreadline(line)
              break
            }
          }
          input.push((l) => Boolean(boundarymatch(l)))
          parsegen()
          if (last.getContentMaintype() !== 'multipart' && typeof last.payload === 'string') {
            last.payload = last.payload.replace(NL_END, '')
          }
          input.pop()
          popMessage()
          last = cur
        } else preamble.push(line)
      }
      if (capturingPreamble) {
        cur.payload = preamble.join('')
        for (const _ of input) void _
        return
      }
      if (!closeSeen) return
      for (const _ of input) void _
      return
    }
    cur.payload = [...input].join('')
  }

  parsegen()
  return root!
}
