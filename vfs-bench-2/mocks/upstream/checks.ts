/**
 * Upstream's CHECK constraints as triggers. A kit fake's tables come from
 * its Prisma schema, which cannot state a CHECK; each run's file gets
 * upstream's as triggers that abort the same writes. They are read from
 * upstream's own CREATE TABLE statements, which each fixture carries in
 * `_schema` (harbor/fixtures/upstream.ts).
 */

/** Each CHECK's expression in a CREATE TABLE statement, in order. */
export function checksOf(sql: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    if (c === "'" || c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1)
      i = end < 0 ? sql.length : end + 1
      continue
    }
    if (/^CHECK\s*\(/i.test(sql.slice(i)) && !/\w/.test(sql[i - 1] ?? ' ')) {
      let j = sql.indexOf('(', i)
      const start = j + 1
      let depth = 0
      for (; j < sql.length; j++) {
        const d = sql[j]!
        if (d === "'") j = sql.indexOf("'", j + 1)
        else if (d === '(') depth++
        else if (d === ')' && --depth === 0) break
      }
      out.push(sql.slice(start, j))
      i = j + 1
      continue
    }
    i++
  }
  return out
}

/** A CHECK's expression on the row a write leaves: each column it names, `NEW.<column>`. */
export function onNew(check: string, columns: string[]): string {
  const names = new Set(columns.map((c) => c.toLowerCase()))
  let out = ''
  let i = 0
  while (i < check.length) {
    const c = check[i]!
    if (c === "'") {
      const end = check.indexOf("'", i + 1)
      out += check.slice(i, end + 1)
      i = end + 1
      continue
    }
    const word = /^("?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(check.slice(i))
    if (word !== null && !/[\w.]/.test(check[i - 1] ?? ' ')) {
      const after = check.slice(i + word[0].length)
      const isCall = /^\s*\(/.test(after)
      out += names.has(word[2]!.toLowerCase()) && !isCall ? `NEW."${word[2]}"` : word[0]
      i += word[0].length
      continue
    }
    out += c
    i++
  }
  return out
}

/** The triggers for a table's CHECKs, on insert and update, or none. */
export function checkTriggers(table: string, sql: string, columns: string[]): string[] {
  const checks = checksOf(sql).map((check) => `NOT (${onNew(check, columns)})`)
  if (checks.length === 0) return []
  return ['INSERT', 'UPDATE'].map(
    (event) =>
      `CREATE TRIGGER "${table}_check_${event.toLowerCase()}" BEFORE ${event} ON "${table}" ` +
      `WHEN ${checks.join(' OR ')} BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: ${table}'); END`,
  )
}
