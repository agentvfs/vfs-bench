import { type Grader, eq, orderBy, grade, lower } from '../../../workspace/grader.ts'
import { DB } from '../graders/workspace.ts'
export const grader: Grader = (c) => {
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
  }
