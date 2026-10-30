/**
 * Check each kit fake that runs an upstream mock (mocks/upstream) against
 * upstream's mock itself: the same requests to each, on the same task's
 * seed and epoch, and every difference in status, content type, body, and
 * the tables and files each leaves behind.
 *
 *     node harbor/compare-upstream.ts [service ...]   # from vfs-bench-2/; default every such service
 *
 * Needs Bun and LiveClawBench's checkout (`liveclawbench/setup.py`). For each
 * committed task on the service, upstream's mock runs under Bun as its image
 * starts it (`fixtures/serve-upstream.ts`: its own code, on bun:sqlite and
 * its own files, the clock frozen at the epoch). The fake is one process for
 * every task (`fakes.ts`), each task a run reset from its committed fixture
 * at the same epoch: the same code, bundled, on node:sqlite and the run's
 * SQLite (`mocks/upstream/`).
 *
 * The requests are the service's flow (`FLOWS`): the reads and writes the
 * tasks' solutions make, and more of the same routes, error cases included.
 * A value one reply carries (an id, a token) is taken from each side's own
 * reply for the requests after it. Known and allowed: a time (the fake's
 * clock moves a second per write, upstream's here stays at the epoch), a
 * session token (each has its own secret), and an id upstream's mock draws
 * at random (smart home's grocery ids, a password's bcrypt salt, a booking's
 * reference and payment id at the airline); each is masked. The airline's
 * seed is run by the fake (`seedsRun`), and the tables it leaves are compared
 * whole, its 317,000 seats among them, after the requests. A list whose rows are the same but in another order, as rows
 * listed by time are, is printed (`ORDER`) and allowed. Anything else is
 * printed, and the check exits 1.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { MOCKS } from '../mocks/upstream/mocks.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLATFORM = join(HERE, '..', 'state', 'liveclawbench', 'src', 'mock-platform')
const TASKS = join(HERE, 'tasks', 'liveclawbench')

interface Step {
  name: string
  method?: string
  /** The path, each `{name}` in it a value taken from an earlier reply. */
  path: string
  body?: unknown
  /** Send the session: its token as a bearer, or its cookie. */
  auth?: boolean
  /** Keep a value of the reply's JSON, by its dotted path, under a name. */
  take?: Record<string, string>
  /** Keep the reply's token (`token` in its JSON) or cookie as the session. */
  login?: boolean
}

const get = (path: string, take?: Record<string, string>): Step => ({ name: `GET ${path}`, path, auth: true, ...(take ? { take } : {}) })
const send = (method: string, path: string, body?: unknown, take?: Record<string, string>): Step => ({
  name: `${method} ${path}`,
  method,
  path,
  auth: true,
  ...(body === undefined ? {} : { body }),
  ...(take ? { take } : {}),
})
const login = (path: string, body: unknown): Step => ({ name: `login ${path}`, method: 'POST', path, body, login: true })

