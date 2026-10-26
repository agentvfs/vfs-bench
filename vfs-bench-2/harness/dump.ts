/** Write one run's record to `dumps/<run id>.json`. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MIRAGE, ROOT } from './paths.ts'

export const DUMPS = join(ROOT, 'dumps')

/** The pinned Mirage commit the run used. */
export function mirageCommit(): string {
  return execFileSync('git', ['-C', MIRAGE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

/** Write a run record; its `run_id` names the file. */
export function write(record: { run_id: string } & Record<string, unknown>): string {
  mkdirSync(DUMPS, { recursive: true })
  const path = join(DUMPS, `${record.run_id}.json`)
  writeFileSync(path, JSON.stringify(record, null, 1))
  return path
}
