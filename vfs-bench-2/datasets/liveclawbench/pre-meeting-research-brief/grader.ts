import { PyFloat } from '../../../workspace/py.ts'
import { type Context, type Grade, compare } from '../../../workspace/grader.ts'
import { anchorScores, briefGrade, listOf, structurallyValid } from '../graders/brief.ts'
import { str } from '../graders/pkb.ts'

// Upstream's tests/llm_judge.py, its judge's instructions verbatim.
const SYSTEM_PROMPT = "You are a strict evaluator for a research brief benchmark case. Be critical — most work has significant gaps.\n\nScore only the semantic quality of the agent's research brief. Do not reward length, formatting, or generic statements.\nEvery claim in the brief must be traceable to a specific corpus source. Generic business advice or ungrounded assertions should receive low scores.\n\nReturn JSON only with this shape:\n{\n  \"grounding_quality\": 0.0,\n  \"synthesis_quality\": 0.0,\n  \"meeting_summary_accuracy\": 0.0,\n  \"rationales\": {\n    \"grounding_quality\": \"...\",\n    \"synthesis_quality\": \"...\",\n    \"meeting_summary_accuracy\": \"...\"\n  }\n}\n\nScoring rules — be strict, 1.0 is rare:\n- Use a 0.0 to 1.0 scale in 0.25 increments.\n\n- `grounding_quality`: Are the discussion points, risks, and opportunities each traceable to specific information from the corpus? Each item should cite or clearly reference a concrete detail (company fact, market figure, legal requirement, competitive dynamic) from the provided materials.\n  - 1.0: Every discussion point and risk/opportunity maps to a specific corpus fact. No generic filler (\"AI is important\", \"consider regulations\").\n  - 0.75: Most items are grounded but 1–2 are vague or not traceable to provided materials.\n  - 0.5: Half the items are grounded; the other half are generic advice.\n  - 0.25: Mostly generic business platitudes with minimal corpus linkage.\n  - 0.0: No meaningful grounding in provided materials.\n\n- `synthesis_quality`: Do the suggested questions and overall brief demonstrate synthesis across multiple corpus sources? High-quality briefs connect facts from different documents (e.g., linking the legal concern to the product capability to a competitive implication). Low-quality briefs list facts without integration.\n  - 1.0: Questions are sharp, specific, and derived from cross-source synthesis. Brief demonstrates clear reasoning chains.\n  - 0.75: Most questions are specific; 1–2 are generic. Some cross-source connections.\n  - 0.5: Questions are adequate but could be asked without reading the corpus.\n  - 0.25: Questions are generic (\"What are your goals?\", \"How do you handle security?\").\n  - 0.0: No meaningful synthesis evident.\n\n- `meeting_summary_accuracy`: Does meeting_summary correctly identify the counterpart and key meeting details from the calendar entry provided? It must name the counterpart (Alex Morgan / NovaTech AI), reference the correct date (either as \"Friday\" or the ISO date shown in the calendar entry), and ideally include time (14:00) and location (Conference Room A). Do not reward fabricated or generic summaries not grounded in the calendar entry.\n  - 1.0: Counterpart name/company, correct date (weekday or ISO), and at least one of time or location correctly stated.\n  - 0.75: Counterpart identified and date correct; time or location omitted but no fabrication.\n  - 0.5: Counterpart identified but date or another key detail is wrong or fabricated.\n  - 0.25: Meeting referenced but counterpart wrong or significantly fabricated.\n  - 0.0: Completely fabricated, generic, or no reference to the seeded meeting details.\n"

export const TODOLIST = '/var/lib/mock-data/todolist/todolist.db'
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** `datetime.date.fromisoformat(s).strftime("%A")`, or null where it is no date. */
function weekday(value: unknown): string | null {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (y < 1 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return WEEKDAYS[(date.getUTCDay() + 6) % 7]!
}

/**
 * `fetch_calendar_context`: the partnership meeting, the first todo naming
 * it, as upstream's todolist lists them (`ORDER BY date, time,
 * created_at`), here from the run's SQLite.
 */
function calendarContext(c: Context): string {
  const todos = c
    .rows(TODOLIST, 'todos')
    .sort((a, b) => compare(a.date, b.date) || compare(a.time, b.time) || compare(a.created_at, b.created_at))
  for (const todo of todos) {
    const title = String(todo.title ?? '').toLowerCase(),
      description = String(todo.description ?? '').toLowerCase()
    if (!(title.includes('partnership') || title.includes('novatech') || description.includes('partnership'))) continue
    // `todo.get(name, '')`: a NULL column is None, which prints as such.
    const field = (name: string) => (name in todo ? todo[name] : '')
    const date = field('date')
    const day = weekday(date)
    return [
      `Title: ${str(field('title'))}`,
      `Date: ${day === null ? str(date) : `${date} (${day})`}`,
      `Time: ${str(field('time'))}`,
      `Location: ${str(field('location'))}`,
      `Person: ${str(field('person'))}`,
      `Description: ${str(field('description'))}`,
    ].join('\n')
  }
  throw new Error('Partnership meeting not found in calendar — cannot judge meeting_summary accuracy')
}

/** Upstream's llm_judge.py: its deterministic_checks.py's three scores, the judge's three. */
export function grader(c: Context): Promise<Grade> {
  return briefGrade(
    c,
    SYSTEM_PROMPT,
    (result, key) => ({
      structural_valid: structurallyValid(result, key),
      structure_completeness: new PyFloat(
        listOf(result, 'discussion_points', key.get('min_discussion_points') ?? 3) &&
          listOf(result, 'suggested_questions', key.get('min_questions') ?? 3) &&
          listOf(result, 'risks', key.get('min_risks') ?? 1) &&
          listOf(result, 'opportunities', key.get('min_opportunities') ?? 1)
          ? 1
          : 0
      ),
      ...anchorScores(result, key),
    }),
    ['# Calendar Entry Available to Agent', calendarContext(c)],
    ['meeting_summary_accuracy', 'grounding_quality', 'synthesis_quality']
  )
}
