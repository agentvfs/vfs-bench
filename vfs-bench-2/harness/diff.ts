/**
 * What changed between two snapshots, record by record.
 *
 * A snapshot is JSON. Objects are compared key by key. A list is a set of
 * records, matched by `id` when every record has a distinct one and by
 * value otherwise, so a list's order never shows up as a change.
 */

export interface Change {
  /** Keys from the snapshot's root to the record: `["email", "emails", "id=7"]`. */
  path: string[]
  kind: 'added' | 'removed' | 'updated'
  before?: unknown
  after?: unknown
}

/** Every record added, removed or updated from `before` to `after`. */
export function changes(before: unknown, after: unknown, path: string[] = []): Change[] {
  if (canonical(before) === canonical(after)) return []
  if (Array.isArray(before) && Array.isArray(after)) return listChanges(before, after, path)
  if (isRecord(before) && isRecord(after)) {
    const out: Change[] = []
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) out.push({ path: [...path, key], kind: 'removed', before: before[key] })
      else if (!(key in before)) out.push({ path: [...path, key], kind: 'added', after: after[key] })
      else out.push(...changes(before[key], after[key], [...path, key]))
    }
    return out
  }
  return [{ path, kind: 'updated', before, after }]
}

function listChanges(before: unknown[], after: unknown[], path: string[]): Change[] {
  const byId = (list: unknown[]) => {
    const ids = list.map((item) => (isRecord(item) && ['string', 'number'].includes(typeof item.id) ? String(item.id) : null))
    return ids.includes(null) || new Set(ids).size < ids.length ? null : new Map(ids.map((id, i) => [id!, list[i]]))
  }
  const old = byId(before)
  const now = byId(after)
  if (old !== null && now !== null) {
    const out: Change[] = []
    for (const [id, item] of old) {
      if (!now.has(id)) out.push({ path: [...path, `id=${id}`], kind: 'removed', before: item })
      else out.push(...changes(item, now.get(id), [...path, `id=${id}`]))
    }
    for (const [id, item] of now) if (!old.has(id)) out.push({ path: [...path, `id=${id}`], kind: 'added', after: item })
    return out
  }
  // No ids: a record that is not in the other list, as many times as it is not.
  const counts = new Map<string, number>()
  for (const item of before) counts.set(canonical(item), (counts.get(canonical(item)) ?? 0) + 1)
  const out: Change[] = []
  for (const item of after) {
    const key = canonical(item)
    if ((counts.get(key) ?? 0) > 0) counts.set(key, counts.get(key)! - 1)
    else out.push({ path, kind: 'added', after: item })
  }
  for (const item of before) {
    const key = canonical(item)
    if ((counts.get(key) ?? 0) > 0) {
      counts.set(key, counts.get(key)! - 1)
      out.push({ path, kind: 'removed', before: item })
    }
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON with every object's keys sorted, so equal values spell the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  )
}
