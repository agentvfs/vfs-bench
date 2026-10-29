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
 * grades against the same files, read at this run's paths where it names
 * upstream's fixed ones (`grade.py`), and a task passes at score 1.0.
 * Setup: `python3 -I liveclawbench/setup.py`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type OpenApi, openapiCli } from '../clis/openapi.ts'
import { type FakeSpec, type Tables, sqliteTables } from '../harness/fakes.ts'
import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import type { Run } from '../harness/runs.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SRC = join(STATE, 'liveclawbench', 'src')
export const PLATFORM = join(SRC, 'mock-platform')

/**
 * Where each mock keeps its data, as upstream's task images set it
 * (`scripts/build-task-images.ts`, the tasks' Dockerfiles and
 * `task-binary-map.json`): the environment it reads, and its state files,
 * a SQLite or a JSON file each, keyed by the path upstream's verifiers read
 * them at.
 */
export const DATA: Record<string, (dir: string) => { env: Record<string, string>; files: Record<string, string> }> = {
  chat: (dir) => ({
    env: {
      CHAT_DB_PATH: join(dir, 'chat.sqlite'),
      CHAT_STICKER_DIR: join(dir, 'stickers'),
      // The image copies the store's sticker art to /opt/mock/static/store.
      CHAT_STORE_ASSETS_DIR: join(PLATFORM, 'mocks', 'chat', 'static', 'store'),
    },
    files: { '/opt/mock/data/chat/chat.sqlite': join(dir, 'chat.sqlite') },
  }),
  email: (dir) => ({
    env: { EMAIL_DB_PATH: join(dir, 'email.db') },
    files: { '/var/lib/mock-data/email/email.db': join(dir, 'email.db') },
  }),
  finance: (dir) => ({
    env: { MOCK_FINANCE_DB_PATH: join(dir, 'finance_app.sqlite') },
    files: { '/opt/mock/data/finance_app.sqlite': join(dir, 'finance_app.sqlite') },
  }),
  'mint-diet': (dir) => ({
    env: { MOCK_DATA_DIR: dir },
    files: { '/var/lib/mock-data/mint-diet/mint-diet.sqlite': join(dir, 'mint-diet.sqlite') },
  }),
  // Upstream's image links /tmp/mosi_shop_*.json to the shop's data files.
  shop: (dir) => ({
    env: { MOCK_DATA_DIR: dir, MOCK_PRODUCTS_PATH: join(PLATFORM, 'static', 'shop', 'sample_products.json') },
    files: Object.fromEntries(
      ['orders', 'cart', 'user'].map((name) => [`/tmp/mosi_shop_${name}.json`, join(dir, `mosi_shop_${name}.json`)]),
    ),
  }),
  // The image starts the weather mock with no environment, so it keeps its
  // database at its default, /tmp/weather.db.
  weather: (dir) => ({
    env: { WEATHER_DB_PATH: join(dir, 'weather.db') },
    files: { '/tmp/weather.db': join(dir, 'weather.db') },
  }),
}

/** What the CLI for each mock says it is. */
const ABOUT: Record<string, string> = {
  chat: 'The chat app: channels and messages, the sticker store and your stickers.',
  email: 'The company email system: inbox, sent mail, drafts and compose.',
  finance: 'The finance system: departments, transactions, accounts, expenses, vendors, invoices and assets.',
  'mint-diet': 'Mint Diet: the food catalog, your daily food log and meal plans.',
  shop: 'The Mosi Shop: products, your cart, checkout, orders and profile.',
}

export interface Spec {
  task: string
  mocks: string[]
  /** Each app URL in the instruction, and the CLI it becomes. */
  rewrite: Record<string, string>
  /**
   * The Dockerfile's `ENV` lines the mocks read, each a file under
   * upstream's task directory (its `/workspace/environment/` in the image).
   */
  env?: Record<string, string>
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
 * Columns upstream draws afresh on every seed, and no verifier reads: the
 * mocks' salted password hashes, and the chat mock's sticker files, each
 * named by a random UUID.
 */
const RANDOM = ['password_hash', 'storage_path']

/** A mock's tables without its `RANDOM` columns. */
function withoutRandom(tables: Tables): Tables {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [
      name,
      rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !RANDOM.includes(k)))),
    ]),
  )
}

/** A mock's fake: `FINANCE`, `DOC_SEARCH`. */
export const fakeName = (mock: string) => mock.toUpperCase().replace(/-/g, '_')

function data(run: Run, mock: string) {
  const dir = run.path('mock-data', mock)
  return DATA[mock]!(dir)
}

/** The task's own environment, as its Dockerfile sets it. */
function taskEnv(spec: Spec): Record<string, string> {
  return Object.fromEntries(Object.entries(spec.env ?? {}).map(([k, v]) => [k, join(SRC, 'tasks', spec.task, v)]))
}

/** The mocks' environment and the task's, which their verifiers read too. */
function environment(run: Run, spec: Spec): Record<string, string> {
  return Object.assign({}, ...spec.mocks.map((m) => data(run, m).env), taskEnv(spec))
}

/** Each mock's state files, by the paths upstream's verifiers read them at. */
function files(run: Run, spec: Spec): Record<string, string> {
  return Object.assign({}, ...spec.mocks.map((m) => data(run, m).files))
}

/**
 * A mock's state, by file name: a SQLite file's tables, or a JSON file's
 * value. A file the mock has yet to write, such as an empty cart, is left
 * out.
 */
async function state(files: Record<string, string>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const file of Object.values(files)) {
    if (!existsSync(file)) continue
    out[basename(file)] = file.endsWith('.json')
      ? JSON.parse(readFileSync(file, 'utf8'))
      : withoutRandom(await sqliteTables(file))
  }
  return out
}

/** A mock's fake, run as upstream's task image runs it. */
export function fake(run: Run, spec: Spec, mock: string): FakeSpec {
  const extra = run.path('mock-data', 'extra-seed')
  mkdirSync(extra, { recursive: true })
  return {
    name: fakeName(mock),
    argv: ['bun', join(HERE, 'mock', 'serve.ts'), '--mocks', join(PLATFORM, 'mocks'), '--mock', mock, '--name', fakeName(mock)],
    cwd: PLATFORM,
    env: {
      ...data(run, mock).env,
      ...taskEnv(spec),
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
      for (const mock of spec.mocks) out[mock] = await state(data(run, mock).files)
      return out
    },
    // The mocks stamp their seed rows from the wall clock (SQLite's
    // CURRENT_TIMESTAMP, `new Date()`), as upstream's do: the chat its seed
    // messages' `sent_at`, the shop its seed orders' `create_time`.
    clockFields: ['created_at', 'updated_at', 'sent_at', 'create_time'],
    async grade({ run }) {
      const result = (await runPython(HERE, join(HERE, 'grade.py'), {
        verify: join(upstream, 'tests', 'verify.py'),
        env: environment(run, spec),
        paths: files(run, spec),
      })) as { score: number; results: { passed: boolean; message: string }[]; output: string }
      return graded([
        ...result.results.map((r, i) => ({ name: `verify.py #${i + 1}`, passed: r.passed, detail: r.message })),
        { name: 'score == 1.0', passed: result.score === 1, detail: `${result.score}\n${result.output}` },
      ])
    },
  }
}
