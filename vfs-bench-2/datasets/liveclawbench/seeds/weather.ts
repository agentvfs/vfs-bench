/**
 * The weather fake's fixture: upstream's weather seed (mocks/weather/src/seed.ts),
 * today's and tomorrow's forecast for five cities, today being the epoch's
 * date in China Standard Time.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Upstream's tables, parents first. */
const TABLES = ['location', 'weather_daily', 'weather_hourly', 'air_quality_snapshot', 'health_activity_tip']

export async function weather(mock: string): Promise<Record<string, unknown[]>> {
  // Read when the module loads.
  const dir = mkdtempSync(join(tmpdir(), 'vfsbench-weather-seed-'))
  process.env.WEATHER_DB_PATH = join(dir, 'weather.db')
  const seed = (await import(join(mock, 'src', 'seed.ts'))) as {
    initDb: () => void
    db: import('bun:sqlite').Database
  }
  seed.initDb()
  const out: Record<string, unknown[]> = {}
  for (const table of TABLES) out[table] = seed.db.query(`SELECT * FROM ${table} ORDER BY id`).all()
  seed.db.close()
  rmSync(dir, { recursive: true, force: true })
  return out
}
