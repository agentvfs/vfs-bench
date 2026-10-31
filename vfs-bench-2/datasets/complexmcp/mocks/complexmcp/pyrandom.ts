/**
 * CPython's `random.Random`, draw for draw: the Mersenne Twister of
 * `_randommodule.c` and the methods of `Lib/random.py` (3.14) that
 * ComplexMCP's apps call. Seeded with the same int, it gives the same
 * numbers, so an app's world and every later draw are upstream's.
 *
 * Its state is CPython's `getstate()`, `[624 words + index, gauss_next]`,
 * which a run keeps between requests.
 */
const N = 624
const M = 397

const TWOPI = 2.0 * Math.PI

export type RandomState = [number[], number | null]

export class PyRandom {
  private mt = new Uint32Array(N)
  private index = N + 1
  private gaussNext: number | null = null

  constructor(seed?: number) {
    if (seed !== undefined) this.seed(seed)
  }

  /** `random.seed(int)`: init_by_array over the int's 32-bit words, low first. */
  seed(a: number): void {
    let n = BigInt(Math.abs(a))
    const key: number[] = []
    do {
      key.push(Number(n & 0xffffffffn))
      n >>= 32n
    } while (n > 0n)
    this.initByArray(key)
    this.gaussNext = null
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
  }

  private genrand(): number {
    const mt = this.mt
    if (this.index >= N) {
      let kk = 0
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff)
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff)
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff)
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
      this.index = 0
    }
    let y = mt[this.index++]!
    y ^= y >>> 11
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0
    y ^= y >>> 18
    return y >>> 0
  }

  /** `random()`: 53 bits from two words. */
  random(): number {
    const a = this.genrand() >>> 5
    const b = this.genrand() >>> 6
    return (a * 67108864 + b) * (1 / 9007199254740992)
  }

  /** `getrandbits(k)`, as a number (k <= 53 here). */
  getrandbits(k: number): number {
    if (k <= 32) return this.genrand() >>> (32 - k)
    let out = 0n
    let shift = 0n
    for (let left = k; left > 0; left -= 32) {
      let r = this.genrand()
      if (left < 32) r >>>= 32 - left
      out |= BigInt(r) << shift
      shift += 32n
    }
    return Number(out)
  }

  /** `_randbelow_with_getrandbits(n)`. */
  randbelow(n: number): number {
    if (n <= 0) return 0
    const k = bitLength(n)
    let r = this.getrandbits(k)
    while (r >= n) r = this.getrandbits(k)
    return r
  }

  /** `randrange(start, stop)`, or `randrange(stop)`, with step 1. */
  randrange(start: number, stop?: number): number {
    if (stop === undefined) {
      if (start > 0) return this.randbelow(start)
      throw new Error('empty range for randrange()')
    }
    const width = stop - start
    if (width > 0) return start + this.randbelow(width)
    throw new Error(`empty range in randrange(${start}, ${stop})`)
  }

  randint(a: number, b: number): number {
    return this.randrange(a, b + 1)
  }

  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) throw new Error('Cannot choose from an empty sequence')
    return seq[this.randbelow(seq.length)]!
  }

  /** `choices(population, weights=None, *, k=1)`. */
  choices<T>(population: readonly T[], k = 1, weights?: readonly number[]): T[] {
    const n = population.length
    if (weights === undefined) {
      const out: T[] = []
      for (let i = 0; i < k; i++) out.push(population[Math.floor(this.random() * n)]!)
      return out
    }
    const cum: number[] = []
    let acc = 0
    for (const w of weights) cum.push((acc += w))
    const total = cum[cum.length - 1]!
    const out: T[] = []
    for (let i = 0; i < k; i++) out.push(population[bisectRight(cum, this.random() * total, 0, n - 1)]!)
    return out
  }

  /** `sample(population, k)`: the pool or the set selection, as CPython picks. */
  sample<T>(population: readonly T[], k: number): T[] {
    const n = population.length
    if (!(k >= 0 && k <= n)) throw new Error('Sample larger than population or is negative')
    const result: T[] = new Array<T>(k)
    let setsize = 21
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4))
    if (n <= setsize) {
      const pool = [...population]
      for (let i = 0; i < k; i++) {
        const j = this.randbelow(n - i)
        result[i] = pool[j]!
        pool[j] = pool[n - i - 1]!
      }
    } else {
      const selected = new Set<number>()
      for (let i = 0; i < k; i++) {
        let j = this.randbelow(n)
        while (selected.has(j)) j = this.randbelow(n)
        selected.add(j)
        result[i] = population[j]!
      }
    }
    return result
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random()
  }

  /** `gauss(mu, sigma)`, which keeps its second normal for the next call. */
  gauss(mu: number, sigma: number): number {
    let z = this.gaussNext
    this.gaussNext = null
    if (z === null) {
      const x2pi = this.random() * TWOPI
      const g2rad = Math.sqrt(-2.0 * Math.log(1.0 - this.random()))
      z = Math.cos(x2pi) * g2rad
      this.gaussNext = Math.sin(x2pi) * g2rad
    }
    return mu + z * sigma
  }

  getstate(): RandomState {
    return [[...this.mt, this.index], this.gaussNext]
  }

  setstate([words, gauss]: RandomState): void {
    this.mt = Uint32Array.from(words.slice(0, N))
    this.index = words[N]!
    this.gaussNext = gauss
  }

  static from(state: RandomState): PyRandom {
    const rng = new PyRandom()
    rng.setstate(state)
    return rng
  }
}

/** `int.bit_length()`. */
function bitLength(n: number): number {
  return n === 0 ? 0 : n.toString(2).length
}

/** `bisect.bisect_right(a, x, lo, hi)`. */
function bisectRight(a: readonly number[], x: number, lo: number, hi: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x < a[mid]!) hi = mid
    else lo = mid + 1
  }
  return lo
}
