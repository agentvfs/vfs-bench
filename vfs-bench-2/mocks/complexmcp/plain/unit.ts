/**
 * UnitServer (`servers/unit/`): conversions between units of fourteen
 * quantities, each by a factor to a base unit and back (temperature and
 * angle by functions), and a batch of them. A unit is a `Literal`, so a
 * bad one is a validation error; a batch request's is a KeyError, which the
 * batch reports per request. The factors are upstream's, unit names
 * (non-breaking hyphens included) and all.
 */
import { PyError } from '../common.ts'
import { PyFloat, pyHash, pyKey, repr, reprFloat, str, toFloat, truthy } from '../py.ts'
import { type Literal, type PlainTool, plainTools } from '../tool.ts'

const F = (x: number) => new PyFloat(x)

/** Each factor table: its `Literal` of units (in order) and each unit's factor to the base unit. */
const FACTORS: Record<string, [string[], Record<string, number>]> = {
  // area.py: to_square_meters
  area: [
    ["acre", "are", "hectare", "square centimeter", "square foot", "square inch", "square kilometer", "square meter", "square mile", "square millimeter", "square yard"],
    {"acre": 4046.8564224, "are": 100.0, "hectare": 10000.0, "square centimeter": 0.0001, "square foot": 0.09290304, "square inch": 0.00064516, "square kilometer": 1000000.0, "square meter": 1.0, "square mile": 2589988.110336, "square millimeter": 1e-06, "square yard": 0.83612736},
  ],
  // computer.py: to_megabytes
  computer: [
    ["bits", "bytes", "kilobytes", "megabytes", "gigabytes", "terabytes", "petabytes", "exabytes"],
    {"bits": 1.19209e-07, "bytes": 9.53674e-07, "kilobytes": 0.0009765625, "megabytes": 1.0, "gigabytes": 1024.0, "terabytes": 1048576.0, "petabytes": 1073741824.0, "exabytes": 1099511627776.0},
  ],
  // density.py: to_kilograms_per_liter
  density: [
    ["grains per gallon (UK)", "grains per gallon (US)", "grains per gallon", "grams per cubic centimeter", "grams per liter", "kilograms per liter", "kilograms per cubic meter", "milligrams per liter", "ounces per gallon (UK)", "ounces per gallon (US)", "ounces per gallon", "pounds per cubic foot", "pounds per gallon (UK)", "pounds per gallon (US)", "pounds per gallon", "tonnes per cubic meter", "tons per cubic yard (UK)", "tons per cubic yard (US)", "tons per cubic yard"],
    {"grains per gallon (UK)": 1.4253948e-05, "grains per gallon (US)": 1.7118012e-05, "grains per gallon": 1.7118012e-05, "grams per cubic centimeter": 1.0, "grams per liter": 0.001, "kilograms per liter": 1.0, "kilograms per cubic meter": 0.001, "milligrams per liter": 1e-06, "ounces per gallon (UK)": 0.006236023, "ounces per gallon (US)": 0.007489152, "ounces per gallon": 0.007489152, "pounds per cubic foot": 0.016018463, "pounds per gallon (UK)": 0.099776373, "pounds per gallon (US)": 0.119826427, "pounds per gallon": 0.119826427, "tonnes per cubic meter": 1.0, "tons per cubic yard (UK)": 1.328939184, "tons per cubic yard (US)": 1.186552843, "tons per cubic yard": 1.186552843},
  ],
  // energy.py: to_joules
  energy: [
    ["joule", "kilojoule", "megajoule", "gigajoule", "terajoule", "petajoule", "exajoule", "watt hour", "kilowatt hour", "megawatt hour", "gigawatt hour", "terawatt hour", "Btu", "calorie", "kilocalorie", "therm", "foot‑pound force", "inch‑pound force", "erg", "electron volt"],
    {"joule": 1.0, "kilojoule": 1000.0, "megajoule": 1000000.0, "gigajoule": 1000000000.0, "terajoule": 1000000000000.0, "petajoule": 1000000000000000.0, "exajoule": 1e+18, "watt hour": 3600.0, "kilowatt hour": 3600000.0, "megawatt hour": 3600000000.0, "gigawatt hour": 3600000000000.0, "terawatt hour": 3600000000000000.0, "Btu": 1054.35, "calorie": 4.184, "kilocalorie": 4184.0, "therm": 105505585.257348, "foot‑pound force": 1.355817948331, "inch‑pound force": 0.112984829028, "erg": 1e-07, "electron volt": 1.602176634e-19},
  ],
  // force.py: to_newtons
  force: [
    ["dynes", "kilograms force", "kilonewtons", "kips", "meganewtons", "newtons", "pounds force", "tonnes force", "long tons force", "short tons force"],
    {"dynes": 1e-05, "kilograms force": 9.80665, "kilonewtons": 1000.0, "kips": 4448.222, "meganewtons": 1000000.0, "newtons": 1.0, "pounds force": 4.44822161526, "tonnes force": 9806.65, "long tons force": 9964.01641818352, "short tons force": 8896.443230521},
  ],
  // length.py: to_meters
  length: [
    ["angstrom", "astronomical unit", "cable", "centimeter", "chain (surveyors)", "decimeter", "em (pica)", "fathom", "foot", "foot (US survey)", "furlong", "hand", "hectometer", "inch", "kilometer", "light year", "meter", "micrometer", "mil", "mile", "nautical mile", "nautical mile (UK)", "millimeter", "nanometer", "parsec", "picometer", "Scandinavian mile", "thou", "yard"],
    {"angstrom": 1e-10, "astronomical unit": 149598550000.0, "cable": 182.88, "centimeter": 0.01, "chain (surveyors)": 20.11684023368, "decimeter": 0.1, "em (pica)": 0.0042333, "fathom": 1.8288, "foot": 0.3048, "foot (US survey)": 0.304800609601, "furlong": 201.168, "hand": 0.1016, "hectometer": 100.0, "inch": 0.0254, "kilometer": 1000.0, "light year": 9460528405000000.0, "meter": 1.0, "micrometer": 1e-06, "mil": 2.54e-05, "mile": 1609.344, "nautical mile": 1852.0, "nautical mile (UK)": 1853.184, "millimeter": 0.001, "nanometer": 1e-09, "parsec": 3.0856776e+16, "picometer": 1e-12, "Scandinavian mile": 10000.0, "thou": 2.54e-05, "yard": 0.9144},
  ],
  // mass.py: to_kilograms
  mass: [
    ["carat", "decagram", "hectogram", "gram", "milligram", "microgram", "nanogram", "picogram", "femtogram", "grain", "ounce", "troy ounce", "pound", "stone", "short ton (US)", "long ton (UK)", "tonne", "kilotonne", "megatonne", "kilogram"],
    {"carat": 0.0002, "decagram": 0.01, "hectogram": 0.1, "gram": 0.001, "milligram": 1e-06, "microgram": 1e-09, "nanogram": 1e-12, "picogram": 1e-15, "femtogram": 1e-18, "grain": 6.479891e-05, "ounce": 0.028349523125, "troy ounce": 0.0311034768, "pound": 0.45359237, "stone": 6.35029318, "short ton (US)": 907.18474, "long ton (UK)": 1016.0469088, "tonne": 1000.0, "kilotonne": 1000000.0, "megatonne": 1000000000.0, "kilogram": 1.0},
  ],
  // power.py: to_watts
  power: [
    ["Btu per hour", "foot pound‑force per second", "ton of refrigeration", "calorie per hour", "kilocalorie per hour", "horsepower", "horsepower (metric)", "kilogram‑force meter per second", "watt", "kilowatt", "megawatt", "gigawatt", "terawatt", "petawatt"],
    {"Btu per hour": 0.2930711, "foot pound‑force per second": 1.35582, "ton of refrigeration": 3516.853, "calorie per hour": 0.001162222222, "kilocalorie per hour": 1.162222222222, "horsepower": 745.69987158227, "horsepower (metric)": 735.4988, "kilogram‑force meter per second": 9.80665, "watt": 1.0, "kilowatt": 1000.0, "megawatt": 1000000.0, "gigawatt": 1000000000.0, "terawatt": 1000000000000.0, "petawatt": 1000000000000000.0},
  ],
  // pressure.py: to_pascals
  pressure: [
    ["pascal", "hectopascal", "kilopascal", "megapascal", "bar", "atmosphere", "centimeters of water", "inches of water", "feet of water", "meters of water", "millimeters of mercury", "inches of mercury", "kilogram force per square centimeter", "newtons per square centimeter", "newtons per square millimeter", "psi", "psf"],
    {"pascal": 1.0, "hectopascal": 100.0, "kilopascal": 1000.0, "megapascal": 1000000.0, "bar": 100000.0, "atmosphere": 101325.0, "centimeters of water": 98.0665, "inches of water": 249.08891, "feet of water": 2989.06692, "meters of water": 9806.65, "millimeters of mercury": 133.322, "inches of mercury": 3386.388, "kilogram force per square centimeter": 98066.5, "newtons per square centimeter": 10000.0, "newtons per square millimeter": 1000000.0, "psi": 6894.757293168362, "psf": 47.880258980336},
  ],
  // speed.py: to_meters_per_second
  speed: [
    ["centimeters per minute", "centimeters per second", "feet per hour", "feet per minute", "feet per second", "inches per minute", "inches per second", "kilometers per hour", "kilometers per second", "knots", "Mach (ISA sea level)", "speed of sound", "meters per hour", "meters per minute", "meters per second", "miles per hour", "miles per minute", "miles per second", "yards per hour", "yards per minute", "yards per second", "speed of light"],
    {"centimeters per minute": 0.000166666667, "centimeters per second": 0.01, "feet per hour": 8.4666836e-05, "feet per minute": 0.00508, "feet per second": 0.3048, "inches per minute": 0.00042333418, "inches per second": 0.0254, "kilometers per hour": 0.277777777778, "kilometers per second": 1000.0, "knots": 0.514444444444, "Mach (ISA sea level)": 340.2933, "speed of sound": 343.0, "meters per hour": 0.000277777778, "meters per minute": 0.016666666667, "meters per second": 1.0, "miles per hour": 0.44704, "miles per minute": 26.8224, "miles per second": 1609.344, "yards per hour": 0.000254000508, "yards per minute": 0.01524, "yards per second": 0.9144, "speed of light": 299792458.0},
  ],
  // time.py: to_seconds
  time: [
    ["picoseconds", "femtoseconds", "nanoseconds", "microseconds", "milliseconds", "seconds", "minutes", "hours", "days", "weeks", "fortnights", "months", "quarters", "synodic months", "years", "decades", "centuries", "millennia"],
    {"picoseconds": 1e-12, "femtoseconds": 1e-15, "nanoseconds": 1e-09, "microseconds": 1e-06, "milliseconds": 0.001, "seconds": 1.0, "minutes": 60.0, "hours": 3600.0, "days": 86400.0, "weeks": 604800.0, "fortnights": 1209600.0, "months": 2628000.0, "quarters": 7884000.0, "synodic months": 2551442.8896, "years": 31556952.0, "decades": 315569520.0, "centuries": 3155695200.0, "millennia": 31556952000.0},
  ],
  // volume.py: to_liters
  volume: [
    ["acre foot", "barrel (oil)", "bushel (UK)", "bushel (US)", "bushel", "centiliter", "cubic centimeter", "cubic decimeter", "cubic foot", "cubic inch", "cubic kilometer", "cubic meter", "cubic mile", "cubic millimeter", "cubic yard", "cup", "deciliter", "fluid ounce (imperial)", "fluid ounce (US)", "fluid ounce", "gallon (imperial)", "gallon (US)", "gallon", "kiloliter", "liter", "milliliter", "microliter", "nanoliter", "picoliter", "pint (imperial)", "pint (US)", "pint", "quart (imperial)", "quart (US)", "quart", "tablespoon", "teaspoon"],
    {"acre foot": 1233481.83754752, "barrel (oil)": 158.987294928, "bushel (UK)": 36.36872, "bushel (US)": 35.23907016688, "bushel": 35.23907016688, "centiliter": 0.01, "cubic centimeter": 0.001, "cubic decimeter": 1.0, "cubic foot": 28.316846592, "cubic inch": 0.016387064, "cubic kilometer": 1000000000000.0, "cubic meter": 1000.0, "cubic mile": 4168181825000.0, "cubic millimeter": 1e-06, "cubic yard": 764.554857984, "cup": 0.2365882365, "deciliter": 0.1, "fluid ounce (imperial)": 0.0284130625, "fluid ounce (US)": 0.029573529562, "fluid ounce": 0.029573529562, "gallon (imperial)": 4.54609, "gallon (US)": 3.785411784, "gallon": 3.785411784, "kiloliter": 1000.0, "liter": 1.0, "milliliter": 0.001, "microliter": 1e-06, "nanoliter": 1e-09, "picoliter": 1e-12, "pint (imperial)": 0.56826125, "pint (US)": 0.473176473, "pint": 0.473176473, "quart (imperial)": 1.1365225, "quart (US)": 0.946352946, "quart": 0.946352946, "tablespoon": 0.014786764781, "teaspoon": 0.004928921594},
  ],
}

