import { type Grader, eq, orderBy, grade } from '../../../workspace/grader.ts'
import DATA from '../graders/reference-data.json' with { type: 'json' }
import { DB } from '../graders/workspace.ts'
export const grader: Grader = (c) => {
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
  }
