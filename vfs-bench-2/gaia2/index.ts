/**
 * Gaia2 (meta-agents-research-environments/gaia2, CC BY 4.0; code MIT):
 * an assistant over a phone's apps (contacts, emails, messages, chats,
 * calendar, cloud drive, cabs, shopping, ...).
 *
 * The apps are Meta's own CLI port, gaia2-cli (ARE @ a9fd2ed), run
 * unchanged behind the bridge (`world.py`): each app is a CLI of the same
 * name and commands (`chats list-recent-conversations --offset 0`), its
 * state seeded by upstream's `gaia2-init` from the scenario. The Files
 * app's drive is also mounted at `/cloud-drive`. The system prompt is
 * gaia2-cli's own (`AGENTS_TEMPLATE.md`, rendered by `prompt.py`) with the
 * edits in `EDITS`; the instruction is the scenario's message to the agent.
 *
 * Search scenarios end in one answer, which the agent hands in with
 * `complete-task --answer`; it must equal the oracle's
 * `send_message_to_user` content after normalizing case, spaces and a
 * trailing full stop, where Gaia2 asks an LLM judge.
 *
 * The clock is frozen at the scenario's start, as upstream's libfaketime
 * freezes its container's: for the apps (`launch.py`), for python3
 * (`clock.py`, run before each command) and for the shell's `date`, a
 * function over `date -d @<start>`. Setup:
 * `uv run --project gaia2 python -I gaia2/setup.py`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COMPLETE_TASK } from '../clis/answer.ts'
import { serverClis } from '../clis/tools.ts'
import { bridge } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(STATE, 'gaia2')
const FAKE = 'GAIA2'

interface Scenario {
  metadata: { definition: { start_time: number } }
  events: { action: { app: string; function: string; args: { name: string; value: unknown }[] } }[]
}

/**
 * Where this harness differs from upstream's container, each edit applied
 * to exactly one place in the rendered prompt.
 */
const EDITS: [string, string][] = [
  [
    'Your workspace is `/home/agent`. You may create and edit files here.',
    'Your workspace is `/workspace`. You may create and edit files here. The `cloud-drive` app\'s files are also mounted at `/cloud-drive`.',
  ],
  ['Work only within `/home/agent`.', 'Work only within `/workspace` and `/cloud-drive`.'],
  [
    'provide your final answer by responding directly.',
    'hand in your final answer with `complete-task --answer \'<answer>\'`: the answer alone, in the form the task asks for.',
  ],
  ['respond directly with the answer.', 'hand in the answer with `complete-task`.'],
]

/** Upstream's prompt with `EDITS` applied and its notifications section, which this harness does not deliver, cut. */
function edited(prompt: string): string {
  for (const [from, to] of EDITS) {
    const count = prompt.split(from).length - 1
    if (count !== 1) throw new Error(`'${from}' appears ${count} times in the Gaia2 prompt`)
    prompt = prompt.replace(from, to)
  }
  const cut = prompt.indexOf('\n## Notifications')
  return (cut < 0 ? prompt : prompt.slice(0, cut)).trimEnd()
}

/** Case, spacing and a trailing full stop aside, as a number when both are numbers. */
function normal(text: string): string {
  const out = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '')
  const number = Number(out.replace(/,/g, ''))
  return out !== '' && Number.isFinite(number) ? String(number) : out
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const { split, id } = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { split: string; id: string }
  const path = join(DATA, 'scenarios', split, `${id}.json`)
  const scenario = JSON.parse(readFileSync(path, 'utf8')) as Scenario
  const content = (fn: string) =>
    scenario.events.filter((e) => e.action.function === fn).map((e) => String(e.action.args.find((a) => a.name === 'content')?.value))
  const [instruction] = content('send_message_to_agent')
  const expected = content('send_message_to_user')
  if (instruction === undefined || expected.length !== 1) throw new Error(`${id}: expected one task and one answer`)
  const start = scenario.metadata.definition.start_time
  const prompt = edited(
    (await runPython(HERE, join(HERE, 'prompt.py'), {
      scenario: path,
      template: join(DATA, 'AGENTS_TEMPLATE.md'),
      exec_tool: 'shell',
    })) as string,
  )
  return {
    slug,
    dir,
    instruction,
    instructions: (skills) => `${prompt}\n\n${skills}`,
    fakes: (run) => [bridge(FAKE, HERE, 'world:Gaia2', { state: run.path('gaia2'), filesystem: join(DATA, 'filesystem') })],
    async seed(run) {
      await run.fakes.get(FAKE)!.reset({ fixture: path })
      run.env.GAIA2_FILES = join(run.dir, 'gaia2', 'filesystem')
      run.env.GAIA2_CLOCK = `${readFileSync(join(HERE, 'clock.py'), 'utf8')}\nfreeze(${start})\ndel freeze\n`
      return null
    },
    async clis(run) {
      return [
        ...(await serverClis(run.fakes.get(FAKE)!.url)),
        { name: 'complete-task', cli: COMPLETE_TASK, config: { path: run.answerPath } },
      ]
    },
    shellInit: () => [`date() { command date -d @${Math.floor(start)} "$@"; }`],
    snapshot: async (run) => run.fakes.get(FAKE)!.get('/snapshot'),
    async grade({ answer }) {
      const given = (answer as { answer?: string | null } | null)?.answer ?? null
      return graded([
        { name: 'an answer was handed in', passed: given !== null, detail: String(given) },
        {
          name: 'answer matches the oracle (normalized exact match)',
          passed: given !== null && normal(given) === normal(expected[0]!),
          detail: `given ${JSON.stringify(given)}, expected ${JSON.stringify(expected[0])}`,
        },
      ])
    },
  }
}
