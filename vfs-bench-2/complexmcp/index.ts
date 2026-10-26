/**
 * ComplexMCP (ATH-MaaS/complex-mcp, MIT): 47 tasks over 15 MCP servers.
 *
 * Upstream's servers run unchanged behind the bridge (`world.py`); each
 * server is a CLI, `<server> <tool> --param value`, generated from the
 * tools it lists. A task starts from its seed's login, and upstream's own
 * judge compares the end environment with the expected one. Setup:
 * `uv run --project complexmcp python -I complexmcp/setup.py`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverClis } from '../clis/tools.ts'
import { bridge } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(STATE, 'complexmcp', 'src')
const FAKE = 'COMPLEXMCP'

interface Upstream {
  index: number
  seed: number
  query: string
  apps: string[]
  gt_env: unknown
}

interface Env {
  initial: unknown
  final: unknown
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const { index } = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { index: number }
  const tasks = JSON.parse(readFileSync(join(STATE, 'complexmcp', 'tasks.json'), 'utf8')) as Upstream[]
  const upstream = tasks[index]!
  let snapshots = 0
  return {
    slug,
    dir,
    instruction: upstream.query,
    fakes: () => [bridge(FAKE, HERE, 'world:ComplexMCP', { src: SRC })],
    async seed(run) {
      await run.fakes.get(FAKE)!.reset({ fixture: { seed: upstream.seed, apps: upstream.apps } })
      return null
    },
    clis: async (run) => serverClis(run.fakes.get(FAKE)!.url),
    async snapshot(run) {
      const fake = run.fakes.get(FAKE)!
      // The end state is what logout returns, so the second snapshot (after
      // the agent) logs out; the first reads the logins' starting state.
      if (snapshots++ > 0) await fake.post('/call', { tool: '__finish__', arguments: {} })
      return fake.get('/snapshot')
    },
    async grade({ after }) {
      const env = after as Env
      const judged = (await runPython(HERE, join(HERE, 'grade.py'), {
        src: SRC,
        initial: env.initial,
        final: env.final,
        gt_env: upstream.gt_env,
      })) as { total: number; recall: number; misbehave: number; log: string }
      return graded([
        {
          name: 'every expected change made (recall == total)',
          passed: judged.recall === judged.total,
          detail: `recall ${judged.recall}/${judged.total}\n${judged.log}`,
        },
        {
          name: 'nothing else changed (misbehave == 0)',
          passed: judged.misbehave === 0,
          detail: `misbehave ${judged.misbehave}\n${judged.log}`,
        },
      ])
    },
  }
}