/** Each service's requests, for every task on it. `{today}` is the epoch's date. */
const FLOWS: Record<string, Step[]> = {
  todolist: [
    get('/api/todos', { first: 'data.0.id' }),
    get('/api/todos?start_date={today}&end_date={today}'),
    get('/api/todos?start_date=2026-01-01&end_date=2026-12-31'),
    get('/api/todos/{first}'),
    send('POST', '/api/todos', { title: 'Compare', date: '{today}', time: '10:00', description: 'x' }, { made: 'data.id' }),
    send('POST', '/api/todos', { date: 'nope' }),
    send('PUT', '/api/todos/{made}', { title: 'Compared' }),
    send('DELETE', '/api/todos/{first}'),
    get('/api/todos/999999'),
    get('/api/todos'),
    get('/'),
  ],
  health: [
    get('/api/allergens', { first: 'data.0.id' }),
    send('POST', '/api/allergens', { name: 'Crab', severity: 'mild' }),
    send('POST', '/api/allergens', { name: 'Peanuts', severity: 'high' }),
    send('POST', '/api/allergens', { name: 'Peanuts', severity: 'severe' }),
    send('DELETE', '/api/allergens/{first}'),
    send('DELETE', '/api/allergens/999999'),
    get('/api/allergens'),
    get('/api/medications'),
    send('POST', '/api/medications', {
      name: 'Theraflu',
      frequency: 'daily',
      start_date: '{today}',
      slots: [{ time_hhmm: '09:00', dose_amount: 1, dose_unit: 'packet' }],
    }),
    send('POST', '/api/medications', { name: '' }),
    get('/api/medications'),
    get('/api/health/metrics/active_energy_kcal?start_date=2026-05-01&end_date={today}'),
    get('/'),
    get('/allergens'),
    get('/medications'),
  ],
  mintdiet: [
    get('/api/food-catalog/search?q=banana', { banana: 'data.0.id' }),
    get('/api/food-catalog/search?q=apple'),
    get('/api/log/{today}'),
    send('POST', '/api/log/{today}/entries', {
      slot: 'snacks',
      food_catalog_id: '{banana}',
      food_name: 'banana',
      quantity_value: 120,
      quantity_unit: 'g',
    }),
    send('POST', '/api/log/{today}/entries', { slot: 'nope' }),
    get('/api/log/{today}'),
    get('/'),
  ],
  expense: [
    login('/api/auth/token', { email: 'alice@mosi.inc', password: 'password123' }),
    login('/api/auth/token', { email: 'alice@mosi.inc', password: 'wrong' }),
    get('/api/drafts', { first: 'drafts.0.id' }),
    get('/api/drafts?status=draft', { draft: 'drafts.0.id' }),
    get('/api/drafts?sort=amount_desc&limit=3&page=2'),
    send('POST', '/api/drafts/{draft}/submit'),
    get('/api/drafts/{draft}'),
    send('POST', '/api/drafts/{draft}/submit'),
    get('/api/drafts/{draft}'),
    send('DELETE', '/api/drafts/{first}'),
    get('/api/drafts/999999'),
    get('/api/drafts'),
  ],
  insurance: [
    login('/api/auth/login', { email: 'peter.griffin@work.mosi.inc', password: 'password123' }),
    get('/api/plans', { plan: 'plans.1.id' }),
    send('POST', '/api/plans/{plan}/select'),
    send('POST', '/api/plans/999999/select'),
    send('POST', '/api/claims', {
      claim_type: 'reimbursement',
      total_amount: 25000,
      service_date: '2026-05-10',
      provider_name: 'Metro Lab Services',
      check_item: 'lab',
      notes: 'Annual blood work follow-up',
    }),
    send('POST', '/api/claims', { claim_type: 'nope' }),
    get('/api/claims'),
    get('/api/providers?check_item=lab', { provider: 'providers.0.id', service: 'providers.0.services.0.id' }),
    get('/api/providers/{provider}/services/{service}/slots', { slot: 'slots.0.id' }),
    send('POST', '/api/appointments', { slot_id: '{slot}' }),
    send('POST', '/api/appointments', { slot_id: '{slot}' }),
    get('/api/appointments'),
  ],
  smarthome: [
    get('/api/room-metrics'),
    get('/api/thermostat'),
    get('/api/coffee-schedule'),
    get('/api/inventory'),
    get('/api/calendar', { event: 'data.0.id' }),
    get('/api/grocery/products'),
    send('POST', '/api/thermostat', { mode: 'comfort', temperature: 74 }),
    send('POST', '/api/thermostat', { mode: 'nope' }),
    send('POST', '/api/coffee-schedule', { start_time: '06:30' }),
    send('POST', '/api/grocery/products', { name: 'Eggs', quantity: 36, unit: 'pieces', stock_status: 'insufficient' }, { egg: 'product_id' }),
    send('PUT', '/api/grocery/products/{egg}', { reference: 'ORD000003' }),
    send('PUT', '/api/grocery/products/NOPE', { reference: 'x' }),
    send('PUT', '/api/calendar/{event}', { workout_type: 'walking' }),
    get('/api/grocery/products'),
    get('/api/calendar'),
    get('/'),
  ],
  workspace: [
    login('/api/auth/login', { username: 'demo', password: 'demo123' }),
    get('/api/notes'),
    get('/api/notes?seeded=1', { first: '0.id' }),
    get('/api/notes/{first}/brief'),
    get('/api/notes/{first}/task-record'),
    send('POST', '/api/notes', { title: 'Sprint 24 Retrospective', content: 'summary', content_type: 'brief' }, { made: 'id' }),
    send('PUT', '/api/notes/{made}/brief', {
      key_updates: 'Done.',
      evidence_bullets: [{ text: 'Report.', source: 'document' }],
      action_items: [{ text: 'Docs', status: 'todo' }],
      citations: [],
      status: 'final',
    }),
    send('PUT', '/api/notes/{made}/task-record', { record_type: 'tracker_update', summary_text: 'Follow up.', status: 'in_progress' }),
    send('PUT', '/api/notes/{made}/task-record', { record_type: 'nope' }),
    get('/api/notes/{made}/brief'),
    get('/api/notes/{made}/task-record'),
    get('/api/notes/999999/brief'),
    get('/api/notes'),
  ],
  shop: [
    get('/api/products?q=smart%20watch&min_rating=4.6&sort=price_asc', { watch: 'data.products.0.id' }),
    get('/api/products?q=portable%20washer&min_rating=4.6&sort=price_asc'),
    get('/api/orders'),
    get('/api/cart'),
    send('POST', '/api/cart/clear'),
    send('POST', '/api/cart/add', { product_id: '{watch}' }),
    send('PUT', '/api/cart/update', { product_id: '{watch}', quantity: 3 }),
    send('POST', '/api/cart/add', { product_id: 'nope' }),
    get('/api/cart'),
    send('POST', '/api/checkout'),
    send('POST', '/api/checkout'),
    send('POST', '/api/orders/ORD000005/return'),
    send('POST', '/api/orders/NOPE/return'),
    send('POST', '/api/user/update', { field: 'address', value: '4278 Maple View Drive, Sacramento, CA 95814, USA' }),
    send('POST', '/api/user/update', { field: 'phone', value: '12345678901' }),
    send('POST', '/api/user/update', { field: 'nope', value: 'x' }),
    get('/api/orders'),
    get('/'),
  ],
  // Next Monday is 2026-04-06 at the airline tasks' epoch. `ref` is Peter's
  // seeded booking (none in flight-booking's), `made` the one booked here.
  airline: [
    get('/health'),
    get('/api/bookings'),
    login('/api/auth/login', { email: 'peter.griffin@work.mosi.inc', password: 'wrong' }),
    login('/api/auth/login', { email: 'peter.griffin@work.mosi.inc', password: 'password123' }),
    get('/api/profile'),
    get('/api/bookings', { ref: 'data.bookings.0.booking_reference' }),
    get('/api/bookings/{ref}', { passenger: 'data.passengers.0.id' }),
    get('/api/checkin/{ref}/seats', { window: 'data.seat_chart.1.0.id', middle: 'data.seat_chart.3.1.id' }),
    send('POST', '/api/bookings/{ref}/seats', { seat_assignments: [{ passenger_id: '{passenger}', seat_id: '{window}' }] }),
    send('POST', '/api/checkin/{ref}'),
    get('/api/checkin/{ref}/boarding-pass'),
    send('POST', '/api/bookings/{ref}/seats', { seat_assignments: [{ passenger_id: '{passenger}', seat_id: '{middle}' }] }),
    get('/api/checkin/eligible'),
    get('/api/flights?origin=JFK&destination=LAX&date=2026-04-06', { flight: 'data.flights.0.id' }),
    send('POST', '/api/flights/search', { origin: 'JFK', destination: 'LAX', departure_date: '2026-04-06' }),
    get('/api/flights/{flight}'),
    get('/api/flights/{flight}/seats?cabin_class=economy&available_only=true', { seat: 'data.seats.economy.0.id' }),
    send(
      'POST',
      '/api/bookings',
      { flight_id: '{flight}', cabin_class: 'economy', passengers: [{ first_name: 'Peter', last_name: 'Griffin', date_of_birth: '1985-12-11' }] },
      { made: 'data.booking_reference' },
    ),
    send('POST', '/api/bookings', {}),
    get('/api/bookings/{made}', { booked: 'data.passengers.0.id' }),
    send('POST', '/api/bookings/{made}/seats', { seat_assignments: [{ passenger_id: '{booked}', seat_id: '{seat}' }] }),
    send('POST', '/api/bookings/{made}/cancel'),
    get('/api/bookings?status=cancelled'),
    get('/api/announcements'),
    get('/api/faq'),
    get('/api/info/airport'),
    send('POST', '/api/baggage', {
      flight_number: 'GKD888',
      flight_time: '2026-04-03 06:00',
      passenger_name: 'Peter Griffin',
      passenger_phone: '+1-555-0100',
      passenger_email: 'peter.griffin@work.mosi.inc',
      baggage_description: '20-inch black rolling suitcase',
      loss_details: 'Not on the carousel',
    }),
    send('POST', '/api/baggage', { flight_number: 'GKD888' }),
    get('/api/baggage'),
    get('/api/claims'),
    send('POST', '/api/claims/calculate-refund/{ref}', {}),
    get('/api/flights/999999'),
    get('/'),
  ],
}

