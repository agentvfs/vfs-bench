/**
 * AutomationBench (zapier/AutomationBench v1.0.6, MIT): business workflows
 * across 47 simulated SaaS apps, graded on the end state.
 *
 * Upstream's world, tools and rubric run unchanged behind the bridge
 * (`world.py`). Its default toolset, `api` (`api_search`, `api_fetch`,
 * `base64_encode`), is the CLI `api search`, `api fetch` and
 * `api base64-encode`. The task's system prompt is upstream's, ahead of the
 * CLI docs; its user message is the instruction. Upstream's
 * `partial_credit` grades the end world, and a task passes at 1.0 as
 * `task_completed_correctly` counts it. Setup:
 * `uv run --project automationbench python -I automationbench/setup.py`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Tool, toolsCli } from '../clis/tools.ts'
import { bridge } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = 'AUTOMATIONBENCH'

interface Row {
  prompt: { role: string; content: string }[]
}

interface Result {
  partial_credit: number
  assertions: { type: string; passed: boolean; excluded: boolean; params: unknown }[]
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const { task_name: name } = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { task_name: string }
  const exported = join(STATE, 'automationbench', 'tasks', `${name}.json`)
  const row = JSON.parse(readFileSync(exported, 'utf8')) as Row
  const message = (role: string) => row.prompt.filter((m) => m.role === role).map((m) => m.content).join('\n\n')
  return {
    slug,
    dir,
    instruction: message('user'),
    instructions: (skills) => `${message('system')}\n\n${skills}`,
    fakes: () => [bridge(FAKE, HERE, 'world:AutomationBench')],
    async seed(run) {
      await run.fakes.get(FAKE)!.reset({ fixture: exported })
      return null
    },
    async clis(run) {
      const url = run.fakes.get(FAKE)!.url
      const tools = (await (await fetch(`${url}/tools`)).json()) as Tool[]
      // api_search is `api search`; base64_encode, also in API_TOOLS, `api base64-encode`.
      const mirrored = tools.map((t) => ({ ...t, name: t.name.replace(/^api_/, ''), call: t.name }))
      return [{ name: 'api', cli: toolsCli('api', mirrored, "AutomationBench's API tools."), config: { url } }]
    },
    snapshot: async (run) => run.fakes.get(FAKE)!.get('/snapshot'),
    // Upstream's records stamp what a task leaves unset from the wall clock
    // (`datetime.now()` defaults), as do the world's `meta.current_time` and
    // Gmail's `date` and `internal_date`, in epoch milliseconds. These are
    // all the fields any of its tasks stamps when seeded.
    clockFields: [
      'created_at',
      'created_date',
      'created_time',
      'current_time',
      'date',
      'date_created',
      'date_modified',
      'internal_date',
      'last_modified_date',
      'last_modified_date_time',
      'last_updated_time',
      'modified_at',
      'registered_at',
      'updated_at',
      'updated_date',
    ],
    async grade({ after }) {
      const result = (await runPython(HERE, join(HERE, 'grade.py'), {
        task: exported,
        world: (after as { world: unknown }).world,
      })) as Result
      const scored = result.assertions.filter((a) => !a.excluded)
      return graded([
        ...result.assertions.map((a) => ({
          name: `${a.excluded ? '(not scored) ' : ''}${a.type}`,
          passed: a.passed || a.excluded,
          detail: JSON.stringify(a.params),
        })),
        {
          name: 'partial_credit == 1.0 (task_completed_correctly)',
          passed: result.partial_credit === 1,
          detail: `${result.partial_credit} over ${scored.length} scored assertions`,
        },
      ])
    },
  }
}
