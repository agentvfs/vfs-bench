/**
 * LiveClawBench (Mosi-AI/LiveClawBench @ 303dc77, MIT): assistant tasks over
 * mock web apps (email, finance, shop, airline, ...), graded by each task's
 * own verifier on the apps' end state.
 *
 * A task's mocks run unchanged under Bun (`mock/serve.ts`), each with its
 * database in the run and seeded for the task by `TASK_NAME`, as upstream's
 * task images run them. Upstream's agent drives the apps in a browser;
 * here each mock's OpenAPI document becomes a CLI named for the mock
 * (`email`, `finance`), and the instruction names those CLIs where it gave
 * the apps' URLs (`task.json` `rewrite`). The task's `tests/verify.py`
 * grades unchanged against the same databases, and a task passes at
 * score 1.0. Setup: `python3 -I liveclawbench/setup.py`.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type OpenApi, openapiCli } from '../clis/openapi.ts'
import { type FakeSpec, type Tables, sqliteTables } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import type { Run } from '../harness/runs.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(STATE, 'liveclawbench', 'src')
const PLATFORM = join(SRC, 'mock-platform')

/**
 * Where each mock keeps its data, as upstream's task images set it
 * (`scripts/build-task-images.ts`, the tasks' Dockerfiles): the environment
 * it reads, and the SQLite file the verifiers read.
 */
const DATA: Record<string, (dir: string) => { env: Record<string, string>; db: string }> = {
  email: (dir) => ({ env: { EMAIL_DB_PATH: join(dir, 'email.db') }, db: join(dir, 'email.db') }),
  finance: (dir) => ({
    env: { MOCK_FINANCE_DB_PATH: join(dir, 'finance_app.sqlite') },
    db: join(dir, 'finance_app.sqlite'),
  }),
}

/** What the CLI for each mock says it is. */
const ABOUT: Record<string, string> = {
  email: 'The company email system: inbox, sent mail, drafts and compose.',
  finance: 'The finance system: departments, transactions, accounts, expenses, vendors, invoices and assets.',
}

interface Spec {
  task: string
  mocks: string[]
  /** Each app URL in the instruction, and the CLI it becomes. */
  rewrite: Record<string, string>
}

/** The instruction with each app URL replaced, each exactly once. */
function rewritten(text: string, rewrite: Record<string, string>): string {
  for (const [from, to] of Object.entries(rewrite)) {
    const count = text.split(from).length - 1
    if (count !== 1) throw new Error(`'${from}' appears ${count} times in the instruction`)
    text = text.replace(from, to)
  }
  return text
}

/**
 * A mock's tables without its password hashes, which upstream salts afresh
 * on every seed; no verifier reads them.
 */
function withoutSecrets(tables: Tables): Tables {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map(({ password_hash: _, ...row }) => row)]),
  )
}

/** A mock's fake: `FINANCE`, `DOC_SEARCH`. */
const fakeName = (mock: string) => mock.toUpperCase().replace(/-/g, '_')

function data(run: Run, mock: string) {
  const dir = run.path('mock-data', mock)
  return DATA[mock]!(dir)
}

/** The mocks' environment, which their verifiers read too. */
function environment(run: Run, spec: Spec): Record<string, string> {
  return Object.assign({}, ...spec.mocks.map((m) => data(run, m).env))
}

function fake(run: Run, spec: Spec, mock: string): FakeSpec {
  const extra = run.path('mock-data', 'extra-seed')
  mkdirSync(extra, { recursive: true })
  return {
    name: fakeName(mock),
    argv: ['bun', join(HERE, 'mock', 'serve.ts'), '--mocks', join(PLATFORM, 'mocks'), '--mock', mock, '--name', fakeName(mock)],
    cwd: PLATFORM,
    env: {
      ...data(run, mock).env,
      TASK_NAME: spec.task,
      // Upstream reads extra seed SQL from /opt/mock/extra-seed; a task that has none gets an empty one.
      MOCK_EXTRA_SEED_DIR: extra,
    },
  }
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const spec = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as Spec
  for (const mock of spec.mocks) if (DATA[mock] === undefined) throw new Error(`no data layout for mock '${mock}'`)
  const upstream = join(SRC, 'tasks', spec.task)
  const instruction = rewritten(readFileSync(join(upstream, 'instruction.md'), 'utf8'), spec.rewrite)
  return {
    slug,
    dir,
    instruction,
    fakes: (run) => spec.mocks.map((mock) => fake(run, spec, mock)),
    // Each mock seeds itself for the task when it starts.
    seed: async () => null,
    async clis(run) {
      return Promise.all(
        spec.mocks.map(async (mock) => {
          const url = run.fakes.get(fakeName(mock))!.url
          const doc = (await (await fetch(`${url}/__vfsbench__/openapi.json`)).json()) as OpenApi
          const cli = openapiCli(mock, doc, ABOUT[mock] ?? `The ${mock} app.`, (path) => path.startsWith('/api/'))
          return { name: mock, cli, config: { url } }
        }),
      )
    },
    async snapshot(run) {
      const out: Record<string, unknown> = {}
      for (const mock of spec.mocks) out[mock] = withoutSecrets(await sqliteTables(data(run, mock).db))
      return out
    },
    // The mocks stamp their seed rows from the wall clock (SQLite's
    // CURRENT_TIMESTAMP, `new Date()`), as upstream's do.
    clockFields: ['created_at', 'updated_at'],
    async grade({ run }) {
      const result = (await runPython(HERE, join(HERE, 'grade.py'), {
        verify: join(upstream, 'tests', 'verify.py'),
        env: environment(run, spec),
      })) as { score: number; results: { passed: boolean; message: string }[]; output: string }
      return graded([
        ...result.results.map((r, i) => ({ name: `verify.py #${i + 1}`, passed: r.passed, detail: r.message })),
        { name: 'score == 1.0', passed: result.score === 1, detail: `${result.score}\n${result.output}` },
      ])
    },
  }
}