/**
 * A difference this check's own frozen clock makes, by service: the step it
 * shows at, the steps and tables that follow from it. At the airline, a new
 * booking's payment is `TXN-${Date.now()}`, which upstream's clock, frozen
 * here, gives the seed's payments too: the UNIQUE clash fails the booking
 * (500, a pending row left), which upstream's moving clock never does and
 * the fake's does not. Only tasks whose seed has a payment show it.
 */
const CLOCK_CLASH: Record<string, { step: string; after: RegExp; tables: string[] }> = {
  airline: {
    step: 'POST /api/bookings',
    after: /\{made\}|\{booked\}|status=cancelled/,
    tables: ['bookings', 'payments', 'passengers', 'seats', 'email_notifications'],
  },
}

/** A value of a JSON reply by its dotted path, or undefined. */
function pick(value: unknown, path: string): unknown {
  let at = value
  for (const key of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined
    at = (at as Record<string, unknown>)[key]
  }
  return at
}

/** A service under test: its base URL, its session and the values taken from its replies. */
class Side {
  session: { bearer?: string; cookie?: string } = {}
  readonly values: Record<string, string>
  readonly base: string

  constructor(base: string, today: string) {
    this.base = base
    this.values = { today }
  }

  fill(text: string): string {
    return text.replace(/\{(\w+)\}/g, (m, name: string) => this.values[name] ?? m)
  }

