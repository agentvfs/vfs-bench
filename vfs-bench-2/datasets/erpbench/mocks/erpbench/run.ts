/**
 * What every request on a run shares: the task's kit (convert.py's
 * `state/erpbench/kit/<task>.json`, never in the workspace) and the run's
 * trace. `_trace` holds upstream's entries (`ErpWorld._record`), which its
 * grader reads; `_seen` holds, for an entry a mount's request recorded, the
 * host time it arrived and its witness (graders/seen.ts).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loads } from '../../../enterpriseops/mocks/enterpriseops/py.ts'
import type { Conn } from '../../../enterpriseops/mocks/enterpriseops/sqlite.ts'
import type { Witness } from '../../graders/seen.ts'
import { type Dict, deepcopy, dumps } from './py.ts'
import { type Kit, SERVER_BY_PREFIX } from './world.ts'

/** Upstream's checkout and convert.py's per-task kits. */
export const STATE = process.env.ERPBENCH_STATE ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'state', 'erpbench')

const kits = new Map<string, Kit>()

/** A task's kit, read once per process. */
export function kitOf(task: string): Kit {
  let kit = kits.get(task)
  if (kit === undefined) {
    if (!/^erpbench-\d+$/.test(task)) throw new Error(`not an ERPBench task: ${task}`)
    kit = loads<Kit>(readFileSync(join(STATE, 'kit', `${task}.json`), 'utf8'))
    kits.set(task, kit)
  }
  return kit
}

/** The run's task's kit. */
export const kitOfRun = (conn: Conn): Kit => kitOf(String(conn.execute('SELECT task FROM _seed').fetchone()?.task))

/** `ErpWorld._record`: the call's trace entry, appended to `_trace`; its index. */
export function record(conn: Conn, tool: string, args: Dict, success: boolean, result: Dict): number {
  const index = (conn.execute('SELECT COUNT(*) AS n FROM _trace').fetchone()!.n as number) + 1
  const entry = { index, server: SERVER_BY_PREFIX[tool.split('.')[0]!] ?? 'erpbench', tool, arguments: deepcopy(args), success, result: deepcopy(result) }
  conn.execute('INSERT INTO _trace (idx, entry) VALUES (?, ?)', [index, dumps(entry)])
  return index
}

/** A mount-recorded entry's host arrival time and witness. */
export function remember(conn: Conn, index: number, witness: Witness): void {
  conn.execute('INSERT INTO _seen (idx, at_ms, witness) VALUES (?, ?, ?)', [index, Date.now(), JSON.stringify(witness)])
}
