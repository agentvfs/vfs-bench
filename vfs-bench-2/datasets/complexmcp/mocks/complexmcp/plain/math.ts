/**
 * MathServer (`servers/math/app.py`): arithmetic, `math`'s functions and a
 * few statistics, statement for statement. Its floats are C doubles as
 * CPython computes them (`fpow`, `fmod`, `roundFloat`, compensated `sum`,
 * `hypot`'s own algorithm); its ints are Python's, so factorial and
 * Fibonacci grow past 2**53 as bigints. JS's Math.* is fdlibm's, which can
 * differ from libm's in the last place, so `libm` stands in for them.
 * `standard_deviation` calls `variance`, which the decorator has made a
 * FunctionTool, so it always fails, as it does upstream.
 */
import { PyError } from '../common.ts'
import { PyFloat, PySet, big, ffloordiv, fmod, fpow, fsum, hypot, libm, pyEq, reprFloat, roundFloat, small } from '../../../../../workspace/py.ts'
import type { PyInt } from '../../../../../workspace/py.ts'
import { type PlainTool, plainTools } from '../tool.ts'

const F = (x: number) => new PyFloat(x)
const v = (x: PyFloat) => x.v

const two: PlainTool[0] = [
  ['a', 'float'],
  ['b', 'float'],
]
const one: PlainTool[0] = [['a', 'float']]
const ints: PlainTool[0] = [
  ['a', 'int'],
  ['b', 'int'],
]
const numbers: PlainTool[0] = [['numbers', 'list[float]']]

/**
 * `math_1(x, func, can_overflow, err_msg)`: a libm function of one float,
 * a ValueError where it leaves the domain (with the function's message),
 * an OverflowError where it overflows.
 */
function math1(x: number, f: (x: number) => number, canOverflow: boolean, domain = 'math domain error'): PyFloat {
  const r = f(x)
  if (Number.isNaN(r) && !Number.isNaN(x)) throw new PyError(domain.replace('%s', reprFloat(x)))
  if (!Number.isFinite(r) && !Number.isNaN(r) && Number.isFinite(x)) throw new PyError(canOverflow ? 'math range error' : 'math domain error')
  return F(r)
}

const FINITE = 'expected a finite input, got %s'

/** `math.log(x)` of a float, as `loghelper` takes it. */
function mlog(x: number): number {
  if (Number.isFinite(x) && x > 0) return libm.log(x)
  if (Number.isNaN(x) || x === Infinity) return x
  throw new PyError(`expected a positive input, got ${reprFloat(x)}`)
}

/** `math.factorial(n)`, by a product tree, as fast as CPython's for big n. */
function factorial(n: bigint): bigint {
  const product = (lo: bigint, hi: bigint): bigint => {
    if (hi - lo < 16n) {
      let p = 1n
      for (let i = lo; i <= hi; i++) p *= i
      return p
    }
    const mid = (lo + hi) / 2n
    return product(lo, mid) * product(mid + 1n, hi)
  }
  return n < 2n ? 1n : product(2n, n)
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b) [a, b] = [b, a % b]
  return a
}

/** Python's `max(a, b)` and `min(a, b)`: the first wins a tie, NaN as `>` and `<` see it. */
const max = (a: PyFloat, b: PyFloat) => (b.v > a.v ? b : a)
const min = (a: PyFloat, b: PyFloat) => (b.v < a.v ? b : a)

function mean(xs: PyFloat[]): PyFloat {
  return F(Number(fsum(xs.map(v)).valueOf()) / xs.length)
}

function variance(numbers: PyFloat[]): PyFloat {
  if (numbers.length === 0) throw new PyError('Variance of empty list')
  const meanVal = mean(numbers).v
  const squares = numbers.map((x) => (fpow(x.v - meanVal, 2) as PyFloat).v)
  return F(Number(fsum(squares).valueOf()) / numbers.length)
}

function isPrime(a: PyInt): boolean {
  if (a <= 1) return false
  if (typeof a === 'number' && a <= 2 ** 53) {
    const limit = Math.trunc(Math.sqrt(a))
    for (let i = 2; i <= limit; i++) if (a % i === 0) return false
    return true
  }
  const n = big(a)
  const limit = BigInt(Math.trunc(Math.sqrt(Number(n))))
  for (let i = 2n; i <= limit; i++) if (n % i === 0n) return false
  return true
}