  /** A body with its taken values in: a string that is one `{name}` alone is the value, a number where it is one. */
  filled(value: unknown): unknown {
    if (typeof value === 'string') {
      const whole = /^\{(\w+)\}$/.exec(value)
      const taken = whole === null ? undefined : this.values[whole[1]!]
      if (taken !== undefined && /^-?\d+$/.test(taken)) return Number(taken)
      return this.fill(value)
    }
    if (Array.isArray(value)) return value.map((v) => this.filled(v))
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.filled(v)]))
    return value
  }

  async send(step: Step) {
    const headers: Record<string, string> = {}
    if (step.auth) {
      if (this.session.bearer !== undefined) headers.Authorization = `Bearer ${this.session.bearer}`
      if (this.session.cookie !== undefined) headers.Cookie = this.session.cookie
    }
    let body: string | undefined
    if (step.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(this.filled(step.body))
    }
    const reply = await fetch(`${this.base}${this.fill(step.path)}`, { method: step.method ?? 'GET', headers, body, redirect: 'manual' })
    const text = await reply.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    if (step.login && reply.ok) {
      const token = pick(json, 'token') ?? pick(json, 'data.token')
      if (typeof token === 'string') this.session.bearer = token
      const cookie = reply.headers.get('set-cookie')
      if (cookie !== null) this.session.cookie = cookie.split(';')[0]
    }
    for (const [name, path] of Object.entries(step.take ?? {})) {
      const value = pick(json, path)
      if (value !== undefined && value !== null) this.values[name] = String(value)
    }
    return { status: reply.status, type: reply.headers.get('content-type'), text }
  }
}

/** A time, a session token and a randomly drawn id, each as a placeholder. */
function masked(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>')
    .replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?/g, '<time>')
    .replace(/PROD\d{14}-[A-Z0-9]{3}/g, '<random id>')
    .replace(/\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/g, '<bcrypt hash>')
    .replace(/(session|token)=[^;"\s]+/g, '$1=<token>')
    .replace(/"booking_reference":"[A-HJ-NP-Z2-9]{6}"/g, '"booking_reference":"<random reference>"')
    .replace(/(Booking Confirmation - |your booking )[A-HJ-NP-Z2-9]{6}\b/g, '$1<random reference>')
    .replace(/TXN-\d{13}/g, 'TXN-<time>')
}

/**
 * A JSON body with its lists' order set aside. The fake's writes are a
 * second apart, upstream's here all at the epoch, so rows listed newest
 * first tie upstream and do not here.
 */
function unordered(text: string): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sort(v)]))
        : value
  try {
    return JSON.stringify(sort(JSON.parse(text)))
  } catch {
    return text
  }
}