const ANGLE = ['degrees', 'radians', 'arcmin', 'arcsec', 'turns', 'gons']
const TEMPERATURE = ['celsius', 'fahrenheit', 'kelvin']

/** `KeyError(key)` as a lookup in a factor or function table raises it: its str is the key's repr. */
function lookup<T>(table: Record<string, T>, key: string): T {
  if (!Object.hasOwn(table, key)) throw new PyError(repr(key))
  return table[key]!
}

/** A factor table's `convert_<x>_tool`: to the base unit, then from it. */
const byFactor = (name: string) => (value: number, from: string, to: string): PyFloat => {
  const factors = FACTORS[name]![1]
  const base = value * lookup(factors, from)
  return F(base / lookup(factors, to))
}

/** `convert_angle_tool`: through degrees. */
function convertAngle(value: number, from: string, to: string): PyFloat {
  const toDegrees: Record<string, (x: number) => number> = {
    radians: (x) => (x * 180.0) / Math.PI,
    arcmin: (x) => x / 60.0,
    arcsec: (x) => x / 3_600.0,
    turns: (x) => x * 360.0,
    gons: (x) => x * (9.0 / 10.0),
    degrees: (x) => x,
  }
  const fromDegrees: Record<string, (x: number) => number> = {
    radians: (x) => (x * Math.PI) / 180.0,
    arcmin: (x) => x * 60.0,
    arcsec: (x) => x * 3_600.0,
    turns: (x) => x / 360.0,
    gons: (x) => x * (10.0 / 9.0),
    degrees: (x) => x,
  }
  const degrees = lookup(toDegrees, from)(value)
  return F(lookup(fromDegrees, to)(degrees))
}

