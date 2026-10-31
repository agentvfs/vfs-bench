/** Test-only: a SQLite file's tables as a fake's state view gives them. Never imported by native grading. */
import { DatabaseSync } from 'node:sqlite'
import type { Tables } from './graders/context.ts'
export function sqliteTables(source: string | DatabaseSync): Tables {
  const db = typeof source === 'string' ? new DatabaseSync(source, { readOnly: true }) : source
  try {
    return Object.fromEntries(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as { name: string }[]
      ).map(({ name }) => [
        name,
        db
          .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
          .all()
          .map((row, i) => ({ __order: i + 1, ...row })),
      ])
    )
  } finally {
    if (typeof source === 'string') db.close()
  }
}