/** Where two texts first differ, with a little of each from there. */
function firstDifference(a: string, b: string): string {
  let at = 0
  while (at < a.length && a[at] === b[at]) at++
  const from = Math.max(0, at - 120)
  return `      upstream: ${a.slice(from, at + 360)}\n      fake:     ${b.slice(from, at + 360)}`
}

/** The fake's own tables, which upstream's mock has none of. */
const OURS = new Set(['_env', '_file', '_schema', '_row', '_seed', '_prisma_migrations', 'sqlite_sequence'])

/**
 * A file the fake keeps that upstream's mock, here, cannot: the airline's
 * seed writes its note to /var/lib/mock-data/seed-meta.json, a path of its
 * own rather than one under the environment it is given, which under Bun is
 * the host's, outside the scratch root (and not writable there).
 */
const OUT_OF_ROOT = new Set(['/var/lib/mock-data/seed-meta.json'])

/** Every table of a SQLite file but the fake's own, rows in order, masked. */
function tables(file: string): Record<string, string> {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    const out: Record<string, string> = {}
    for (const { name } of names) {
      if (!OURS.has(name)) out[name] = masked(JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()))
    }
    return out
  } finally {
    db.close()
  }
}

/** A child's first line that starts with `prefix`, parsed. */
async function announced<T>(child: ChildProcess, prefix: string, what: string): Promise<T> {
  for await (const line of createInterface({ input: child.stdout! })) {
    if (line.startsWith(prefix)) return JSON.parse(line.slice(prefix.length)) as T
  }
  throw new Error(`${what} exited before it was ready`)
}

/** The committed tasks on a service, with their epoch. */
function tasksOf(service: string): { task: string; epoch: string }[] {
  const out: { task: string; epoch: string }[] = []
  for (const task of readdirSync(TASKS).sort()) {
    const yaml = readFileSync(join(TASKS, task, 'environment', 'mirage.yaml'), 'utf8')
    const block = new RegExp(`^  ${service}:\\n(?:    .*\\n)*?    epoch: '([^']+)'`, 'm').exec(yaml)
    if (block !== null) out.push({ task, epoch: block[1]! })
  }
  return out
}

