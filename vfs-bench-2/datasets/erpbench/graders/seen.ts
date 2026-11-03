/**
 * Which mount reads the agent saw. A read through a mount (`/gmail`,
 * `/drive`, `/sheets`, `/slack`) reaches the fake as the service's REST API,
 * which records it under upstream's read tool and keeps, beside the trace
 * entry, the host time it arrived and its witness: text the read served
 * (mocks/erpbench/routes.ts). A mount fetches more than the agent asks for
 * (a listing reads every message, `grep -r` every file), so an entry stays
 * in the trace only if the trajectory step that issued it shows its witness
 * in a tool result, as ClawEval's grader counts an email as read
 * (datasets/claweval/graders/trace.ts). The step is the agent step with the
 * latest timestamp at or before the read, so a read keeps its place among
 * the CLI calls. A CLI call is kept as upstream keeps it.
 */
type Entry = Record<string, any>

/** `{all}`: every fragment shown; `{any}`: one; `{}`: nothing to show. */
export interface Witness {
  all?: string[]
  any?: string[]
}

/** A mount-recorded trace entry: its index, the host time it arrived, its witness. */
export interface Seen {
  idx: number
  at_ms: number
  witness: Witness
}

/**
 * Text as an agent may print it, compared: JSON's `\uXXXX` read at any
 * escaping depth, then `\n`, `\r`, `\t`, every other backslash and all
 * whitespace dropped, lowercased. convert.py's `flat` is the same.
 */
export function flat(text: string): string {
  return text
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\+[nrt]/g, '')
    .replace(/\\/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** An ATIF message or result as text: a string, or its text parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '')).join('\n')
}

/** An ATIF timestamp in ms; one without a zone is UTC, as Harbor writes them. */
function msOf(timestamp: unknown): number {
  if (typeof timestamp !== 'string') return NaN
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(timestamp) ? timestamp : `${timestamp}Z`)
}

/**
 * Each agent step with a timestamp: its time in host ms and its tool
 * results, flattened. A step without one ran after the step before it, so
 * its results count with that step's.
 */
function steps(trajectory: unknown, shiftMs: number): { at: number; shown: string }[] {
  if (!trajectory || typeof trajectory !== 'object') return []
  const { steps, agent } = trajectory as { steps?: unknown; agent?: { name?: unknown } }
  if (!Array.isArray(steps)) return []
  // An oracle writes its trajectory inside the workspace, on the trial's clock.
  const shift = agent?.name === 'oracle' ? shiftMs : 0
  const timeline: { at: number; shown: string }[] = []
  for (const step of steps) {
    if (!step || typeof step !== 'object' || step.source !== 'agent') continue
    const results: unknown[] = Array.isArray(step.observation?.results) ? step.observation.results : []
    const shown = flat(results.map((r: any) => textOf(r?.content)).join('\n'))
    const at = msOf(step.timestamp)
    if (Number.isFinite(at)) timeline.push({ at: at - shift, shown })
    else if (timeline.length) timeline[timeline.length - 1]!.shown += shown
  }
  return timeline
}

/** Whether flattened output shows a witness. */
export function shows(shown: string, witness: Witness): boolean {
  const all = (witness.all ?? []).every((f) => shown.includes(flat(f)))
  return all && (witness.any === undefined || witness.any.some((f) => shown.includes(flat(f))))
}

/**
 * The trace without the mount reads the agent did not see. Mount reads with
 * no timestamped agent step to check them against fail the grade: a missing
 * or broken trajectory is the harness's failure, not the agent's.
 *
 * Args:
 *   trace (Entry[]): the fake's trace, upstream's entries.
 *   seen (Seen[]): the mount-recorded entries' times and witnesses.
 *   trajectory (unknown): the agent's ATIF trajectory, or null.
 *   shiftMs (number): the trial clock minus host time, for an oracle's trajectory.
 */
export function seenTrace(trace: Entry[], seen: Seen[], trajectory: unknown, shiftMs: number): Entry[] {
  const timeline = steps(trajectory, shiftMs)
  if (seen.length && !timeline.length) throw new Error(`${seen.length} mount reads were recorded, but the trajectory has no timestamped agent step`)
  const byIndex = new Map(seen.map((s) => [s.idx, s]))
  return trace.filter((entry) => {
    const read = byIndex.get(Number(entry.index))
    if (read === undefined) return true
    let step: { at: number; shown: string } | undefined
    for (const s of timeline) if (s.at <= read.at_ms && (step === undefined || s.at > step.at)) step = s
    return step !== undefined && shows(step.shown, read.witness)
  })
}