export const tools = plainTools({
  add: [two, 'number', ({ a, b }) => F(v(a) + v(b))],
  sub: [two, 'number', ({ a, b }) => F(v(a) - v(b))],
  mul: [two, 'number', ({ a, b }) => F(v(a) * v(b))],
  div: [
    two,
    'number',
    ({ a, b }) => {
      if (v(b) === 0) throw new PyError('Division by zero')
      return F(v(a) / v(b))
    },
  ],
  pow: [two, 'number', ({ a, b }) => fpow(v(a), v(b))],
  sqrt: [
    one,
    'number',
    ({ a }) => {
      if (v(a) < 0) throw new PyError('Square root of negative number')
      return fpow(v(a), 0.5)
    },
  ],
  abs_val: [one, 'number', ({ a }) => F(Math.abs(v(a)))],
  mod: [
    two,
    'number',
    ({ a, b }) => {
      if (v(b) === 0) throw new PyError('Modulo by zero')
      return fmod(v(a), v(b))
    },
  ],
  floor_div: [
    two,
    'number',
    ({ a, b }) => {
      if (v(b) === 0) throw new PyError('Division by zero')
      return ffloordiv(v(a), v(b))
    },
  ],
  max_val: [two, 'number', ({ a, b }) => max(a, b)],
  min_val: [two, 'number', ({ a, b }) => min(a, b)],
  round_val: [[['a', 'float'], ['ndigits', 'int', 0]], 'number', ({ a, ndigits }) => roundFloat(v(a), ndigits)],
  log: [
    [
      ['a', 'float'],
      ['base', 'float', 10],
    ],
    'number',
    ({ a, base }) => {
      if (v(a) <= 0) throw new PyError('Logarithm of non-positive number')
      const numer = mlog(v(a))
      const denom = mlog(Number(base))
      if (denom === 0) throw new PyError('division by zero')
      return F(numer / denom)
    },
  ],
  exp: [one, 'number', ({ a }) => math1(v(a), libm.exp, true)],
  sin: [one, 'number', ({ a }) => math1(v(a), libm.sin, false, FINITE)],
  cos: [one, 'number', ({ a }) => math1(v(a), libm.cos, false, FINITE)],
  tan: [one, 'number', ({ a }) => math1(v(a), libm.tan, false, FINITE)],
  asin: [
    one,
    'number',
    ({ a }) => {
      if (v(a) < -1 || v(a) > 1) throw new PyError('Input out of domain for arcsine')
      return math1(v(a), libm.asin, false)
    },
  ],
  acos: [
    one,
    'number',
    ({ a }) => {
      if (v(a) < -1 || v(a) > 1) throw new PyError('Input out of domain for arccosine')
      return math1(v(a), libm.acos, false)
    },
  ],
  atan: [one, 'number', ({ a }) => math1(v(a), libm.atan, false)],
  sinh: [one, 'number', ({ a }) => math1(v(a), libm.sinh, true)],
  cosh: [one, 'number', ({ a }) => math1(v(a), libm.cosh, true)],
  tanh: [one, 'number', ({ a }) => math1(v(a), libm.tanh, false)],
  factorial: [
    [['a', 'int']],
    'integer',
    ({ a }) => {
      if (a < 0) throw new PyError('Factorial of negative number')
      const n = big(a)
      if (n > 9223372036854775807n) throw new PyError('factorial() argument should not exceed 9223372036854775807')
      return small(factorial(n))
    },
  ],
  gcd: [ints, 'integer', ({ a, b }) => small(gcd(big(a), big(b)))],
  lcm: [
    ints,
    'integer',
    ({ a, b }) => {
      if (Number(a) === 0 || Number(b) === 0) return 0
      const p = big(a) * big(b)
      return small((p < 0n ? -p : p) / gcd(big(a), big(b)))
    },
  ],
  deg_to_rad: [one, 'number', ({ a }) => F(v(a) * (Math.PI / 180.0))],
  rad_to_deg: [one, 'number', ({ a }) => F(v(a) * (180.0 / Math.PI))],
  is_even: [[['a', 'int']], 'boolean', ({ a }) => big(a) % 2n === 0n],
  is_odd: [[['a', 'int']], 'boolean', ({ a }) => big(a) % 2n !== 0n],
  is_prime: [[['a', 'int']], 'boolean', ({ a }) => isPrime(a)],
  nth_fibonacci: [
    [['n', 'int']],
    'integer',
    ({ n }) => {
      if (n <= 0) throw new PyError('Fibonacci number index must be positive')
      let [a, b] = [0n, 1n]
      for (let i = 1; i < n; i++) [a, b] = [b, a + b]
      return small(b)
    },
  ],
  sum_of_list: [numbers, 'number', ({ numbers }) => fsum(numbers.map(v))],
  product_of_list: [
    numbers,
    'number',
    ({ numbers }) => {
      let result: number | PyFloat = 1
      for (const x of numbers as PyFloat[]) result = F(Number(result) * x.v)
      return result
    },
  ],
  mean: [
    numbers,
    'number',
    ({ numbers }) => {
      if (numbers.length === 0) throw new PyError('Mean of empty list')
      return mean(numbers)
    },
  ],
  median: [
    numbers,
    'number',
    ({ numbers }) => {
      if (numbers.length === 0) throw new PyError('Median of empty list')
      const sortedNumbers = [...(numbers as PyFloat[])].sort((x, y) => (x.v < y.v ? -1 : y.v < x.v ? 1 : 0))
      const n = sortedNumbers.length
      const mid = Math.floor(n / 2)
      if (n % 2 === 0) return F((sortedNumbers[mid - 1]!.v + sortedNumbers[mid]!.v) / 2)
      return sortedNumbers[mid]
    },
  ],
  mode: [
    numbers,
    'number',
    ({ numbers }) => {
      if (numbers.length === 0) throw new PyError('Mode of empty list')
      const count = (x: unknown) => (numbers as PyFloat[]).filter((y) => pyEq(y, x)).length
      let best: unknown
      let bestCount = -1
      for (const x of new PySet(numbers)) {
        const c = count(x)
        if (c > bestCount) [best, bestCount] = [x, c]
      }
      return best
    },
  ],
  variance: [numbers, 'number', ({ numbers }) => variance(numbers)],
  standard_deviation: [
    numbers,
    'number',
    () => {
      throw new PyError("'FunctionTool' object is not callable")
    },
  ],
  clamp: [
    [
      ['value', 'float'],
      ['min_val', 'float'],
      ['max_val', 'float'],
    ],
    'number',
    ({ value, min_val, max_val }) => max(min_val, min(value, max_val)),
  ],
  hypot: [two, 'number', ({ a, b }) => F(hypot(v(a), v(b)))],
  cbrt: [one, 'number', ({ a }) => fpow(v(a), 1 / 3)],
})
