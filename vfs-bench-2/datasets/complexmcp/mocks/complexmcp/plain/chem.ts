/**
 * ChemServer (`servers/chem/app.py`): molar masses from a small periodic
 * table, formulas, pH and the ideal gas law, statement for statement. A
 * formula is read as upstream's regex reads it, `([A-Z][a-z]?)(\d*)`, whose
 * `\d` takes any script's digits; counts are Python ints. The balancing and
 * balance check are upstream's placeholders.
 */
import { PyError } from '../common.ts'
import { PyFloat, big, fdiv, fpow, libm, parseIntStr, small } from '../../../../../workspace/py.ts'
import type { PyInt } from '../../../../../workspace/py.ts'
import { type ParamSpec, plainTools } from '../tool.ts'

const PERIODIC: Record<string, number> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  Cl: 35.45,
  Na: 22.99,
  S: 32.06,
  P: 30.974,
}

const F = (x: number) => new PyFloat(x)

/** `re.findall(r"([A-Z][a-z]?)(\d*)", formula)`. */
const parts = (formula: string): [string, string][] => [...formula.matchAll(/([A-Z][a-z]?)(\p{Nd}*)/gu)].map((m) => [m[1]!, m[2]!])

/** An int as a float operand: CPython's `int.__float__`, which fails past the largest double. */
function asFloat(n: bigint): number {
  const f = Number(n)
  if (!Number.isFinite(f)) throw new PyError('int too large to convert to float')
  return f
}

const count = (num: string): bigint => (num ? parseIntStr(num) : 1n)

/** `PERIODIC.get(el, 0.0)`. */
const weight = (el: string): number => (Object.hasOwn(PERIODIC, el) ? PERIODIC[el]! : 0.0)

function molarMass(formula: string): number {
  let mass = 0.0
  for (const [el, num] of parts(formula)) mass += weight(el) * asFloat(count(num))
  return mass
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b) [a, b] = [b, a % b]
  return a
}

/** Python's `max(lo, min(value, hi))`. */
function clamp(value: PyFloat, lo: PyFloat, hi: PyFloat): PyFloat {
  const m = hi.v < value.v ? hi : value
  return m.v > lo.v ? m : lo
}

const formula: ParamSpec[] = [['formula', 'str']]

export const tools = plainTools({
  molar_mass: [formula, 'number', ({ formula }) => F(molarMass(formula))],
  empirical_formula: [
    formula,
    'string',
    ({ formula }) => {
      const counts = new Map<string, bigint>()
      for (const [el, num] of parts(formula)) counts.set(el, (counts.get(el) ?? 0n) + count(num))
      const vals = [...counts.values()]
      if (vals.length === 0) throw new PyError('list index out of range')
      let g = vals[0]!
      for (const v of vals.slice(1)) g = gcd(g, v)
      const floorDiv = (a: bigint) => {
        if (g === 0n) throw new PyError('division by zero')
        const q = a / g
        return (a % g !== 0n) && (a < 0n) !== (g < 0n) ? q - 1n : q
      }
      const els = [...counts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      return els.map((el) => `${el}${floorDiv(counts.get(el)!) > 1n ? floorDiv(counts.get(el)!) : ''}`).join('')
    },
  ],
  percent_composition: [
    formula,
    'dict',
    ({ formula }) => {
      const mm = molarMass(formula)
      const comp: Record<string, PyFloat | number> = {}
      for (const [el, num] of parts(formula)) {
        const n = count(num)
        comp[el] = mm ? F(((weight(el) * asFloat(n)) / mm) * 100) : 0
      }
      return comp
    },
  ],
  balance_simple_reaction: [
    [
      ['reactants', 'dict'],
      ['products', 'dict'],
    ],
    'dict',
    ({ reactants, products }) => ({ reactants, products }),
  ],
  is_balanced: [formula, 'boolean', () => true],
  ph_from_concentration: [
    [['h_conc', 'float']],
    'number',
    ({ h_conc }) => {
      if (h_conc.v <= 0) throw new PyError('invalid')
      return F(-libm.log10(h_conc.v))
    },
  ],
  concentration_from_ph: [[['ph', 'float']], 'number', ({ ph }) => fpow(10, -ph.v)],
  ideal_gas_pressure: [
    [
      ['n_moles', 'float'],
      ['temp_k', 'float'],
      ['volume_l', 'float'],
    ],
    'number',
    ({ n_moles, temp_k, volume_l }) => {
      const R = 8.31446261815324
      const V = volume_l.v / 1000.0
      return fdiv(n_moles.v * R * temp_k.v, V)
    },
  ],
  convert_moles_to_grams: [
    [
      ['moles', 'float'],
      ['formula', 'str'],
    ],
    'number',
    ({ moles, formula }) => F(moles.v * molarMass(formula)),
  ],
  convert_grams_to_moles: [
    [
      ['grams', 'float'],
      ['formula', 'str'],
    ],
    'number',
    ({ grams, formula }) => {
      const mm = molarMass(formula)
      return mm ? F(grams.v / mm) : 0
    },
  ],
  normalize_formula: [formula, 'string', ({ formula }) => (formula as string).replaceAll(' ', '')],
  element_list: [formula, 'list', ({ formula }) => parts(formula).map(([el]) => el)],
  combustion_products: [
    [['fuel_formula', 'str']],
    'dict',
    ({ fuel_formula }) => {
      const found = new Map(parts(fuel_formula))
      const int = (s: string): PyInt => {
        if (s === '') throw new PyError("invalid literal for int() with base 10: ''")
        return small(parseIntStr(s))
      }
      const c = int(found.get('C') ?? '1')
      const h = int(found.get('H') ?? '0')
      return { CO2: c, H2O: small(big(h) / 2n) }
    },
  ],
  is_organic: [formula, 'boolean', ({ formula }) => (formula as string).includes('C')],
  simple_smiles_validate: [
    [['smiles', 'str']],
    'boolean',
    ({ smiles }) => {
      let depth = 0
      for (const ch of smiles as string) {
        if (ch === '(') depth++
        else if (ch === ')') {
          if (depth === 0) return false
          depth--
        }
      }
      return depth === 0
    },
  ],
  mole_fraction: [
    [
      ['partial_moles', 'float'],
      ['total_moles', 'float'],
    ],
    'number',
    ({ partial_moles, total_moles }) => (total_moles.v ? F(partial_moles.v / total_moles.v) : 0),
  ],
  clamp: [
    [
      ['value', 'float'],
      ['lo', 'float'],
      ['hi', 'float'],
    ],
    'number',
    ({ value, lo, hi }) => clamp(value, lo, hi),
  ],
})