/** `convert_temperature_tool`: through Celsius; a negative kelvin fails `Validator('temperature')`. */
function convertTemperature(value: number, from: string, to: string): PyFloat {
  const toCelsius: Record<string, (x: number) => number> = {
    fahrenheit: (x) => ((x - 32) * 5) / 9,
    kelvin: (x) => {
      if (x < 0) throw new PyError(`temperature must be non-negative, got ${reprFloat(x)}`)
      return x - 273.15
    },
    celsius: (x) => x,
  }
  const fromCelsius: Record<string, (x: number) => number> = {
    fahrenheit: (x) => (x * 9) / 5 + 32,
    kelvin: (x) => x + 273.15,
    celsius: (x) => x,
  }
  const celsius = lookup(toCelsius, from)(value)
  return F(lookup(fromCelsius, to)(celsius))
}

/** `CONVERSION_FUNCTIONS`, in batch.py's order. */
const CONVERSIONS: Record<string, (value: number, from: string, to: string) => PyFloat> = {
  angle: convertAngle,
  area: byFactor('area'),
  computer_data: byFactor('computer'),
  density: byFactor('density'),
  energy: byFactor('energy'),
  force: byFactor('force'),
  length: byFactor('length'),
  mass: byFactor('mass'),
  power: byFactor('power'),
  pressure: byFactor('pressure'),
  speed: byFactor('speed'),
  temperature: convertTemperature,
  time: byFactor('time'),
  volume: byFactor('volume'),
}

