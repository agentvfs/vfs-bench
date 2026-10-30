/**
 * A digest of an upstream mock's tables, for a mock whose seed runs in the
 * fake (`seedsRun` in mocks.ts): `harbor/fixtures/upstream.ts` writes it into
 * the fixture from upstream's seed under Bun, and the fake checks the run's
 * seed against it (fake.ts). Each table's row count and the SHA-256 of its
 * rows, in rowid order, each as JSON with its columns in the table's order.
 *
 * Plain code over a function that runs a query, so bun:sqlite and
 * node:sqlite both run it.
 */
import { createHash } from 'node:crypto'

/** A table's digest, by its name: `<rows> <sha256>`. */
export function digest(tables: string[], all: (sql: string) => unknown[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const table of [...tables].sort()) {
    const hash = createHash('sha256')
    const rows = all(`SELECT * FROM "${table}" ORDER BY rowid`)
    for (const row of rows) hash.update(`${JSON.stringify({ ...(row as object) })}\n`)
    out[table] = `${rows.length} ${hash.digest('hex')}`
  }
  return out
}

/** The name of a table's row in the fixture's `_seed`. */
export const seedRow = (table: string) => `table:${table}`
