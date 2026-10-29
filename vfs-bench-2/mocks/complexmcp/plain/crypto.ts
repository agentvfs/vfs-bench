/**
 * CryptoServer (`servers/crypto/app.py`): digests, HMAC, PBKDF2, base64,
 * XOR and Caesar toys, entropy and random tokens, statement for statement,
 * over node:crypto (the same OpenSSL algorithms hashlib uses). Strings are
 * hashed as their UTF-8; bytes decode as Python's codecs do, errors and
 * all (`decodeUtf8`, `b64decode`, `unhexlify`).
 *
 * The random tools (`random_bytes`, `random_hex`, `uuid4`,
 * `secure_token_urlsafe`, `random_choice`) answer the same shape from
 * node:crypto's randomness. `derive_key` and `hmac_verify_hex` call another
 * tool's `__wrapped__`, which a FunctionTool lacks, so they always fail, as
 * upstream's do. `file_digest` reads upstream's sandbox, whose files the
 * fake does not have: every path is missing here.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomInt, randomUUID } from 'node:crypto'

import { PyError } from '../common.ts'
import { PyFloat, b64decode, big, decodeUtf8, encode, libm, unhexlify } from '../py.ts'
import { type ParamSpec, plainTools } from '../tool.ts'

const text: ParamSpec[] = [['text', 'str']]
const keyMessage: ParamSpec[] = [
  ['key', 'str'],
  ['message', 'str'],
]

const hex = (algo: string, data: Uint8Array) => createHash(algo).update(data).digest('hex')
const hmacHex = (key: string, message: string) => createHmac('sha256', encode(key)).update(encode(message)).digest('hex')

/** `secrets.token_hex(n)` / `os.urandom(n)`: n random bytes, n not negative. */
function urandom(n: number): Buffer {
  if (n < 0) throw new PyError('negative argument not allowed')
  return randomBytes(n)
}

/** `bytes(tb[i] ^ kb[i % len(kb)] for i in range(len(tb)))`. */
function xor(tb: Uint8Array, kb: Uint8Array): Buffer {
  const out = Buffer.alloc(tb.length)
  for (let i = 0; i < tb.length; i++) {
    if (kb.length === 0) throw new PyError('division by zero')
    out[i] = tb[i]! ^ kb[i % kb.length]!
  }
  return out
}

/** `hashlib.pbkdf2_hmac("sha256", password, salt, iterations, dklen)`. */
function pbkdf2(password: string, salt: string, iterations: number, dklen: number): string {
  if (iterations < 1) throw new PyError('iteration value must be greater than 0.')
  if (iterations > 2147483647) throw new PyError('iteration value is too great.')
  if (dklen < 1) throw new PyError('key length must be greater than 0.')
  if (dklen > 2147483647) throw new PyError('key length is too great.')
  return pbkdf2Sync(encode(password), encode(salt), iterations, dklen, 'sha256').toString('hex')
}

const wrapped = () => {
  throw new PyError("'FunctionTool' object has no attribute '__wrapped__'")
}

/** `base64.urlsafe_b64decode(s)`: `-` and `_` read as `+` and `/`, then `b64decode`. */
const urlsafeDecode = (b: Buffer) => b64decode(Buffer.from(b.map((c) => (c === 0x2d ? 0x2b : c === 0x5f ? 0x2f : c))))