/** A conversion tool: `value`, two units of its `Literal`, and the dict it answers. */
function converter(type: string, units: readonly string[]): PlainTool {
  const unit: Literal = { literal: units }
  return [
    [
      ['value', 'float'],
      ['from_unit', unit],
      ['to_unit', unit],
    ],
    'dict',
    ({ value, from_unit, to_unit }) => ({
      original_value: value,
      original_unit: from_unit,
      converted_value: CONVERSIONS[type]!(value.v, from_unit, to_unit),
      converted_unit: to_unit,
      conversion_type: type,
    }),
  ]
}

/**
 * A batch request's default id, `f"{conversion_type}_{hash((value,
 * from_unit, to_unit))}"`: a tuple's hash over strs, which upstream salts
 * per process, so any is as good; this one is CPython's tuple hash over
 * `pyHash`.
 */
function defaultId(type: unknown, value: PyFloat, from: string, to: string): string {
  const mask = (1n << 64n) - 1n
  const [P1, P2, P5] = [11400714785074694791n, 14029467366897019727n, 2870177450012600261n]
  let acc = P5
  for (const item of [value, from, to]) {
    acc = (acc + (BigInt.asUintN(64, pyHash(item)) * P2)) & mask
    acc = ((acc << 31n) | (acc >> 33n)) & mask
    acc = (acc * P1) & mask
  }
  acc = (acc + (3n ^ (P5 ^ 3527539n))) & mask
  if (acc === mask) acc = 1546275796n
  return `${str(type)}_${BigInt.asIntN(64, acc)}`
}

