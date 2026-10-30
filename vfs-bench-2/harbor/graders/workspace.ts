import { eq, orderBy, type Grader, grade, lower } from './context.ts'
import DATA from './reference-data.json' with { type: 'json' }
const DB = '/var/lib/mock-data/workspace/workspace.db',
  EXPENSE = '/var/lib/mock-data/expense/expense.db'
export const WORKSPACE_GRADERS: Record<string, Grader> = {
  'expense-draft-delete': (c) => {
    try {
      const user = c
        .rows(EXPENSE, 'user')
        .filter(
          (r) => eq(r.email, 'alice@mosi.inc') && eq(r.password, 'password123') && eq(r.is_active, 1)
        )[0]
      if (!user) return grade(0)
      const codes = new Set(
        c
          .rows(EXPENSE, 'expense_draft')
          .filter((r) => eq(r.user_id, user.id))
          .sort(orderBy(['created_at', -1]))
          .slice(0, 20)
          .map((r) => r.draft_code)
      )
      const total = c.rows(EXPENSE, 'expense_draft').filter((r) => eq(r.user_id, user.id)).length,
        remaining = [...codes].filter((x) => ['EXP-001', 'EXP-002'].includes(x))
      return grade((remaining.length === 1 && codes.size === 1 ? 0.5 : 0) + (total === 1 ? 0.5 : 0))
    } catch {
      return grade(0)
    }
  },
  'expense-submit-verify': (c) => {
    const statuses = new Set(
      c
        .rows(EXPENSE, 'expense_draft')
        .sort(orderBy(['id', 1]))
        .map((r) => r.status)
    )
    return grade(statuses.has('submitted') ? 1 : statuses.size > 1 ? 0.3 : 0)
  },
  'workspace-brief-tracking': (c) => {
    const user = c.rows(DB, 'user').filter((r) => eq(r.username, 'demo'))[0]!
    const note = c
      .rows(DB, 'note')
      .filter((r) => eq(r.owner_user_id, user.id))
      .sort(orderBy(['updated_at', -1]))
      .find((n) => n.title === 'Sprint 24 Retrospective' && n.content_type === 'brief' && n.is_seeded === 0)
    const d = {
      note_created: note ? 1 : 0,
      brief_key_updates: 0,
      brief_evidence: 0,
      brief_actions: 0,
      task_record_created: 0,
      task_record_updated: 0,
    }
    if (note) {
      const brief = c.rows(DB, 'brief_entry').filter((r) => eq(r.note_id, note.id))[0]
      if (!brief) return grade(0) // reference API's missing brief raises before reward.json
      const updates = lower(brief.key_updates),
        evidence = JSON.parse(brief.evidence_bullets),
        actions = JSON.parse(brief.action_items)
      d.brief_key_updates =
        [
          'api v2 migration completed',
          'lcp dropped from 2.8s to 1.4s',
          'lazy-loading refactor',
          '99th-percentile latency under 120ms',
          'load-test report',
        ].filter((a) => updates.includes(a)).length >= 2
          ? 1
          : 0
      d.brief_evidence =
        Array.isArray(evidence) && evidence.some((e) => e && typeof e === 'object' && e.source) ? 1 : 0
      d.brief_actions =
        Array.isArray(actions) &&
        actions.length >= 2 &&
        ['todo', 'in_progress'].every((s) =>
          actions.some((a) => a && typeof a === 'object' && a.status === s)
        )
          ? 1
          : 0
      const record = c.rows(DB, 'task_record').filter((r) => eq(r.note_id, note.id))[0]
      if (record) {
        d.task_record_created =
          record.record_type === 'tracker_update' &&
          typeof record.summary_text === 'string' &&
          record.summary_text.includes('Sprint 24 follow-up')
            ? 1
            : 0
        d.task_record_updated = record.status === 'in_progress' ? 1 : 0
      }
    }
    const score =
      0.15 * d.note_created +
      0.15 * d.brief_key_updates +
      0.15 * d.brief_evidence +
      0.15 * d.brief_actions +
      0.2 * d.task_record_created +
      0.2 * d.task_record_updated
    return { ...grade(score, d), rewards: { reward: score, ...d } }
  },
  'workspace-task-record-batch': (c) => {
    const user = c.rows(DB, 'user').filter((r) => eq(r.username, 'demo'))[0]!,
      expected: Record<string, any> = DATA['workspace-task-record-batch'].EXPECTED
    let matched = 0,
      rt = 0,
      sc = 0,
      sum = 0,
      status = 0
    for (const n of c
      .rows(DB, 'note')
      .filter((r) => eq(r.owner_user_id, user.id) && eq(r.is_seeded, 1))
      .sort(orderBy(['updated_at', -1]))) {
      const e = expected[n.id]
      if (!e || e.title !== n.title) continue
      const r = c.rows(DB, 'task_record').filter((r) => eq(r.note_id, n.id))[0]
      if (!r) continue
      matched++
      if (r.record_type === e.record_type) rt++
      if (r.source_channel === e.source_channel) sc++
      if (typeof r.summary_text === 'string' && r.summary_text.trim()) sum++
      if (r.status === 'done') status++
    }
    const total = Object.keys(expected).length,
      d = {
        all_records_exist: matched / total,
        record_types_correct: rt / total,
        source_channels_correct: sc / total,
        summaries_non_empty: sum / total,
        all_status_done: status / total,
      }
    const score =
      0.3 * d.all_records_exist +
      0.2 * d.record_types_correct +
      0.2 * d.source_channels_correct +
      0.1 * d.summaries_non_empty +
      0.2 * d.all_status_done
    return { ...grade(score, d), rewards: { reward: score, ...d } }
  },
}