export const tools = plainTools({
  sha256: [text, 'string', ({ text }) => hex('sha256', encode(text))],
  sha1: [text, 'string', ({ text }) => hex('sha1', encode(text))],
  md5: [text, 'string', ({ text }) => hex('md5', encode(text))],
  hmac_sha256: [keyMessage, 'string', ({ key, message }) => hmacHex(key, message)],
  pbkdf2_hex: [
    [
      ['password', 'str'],
      ['salt', 'str'],
      ['iterations', 'int', 100000],
      ['dklen', 'int', 32],
    ],
    'string',
    ({ password, salt, iterations, dklen }) => pbkdf2(password, salt, iterations, dklen),
  ],
  random_bytes: [[['n', 'int', 32]], 'string', ({ n }) => urandom(n).toString('hex')],
  random_hex: [[['nbytes', 'int', 16]], 'string', ({ nbytes }) => urandom(nbytes).toString('hex')],
  base64_encode: [text, 'string', ({ text }) => encode(text).toString('base64')],
  base64_decode: [[['b64', 'str']], 'string', ({ b64 }) => decodeUtf8(b64decode(encode(b64)))],
  xor_cipher: [
    [
      ['text', 'str'],
      ['key', 'str'],
    ],
    'string',
    ({ text, key }) => xor(encode(text), encode(key)).toString('hex'),
  ],
  xor_dec: [
    [
      ['hextext', 'str'],
      ['key', 'str'],
    ],
    'string',
    ({ hextext, key }) => decodeUtf8(xor(unhexlify(hextext), encode(key))),
  ],
  simple_caesar: [
    [
      ['text', 'str'],
      ['shift', 'int', 3],
    ],
    'string',
    ({ text, shift }) => {
      const s = big(shift)
      const rot = (c: number, base: number) => String.fromCharCode(Number((((BigInt(c - base) + s) % 26n) + 26n) % 26n) + base)
      return Array.from(text as string, (ch) => {
        if (ch >= 'a' && ch <= 'z') return rot(ch.charCodeAt(0), 97)
        if (ch >= 'A' && ch <= 'Z') return rot(ch.charCodeAt(0), 65)
        return ch
      }).join('')
    },
  ],
  rot13: [
    text,
    'string',
    ({ text }) => (text as string).replace(/[A-Za-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - (c < 'a' ? 65 : 97) + 13) % 26) + (c < 'a' ? 65 : 97))),
  ],
  timing_safe_compare: [
    [
      ['a', 'str'],
      ['b', 'str'],
    ],
    'boolean',
    ({ a, b }) => {
      if (/[^\x00-\x7f]/.test(a) || /[^\x00-\x7f]/.test(b)) throw new PyError('comparing strings with non-ASCII characters is not supported')
      return a === b
    },
  ],
  derive_key: [
    [
      ['password', 'str'],
      ['salt', 'str'],
      ['iterations', 'int', 100000],
    ],
    'string',
    wrapped,
  ],
  entropy_estimate_hex: [
    [['hexstr', 'str']],
    'number',
    ({ hexstr }) => {
      const data = unhexlify(hexstr)
      const counts = new Map<number, number>()
      for (const b of data) counts.set(b, (counts.get(b) ?? 0) + 1)
      let ent = 0.0
      const l = data.length || 1
      for (const c of counts.values()) {
        const p = c / l
        ent -= p * libm.log2(p)
      }
      return new PyFloat(ent)
    },
  ],
  uuid4: [[], 'string', () => randomUUID()],
  hex_to_bytes: [[['hexstr', 'str']], 'bytes', ({ hexstr }) => unhexlify(hexstr)],
  bytes_to_hex: [[['b', 'bytes']], 'string', ({ b }) => (b as Buffer).toString('hex')],
  urlsafe_b64_encode: [text, 'string', ({ text }) => encode(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')],
  urlsafe_b64_decode: [text, 'string', ({ text }) => decodeUtf8(urlsafeDecode(encode(text)))],
  hmac_sign_hex: [keyMessage, 'string', ({ key, message }) => hmacHex(key, message)],
  hmac_verify_hex: [[...keyMessage, ['signature', 'str']], 'boolean', wrapped],
  checksum_sha256_hex: [text, 'string', ({ text }) => hex('sha256', encode(text))],
  random_choice: [
    [['seq', 'list']],
    'any',
    ({ seq }) => {
      if (seq.length === 0) throw new PyError('Cannot choose from an empty sequence')
      return seq[randomInt(seq.length)]
    },
  ],
  secure_token_urlsafe: [[['length', 'int', 32]], 'string', ({ length }) => urandom(length).toString('base64url')],
  file_digest: [
    [
      ['path', 'str'],
      ['algo', 'str', 'sha256'],
    ],
    'string',
    ({ path }) => {
      throw new PyError(path)
    },
  ],
  xor_bytes_hex: [
    [
      ['a_hex', 'str'],
      ['b_hex', 'str'],
    ],
    'string',
    ({ a_hex, b_hex }) => {
      const a = unhexlify(a_hex)
      const b = unhexlify(b_hex)
      const n = Math.min(a.length, b.length)
      return Buffer.from(Array.from({ length: n }, (_, i) => a[i]! ^ b[i]!)).toString('hex')
    },
  ],
})