/** One task's comparison; the number of unexpected differences. */
async function compare(service: string, task: string, epoch: string, fake: { url: string; state: string }): Promise<number> {
  const spec = MOCKS[service]!
  // From the mock platform, whose tsconfig.json Bun compiles its JSX by.
  const child = spawn('bun', [join(HERE, 'fixtures', 'serve-upstream.ts'), service, task, epoch], {
    cwd: PLATFORM,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, TZ: 'UTC' },
  })
  const differ: string[] = []
  const reordered: string[] = []
  const known: string[] = []
  const clash = CLOCK_CLASH[service]
  let clashed = false
  let same = 0
  try {
    const upstream = await announced<{ url: string; root: string }>(child, 'UPSTREAM=', `upstream's ${service} for ${task}`)
    const run = task.replace(/[^A-Za-z0-9._-]/g, '-')
    const reset = await fetch(`${fake.url}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run, fixture: task, epoch }),
    })
    if (!reset.ok) throw new Error(`resetting the fake's run for ${task}: ${reset.status} ${await reset.text()}`)
    const today = epoch.slice(0, 10)
    const theirs = new Side(upstream.url, today)
    const ours = new Side(`${fake.url}/_run/${run}`, today)
    for (const step of FLOWS[service]!) {
      const a = await theirs.send(step)
      const b = await ours.send(step)
      if (clash !== undefined && step.name === clash.step && a.status === 500 && b.status === 201) {
        clashed = true
        known.push(`${step.name}: 500 vs 201, upstream's frozen clock's transaction id clash`)
        continue
      }
      if (clashed && clash!.after.test(step.path)) {
        known.push(`${step.name}: follows the clash`)
        continue
      }
      const problems: string[] = []
      if (a.status !== b.status) problems.push(`status ${a.status} vs ${b.status}`)
      if (a.type !== b.type) problems.push(`content-type ${a.type} vs ${b.type}`)
      if (masked(a.text) === masked(b.text)) {
        // The same.
      } else if (unordered(masked(a.text)) === unordered(masked(b.text))) {
        reordered.push(step.name)
      } else problems.push(`body\n${firstDifference(masked(a.text), masked(b.text))}`)
      if (problems.length > 0) differ.push(`${step.name}\n    ${problems.join('\n    ')}`)
      else same++
    }
    // What each leaves behind: the database's tables, and the files the mock keeps.
    const kit = readdirSync(fake.state).find((e) => e.startsWith(`mirage-kit-${service}-`))!
    const db = join(fake.state, kit, `${run}.db`)
    if (spec.db !== undefined && spec.db !== ':memory:') {
      const upstreamTables = tables(join(upstream.root, spec.db))
      const fakeTables = tables(db)
      for (const table of new Set([...Object.keys(upstreamTables), ...Object.keys(fakeTables)])) {
        if (upstreamTables[table] === fakeTables[table]) continue
        if (clashed && clash!.tables.includes(table)) known.push(`table ${table}: follows the clash`)
        else differ.push(`table ${table}\n${firstDifference(upstreamTables[table] ?? '', fakeTables[table] ?? '')}`)
      }
    }
    const files = join(fake.state, kit, `${run}.db.files`)
    if (existsSync(files)) {
      for (const name of readdirSync(files)) {
        const path = decodeURIComponent(name)
        if (OUT_OF_ROOT.has(path)) {
          console.log(`KNOWN ${service} ${task} file ${path}: written by the fake's seed, outside upstream's scratch root`)
          continue
        }
        const mine = masked(readFileSync(join(files, name), 'utf8'))
        const theirsFile = join(upstream.root, path)
        const upstreamText = existsSync(theirsFile) ? masked(readFileSync(theirsFile, 'utf8')) : '<none>'
        if (mine !== upstreamText) differ.push(`file ${path}\n${firstDifference(upstreamText, mine)}`)
      }
    }
  } finally {
    child.stdin!.end()
    child.kill()
  }
  for (const line of differ) console.log(`DIFF ${service} ${task} ${line}`)
  for (const line of known) console.log(`KNOWN ${service} ${task} ${line}`)
  for (const line of reordered) console.log(`ORDER ${service} ${task} ${line}: the same rows, in the clock's order`)
  console.log(`${differ.length === 0 ? 'ok' : 'FAIL'} ${service} ${task}: ${same} replies the same, ${differ.length} differ`)
  return differ.length
}

/** The shared fake for a service, seeded with each of its tasks' committed fixtures. */
async function startFake(service: string, tasks: string[], root: string): Promise<{ url: string; state: string; process: ChildProcess }> {
  mkdirSync(join(root, 'fixtures', service), { recursive: true })
  for (const task of tasks) {
    copyFileSync(join(TASKS, task, 'environment', 'fixtures', `${service}.json`), join(root, 'fixtures', service, `${task}.json`))
  }
  const child = spawn(
    process.execPath,
    [join(HERE, 'fakes.ts'), '--service', service, '--root', root, '--fixture', tasks[0]!, '--log', join(root, 'fake.log')],
    { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TZ: 'UTC' } },
  )
  return { ...(await announced<{ url: string; state: string }>(child, 'FAKE=', `the ${service} fake`)), process: child }
}

async function main(): Promise<number> {
  process.env.TZ = 'UTC'
  const asked = process.argv.slice(2)
  for (const service of asked) if (FLOWS[service] === undefined) throw new Error(`${service} has no upstream mock flow`)
  const scratch = mkdtempSync(join(tmpdir(), 'vfsbench-compare-upstream-'))
  let failed = 0
  try {
    for (const service of asked.length > 0 ? asked : Object.keys(FLOWS)) {
      const tasks = tasksOf(service)
      if (tasks.length === 0) continue
      const fake = await startFake(
        service,
        tasks.map((t) => t.task),
        join(scratch, service),
      )
      try {
        for (const { task, epoch } of tasks) failed += await compare(service, task, epoch, fake)
      } finally {
        fake.process.stdin!.end()
        await new Promise((resolve) => fake.process.once('exit', resolve))
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log(failed === 0 ? 'no unexpected differences' : `${failed} unexpected differences`)
  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
