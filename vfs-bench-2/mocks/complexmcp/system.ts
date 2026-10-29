/**
 * LightSystem (`software/LightSystem/`): the clock every Light app of a
 * session shares, `ClockSession`. Its time starts at a random second of
 * 2026, drawn from the session's seed, and moves only when an app steps it.
 */
import type { Os } from './common.ts'
import { formatStamp, parseStamp } from './py.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, ok } from './tool.ts'

export interface ClockData {
  now: string
  rng: RandomState
}

export class Clock {
  rng: PyRandom
  now: string

  constructor(data: ClockData) {
    this.rng = PyRandom.from(data.rng)
    this.now = data.now
  }

  /** `ClockSession(seed)`. */
  static create(seed: number): Clock {
    const rng = new PyRandom(seed)
    const start = Date.UTC(2026, 0, 1)
    const offset = rng.randrange((Date.UTC(2027, 0, 1) - start) / 1000)
    return new Clock({ now: formatStamp(start + offset * 1000), rng: rng.getstate() })
  }

  data(): ClockData {
    return { now: this.now, rng: this.rng.getstate() }
  }

  nowResult() {
    return ok(this.now)
  }

  step() {
    this.now = formatStamp(parseStamp(this.now)! + this.rng.randint(1, 10) * 1000)
    return this.nowResult()
  }

  /**
   * `gen_past(start_year, k)`: k sorted random seconds from the start of
   * `start_year` to now. Upstream's early returns are a bare list, which
   * its connector then fails on; no app reaches them.
   */
  genPast(startYear: number, k: number): { status: string; output: string[] } | string[] {
    if (k <= 0) return []
    const start = Date.UTC(startYear, 0, 1)
    const end = parseStamp(this.now)!
    if (start >= end) return Array<string>(k).fill(this.now)
    const range = (end - start) / 1000
    const stamps: number[] = []
    for (let i = 0; i < k; i++) stamps.push(start + this.rng.randrange(range + 1) * 1000)
    stamps.sort((a, b) => a - b)
    return ok(stamps.map(formatStamp))
  }

  /** An app's connector to this clock, in the same process (a login). */
  os(): Os {
    return {
      now: async () => this.now,
      step: async () => this.step().output,
      genPast: async (startYear, k) => {
        const out = this.genPast(startYear, k)
        if (Array.isArray(out)) throw new Error('gen_past answered no status')
        return out.output
      },
    }
  }
}

const tools: Tools<Clock> = {
  now: { params: [], run: async (c) => c.nowResult() },
  health: { params: [], run: async () => ok('The OS is alive') },
}

export const LightSystem: App<Clock, ClockData> = {
  name: 'LightSystem',
  tools,
  load: (data) => new Clock(data),
  save: (c) => c.data(),
  sessionDict: () => ({}),
}
