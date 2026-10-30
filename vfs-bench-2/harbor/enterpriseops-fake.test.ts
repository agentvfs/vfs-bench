/**
 * The EnterpriseOps-Gym fakes' verifier queries, as upstream's SQL runner
 * (Python's `sqlite3`) answers them: a double-quoted value is a string
 * where no column has its name, as several of upstream's verifiers write
 * one (`case_id = "80"`), and a float keeps its type.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { serverFake } from '../mocks/enterpriseops/fake.ts'
import { Conn } from '../mocks/enterpriseops/sqlite.ts'

test("a verifier query reads double-quoted values as upstream's runner does", () => {
  const dir = mkdtempSync(join(tmpdir(), 'enterpriseops-fake-'))
  try {
    const schema = join(dir, 'schema.sql')
    writeFileSync(schema, '')
    const file = join(dir, 'run.db')
    const conn = new Conn(file, () => 0)
    conn.executescript("CREATE TABLE cases (case_id INTEGER, status TEXT, cost REAL); INSERT INTO cases VALUES (80, 'resolved', 2.0);")
    conn.commit()
    conn.close()
    const fake = serverFake({ tools: {}, seed: () => {}, schema }, {} as any, class {} as any, {} as any)
    const ask = (query: string) => fake.verifierQuery({ file } as any, query, 0)
    assert.deepEqual(ask('SELECT COUNT(*) AS n FROM cases WHERE case_id = "80" AND status = "resolved"'), { rows: [{ n: 1 }] })
    assert.deepEqual(ask('SELECT status, cost FROM cases WHERE status = "resolved"'), {
      rows: [{ status: 'resolved', cost: { __float__: 2 } }],
    })
    // A name that is a column stays the column.
    assert.deepEqual(ask('SELECT COUNT(*) AS n FROM cases WHERE "status" = \'resolved\''), { rows: [{ n: 1 }] })
    assert.deepEqual(ask('DELETE FROM cases'), { error: 'Only read-only SELECT queries are allowed' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