/** `convert_batch_tool`: each request's result, a failure as its error's str. */
function convertBatch(requests: Record<string, unknown>[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  for (const data of requests) {
    let result: Record<string, unknown>
    try {
      const get = (k: string) => (Object.hasOwn(data, k) ? data[k] : null)
      const value = get('value')
      const fromUnit = get('from_unit')
      const toUnit = get('to_unit')
      const conversionType = get('conversion_type')
      const requestId = get('request_id')
      if (value === null) throw new PyError('Missing required field: value')
      if (!truthy(fromUnit)) throw new PyError('Missing required field: from_unit')
      if (!truthy(toUnit)) throw new PyError('Missing required field: to_unit')
      if (!truthy(conversionType)) throw new PyError('Missing required field: conversion_type')
      const request = {
        value: toFloat(value),
        from_unit: str(fromUnit),
        to_unit: str(toUnit),
        conversion_type: conversionType,
        request_id: requestId as unknown,
      }
      if (!truthy(request.request_id)) request.request_id = defaultId(conversionType, request.value, request.from_unit, request.to_unit)
      pyKey(request.conversion_type)
      if (typeof request.conversion_type !== 'string' || !Object.hasOwn(CONVERSIONS, request.conversion_type)) {
        throw new PyError(`Unsupported conversion type: ${str(request.conversion_type)}`)
      }
      const converted = CONVERSIONS[request.conversion_type]!(request.value.v, request.from_unit, request.to_unit)
      result = {
        request_id: request.request_id,
        success: true,
        original_value: request.value,
        original_unit: request.from_unit,
        converted_value: converted,
        converted_unit: request.to_unit,
        conversion_type: request.conversion_type,
      }
    } catch (error) {
      if (!(error instanceof PyError)) throw error
      result = {
        request_id: Object.hasOwn(data, 'request_id') ? data.request_id : `error_${results.length}`,
        success: false,
        error: error.message,
      }
    }
    results.push(result)
  }
  return results
}

/** `list_supported_units`' table, in its own order (temperature before length). */
const SUPPORTED: [string, readonly string[]][] = [
  ['angle', ANGLE],
  ['area', FACTORS.area![0]],
  ['computer_data', FACTORS.computer![0]],
  ['density', FACTORS.density![0]],
  ['energy', FACTORS.energy![0]],
  ['force', FACTORS.force![0]],
  ['temperature', TEMPERATURE],
  ['length', FACTORS.length![0]],
  ['mass', FACTORS.mass![0]],
  ['power', FACTORS.power![0]],
  ['pressure', FACTORS.pressure![0]],
  ['speed', FACTORS.speed![0]],
  ['time', FACTORS.time![0]],
  ['volume', FACTORS.volume![0]],
]

const UNIT_TYPE: Literal = {
  literal: ['angle', 'area', 'computer_data', 'density', 'energy', 'force', 'length', 'mass', 'power', 'pressure', 'speed', 'temperature', 'time', 'volume'],
  none: true,
}

export const tools = plainTools({
  convert_temperature: converter('temperature', TEMPERATURE),
  convert_angle: converter('angle', ANGLE),
  convert_length: converter('length', FACTORS.length![0]),
  convert_energy: converter('energy', FACTORS.energy![0]),
  convert_force: converter('force', FACTORS.force![0]),
  convert_pressure: converter('pressure', FACTORS.pressure![0]),
  convert_power: converter('power', FACTORS.power![0]),
  convert_speed: converter('speed', FACTORS.speed![0]),
  convert_area: converter('area', FACTORS.area![0]),
  convert_mass: converter('mass', FACTORS.mass![0]),
  convert_volume: converter('volume', FACTORS.volume![0]),
  convert_computer_data: converter('computer_data', FACTORS.computer![0]),
  convert_density: converter('density', FACTORS.density![0]),
  convert_time: converter('time', FACTORS.time![0]),
  convert_batch: [
    [['requests', 'list[dict]']],
    'dict',
    ({ requests }) => {
      const results = convertBatch(requests)
      const successful = results.filter((r) => r.success).length
      return {
        batch_results: results,
        summary: { total_requests: requests.length, successful_conversions: successful, failed_conversions: results.length - successful },
      }
    },
  ],
  list_supported_units: [
    [['unit_type', UNIT_TYPE, null]],
    'dict',
    ({ unit_type }) => {
      const all = Object.fromEntries(SUPPORTED)
      if (unit_type !== null) return { [unit_type]: all[unit_type] }
      return all
    },
  ],
})
