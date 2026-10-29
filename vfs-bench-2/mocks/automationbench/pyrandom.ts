/**
 * Python's `random.Random` (MT19937, as CPython's `_random` module runs
 * it), so a run draws the ids upstream's code would draw from the same
 * state.
 *
 * Upstream draws ids from the `random` module (`random.choices`,
 * `random.randint`) and from `uuid.uuid4()`. A run here has two generators,
 * as the exporter's world has (harbor/automationbench.py): `random`, the
 * module's, and `ids`, which stands in for `uuid4`'s `os.urandom`
 * (`uuid.UUID(int=ids.getrandbits(128), version=4)`). Both are seeded with
 * the task's name, the world is built, and the state each is left in is the
 * fixture's (`getstate()`), which a run picks up from.
 */
import { createHash } from 'node:crypto'

const N = 624
const M = 397

export class PyRandom {
  private mt = new Uint32Array(N)
  private index = N + 1

  constructor(seed?: string) {
    if (seed !== undefined) this.seed(seed)
  }

  /** `random.seed(text)` (version 2): the text's bytes and their SHA-512, as one big int. */
  seed(text: string): void {
    const bytes = Buffer.from(text, 'utf8')
    const all = Buffer.concat([bytes, createHash('sha512').update(bytes).digest()])
    // init_by_array over the int's 32-bit words, least significant first.
    let big = BigInt(`0x${all.toString('hex') || '0'}`)
    const key: number[] = []
    while (big > 0n) {
      key.push(Number(big & 0xffffffffn))
      big >>= 32n
    }
    if (key.length === 0) key.push(0)
    this.initByArray(key)
  }

  private initGenrand(s: number): void {
    const mt = this.mt
    mt[0] = s >>> 0
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30)
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0
    }
    this.index = N
  }

  private initByArray(key: number[]): void {
    const mt = this.mt
    this.initGenrand(19650218)
    let i = 1
    let j = 0
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30)
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1664525)) + key[j]! + j) >>> 0
      i++
      j++
      if (i >= N) {
        mt[0] = mt[N - 1]!
        i = 1
      }
      if (j >= key.length) j = 0
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30)
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1566083941)) - i) >>> 0
      i++
      if (i >= N) {
        mt[0] = mt[N - 1]!
        i = 1
      }
    }
    mt[0] = 0x80000000
    this.index = N
  }

  /** genrand_uint32. */
  uint32(): number {
    const mt = this.mt
    if (this.index >= N) {
      let kk = 0
      const mag = (y: number) => (y & 1 ? 0x9908b0df : 0)
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff)
        mt[kk] = (mt[kk + M]! ^ (y >>> 1) ^ mag(y)) >>> 0
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff)
        mt[kk] = (mt[kk + (M - N)]! ^ (y >>> 1) ^ mag(y)) >>> 0
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff)
      mt[N - 1] = (mt[M - 1]! ^ (y >>> 1) ^ mag(y)) >>> 0
      this.index = 0
    }
    let y = mt[this.index++]!
    y ^= y >>> 11
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0
    y ^= y >>> 18
    return y >>> 0
  }

  /** `random.random()`. */
  random(): number {
    const a = this.uint32() >>> 5
    const b = this.uint32() >>> 6
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0)
  }

  /** `random.getrandbits(k)`. */
  getrandbits(k: number): bigint {
    if (k <= 32) return BigInt(this.uint32() >>> (32 - k))
    let out = 0n
    let shift = 0n
    for (let left = k; left > 0; left -= 32) {
      let r = this.uint32()
      if (left < 32) r >>>= 32 - left
      out |= BigInt(r) << shift
      shift += 32n
    }
    return out
  }

  /** `_randbelow(n)`, with getrandbits. */
  randbelow(n: number): number {
    if (n <= 0) return 0
    const k = n.toString(2).length
    let r = Number(this.getrandbits(k))
    while (r >= n) r = Number(this.getrandbits(k))
    return r
  }

  /** `random.randint(a, b)`. */
  randint(a: number, b: number): number {
    return a + this.randbelow(b - a + 1)
  }

  /** `random.randrange(start, stop)`. */
  randrange(start: number, stop?: number): number {
    if (stop === undefined) return this.randbelow(start)
    return start + this.randbelow(stop - start)
  }

  /** `random.choice(seq)`. */
  choice<T>(seq: readonly T[]): T {
    return seq[this.randbelow(seq.length)]!
  }

  /** `random.choices(population, k=k)`, unweighted. */
  choices<T>(population: readonly T[] | string, k = 1): T[] {
    const items = (typeof population === 'string' ? [...population] : population) as readonly T[]
    const n = items.length
    const out: T[] = []
    for (let i = 0; i < k; i++) out.push(items[Math.floor(this.random() * n)]!)
    return out
  }

  /** `random.uniform(a, b)`. */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random()
  }

  /** `random.shuffle(x)`, in place. */
  shuffle<T>(x: T[]): void {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1)
      ;[x[i], x[j]] = [x[j]!, x[i]!]
    }
  }

  /** The state as Python's `getstate()[1]`: the 624 words, then the index. */
  getstate(): number[] {
    return [...this.mt, this.index]
  }

  setstate(state: readonly number[]): void {
    if (state.length !== N + 1) throw new Error(`a Mersenne Twister state has ${N + 1} numbers, not ${state.length}`)
    this.mt = Uint32Array.from(state.slice(0, N))
    this.index = state[N]!
  }
}

/** A version-4 UUID from a generator, as `uuid.UUID(int=g.getrandbits(128), version=4)`. */
export class PyUUID {
  readonly int: bigint
  constructor(value: bigint) {
    this.int = value
  }
  static v4(rng: PyRandom): PyUUID {
    let v = rng.getrandbits(128)
    v &= ~(0xc000n << 48n)
    v |= 0x8000n << 48n
    v &= ~(0xf000n << 64n)
    v |= 4n << 76n
    return new PyUUID(v)
  }
  /** `uuid.hex`. */
  get hex(): string {
    return this.int.toString(16).padStart(32, '0')
  }
  /** `str(uuid)`. */
  toString(): string {
    const h = this.hex
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
}

export const ASCII_LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
export const ASCII_UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const ASCII_LETTERS = ASCII_LOWERCASE + ASCII_UPPERCASE
export const DIGITS = '0123456789'
export const HEXDIGITS = '0123456789abcdefABCDEF'
