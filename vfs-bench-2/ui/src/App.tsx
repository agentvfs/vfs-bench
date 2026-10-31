import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from './api.ts'
import type { Cell, Config, JobBrief, JobDetail, TaskBrief } from './api.ts'
import { Brand } from './Logo.tsx'
import { Select } from './Select.tsx'

/** The form's agents, as Harbor's `-a` takes them. */
const AGENTS: Record<string, string> = {
  oracle: 'oracle',
  nop: 'nop',
  codex: 'vfsbench_harbor:Codex',
  'claude-code': 'vfsbench_harbor:ClaudeCode',
  'dspy-rlm': 'dspy-rlm',
}
const MODELS: Record<string, string> = {
  codex: 'openai/gpt-5.6-luna',
  'claude-code': 'anthropic/claude-sonnet-5-5',
  'dspy-rlm': 'openai/gpt-5.6-luna',
}
const STATES: [Cell['state'], string][] = [
  ['not-started', 'not started'],
  ['in-progress', 'in progress'],
  ['succeeded', 'succeeded'],
  ['failed', 'failed'],
]

const finished = (c: { state: Cell['state'] }) => c.state === 'succeeded' || c.state === 'failed'
const live = (status: string) => status === 'running' || status === 'starting'
/** The form's name for an agent Harbor ran. */
const agentLabel = (agent: string) => Object.keys(AGENTS).find((k) => AGENTS[k] === agent) ?? agent

/** A run's name: a short, stable id from its directory. */
function shortId(id: string): string {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toTimeString().slice(0, 5)}`
}

function describe(c: Cell): string {
  const state = STATES.find(([s]) => s === c.state)![1]
  const reward = c.reward === null ? '' : ` · reward ${Number(c.reward.toFixed(3))}`
  return `${c.task} · ${state}${reward}${c.error && c.state === 'failed' ? ` · ${c.error}` : ''}`
}

/** One config per dataset: `harbor/<dataset>.yaml`, else the first that runs it. */
function datasets(configs: Config[]): Config[] {
  const out = new Map<string, Config>()
  for (const c of configs)
    if (!out.has(c.dataset) || c.file === `harbor/${c.dataset}.yaml`) out.set(c.dataset, c)
  return [...out.values()]
}

const Icon = {
  stop: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4.6 1h4.8L13 4.6v4.8L9.4 13H4.6L1 9.4V4.6z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  play: <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M1 1v10l8-5z" fill="currentColor" /></svg>,
  retry: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.5v2.5H7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
    </svg>
  ),
  trash: (
    <svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true">
      <path d="M1.5 3.5h10M5 3.5V2h3v1.5M3 3.5l.7 9h5.6l.7-9M5.3 6v4.5M7.7 6v4.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  close: <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" /></svg>,
  search: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8.7 8.7 12 12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  runs: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 3h1.5M1.5 7h1.5M1.5 11h1.5M5 3h7.5M5 7h7.5M5 11h7.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  tasks: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="8" y="1.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1.5" y="8" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.1" />
      <rect x="8" y="8" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  dataset: (
    <svg width="14" height="15" viewBox="0 0 32 34" fill="none" aria-hidden="true">
      <path d="M16 2 30 10v15l-14 8L2 25V10L16 2Z M2 10l14 8 14-8 M16 2v31" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  ),
}

/** Where the page is: a dataset's runs or tasks, or one run. Kept in the URL's hash. */
type Route =
  | { dataset: string; view: 'runs' | 'tasks' }
  | { dataset: string; view: 'run'; run: string }
  | { dataset: string; view: 'task'; task: string }

function readRoute(): Route | null {
  const [dataset, view, ...rest] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  if (!dataset) return null
  if (view === 'run' && rest.length) return { dataset, view, run: rest.join('/') }
  if (view === 'task' && rest.length) return { dataset, view, task: rest[0] }
  return { dataset, view: view === 'tasks' ? 'tasks' : 'runs' }
}

function writeRoute(route: Route) {
  const parts = [
    route.dataset,
    route.view,
    ...(route.view === 'run' ? route.run.split('/') : route.view === 'task' ? [route.task] : []),
  ]
  location.hash = '/' + parts.map(encodeURIComponent).join('/')
}

function NewRun({ config, onRun }: { config: Config; onRun: (id: string) => void }) {
  const [agent, setAgent] = useState('oracle')
  const [model, setModel] = useState('')
  const [concurrency, setConcurrency] = useState(16)
  const [attempts, setAttempts] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const needsModel = agent in MODELS

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const { id } = await api.run({
        config: config.file,
        agent: AGENTS[agent],
        model: needsModel ? model || MODELS[agent] : '',
        concurrency,
        attempts,
      })
      onRun(id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="form">
        <label>
          <span className="label">Agent</span>
          <Select label="Agent" value={agent} options={Object.keys(AGENTS)} onChange={setAgent} />
        </label>
        {needsModel && (
          <label>
            <span className="label">Model</span>
            <input value={model} placeholder={MODELS[agent]} onChange={(e) => setModel(e.target.value)} />
          </label>
        )}
        <label>
          <span className="label">Concurrency</span>
          <input type="number" min={1} max={512} step={1} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value) || 1)} />
        </label>
        <label>
          <span className="label">Attempts</span>
          <input type="number" min={1} max={16} step={1} value={attempts} onChange={(e) => setAttempts(Number(e.target.value) || 1)} />
        </label>
        <button className="primary" disabled={busy} onClick={submit}>
          {Icon.play} Run {config.tasks.length} tasks
        </button>
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  )
}

const Spinner = (
  <svg className="spin" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="5.5" stroke="var(--edge)" strokeWidth="1.4" />
    <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

/** A run's status as an icon, its word in the tooltip. */
function Status({ run }: { run: JobBrief }) {
  const name = live(run.status) ? `running, ${run.running} trials` : run.status
  const icon = live(run.status) ? (
    Spinner
  ) : run.status === 'stopped' ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.6 4.8v4.4M8.4 4.8v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.6 7.2 6.3 8.9 9.5 5.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  return <span className={`status ${run.status}`} title={name} role="img" aria-label={name}>{icon}</span>
}

function RunsView({
  config,
  runs,
  onOpen,
  onChange,
}: {
  config: Config
  runs: JobBrief[]
  onOpen: (id: string) => void
  onChange: () => void
}) {
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('all agents')
  const [adding, setAdding] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkArmed, setBulkArmed] = useState(false)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const agents = ['all agents', ...new Set(runs.map((r) => agentLabel(r.agent)))]
  const needle = query.trim().toLowerCase()
  const shown = runs.filter(
    (r) =>
      (agent === 'all agents' || agentLabel(r.agent) === agent) &&
      (!needle || shortId(r.id).includes(needle) || r.id.toLowerCase().includes(needle))
  )
  const selectable = shown.filter((r) => !live(r.status) && !deleting.has(r.id))
  // A selection only ever holds runs that are listed and can be deleted.
  const picked = selectable.filter((r) => selected.has(r.id)).map((r) => r.id)
  const all = selectable.length > 0 && picked.length === selectable.length

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Delete runs one after another; each spins until it leaves the list. */
  const remove = async (ids: string[]) => {
    setArmed(null)
    setBulkArmed(false)
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
    setDeleting((d) => new Set([...d, ...ids]))
    const failed: string[] = []
    for (const id of ids) {
      try {
        await api.remove(id)
      } catch (e) {
        failed.push(`${shortId(id)}: ${(e as Error).message}`)
        setDeleting((d) => {
          const next = new Set(d)
          next.delete(id)
          return next
        })
      }
      onChange()
    }
    setError(failed.join(' · '))
  }

  return (
    <>
      <div className="toolbar">
        <label className="search">
          {Icon.search}
          <input value={query} placeholder="Search by ID" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="filter"><Select label="Agent" value={agent} options={agents} onChange={setAgent} /></div>
        <span className="count">{picked.length ? `${picked.length} of ${shown.length} selected` : `${shown.length} runs`}</span>
        {picked.length > 0 &&
          (bulkArmed ? (
            <span className="confirm">
              <button className="danger square" title={`Delete ${picked.length} runs`} aria-label={`Delete ${picked.length} runs`} onClick={() => remove(picked)}>{Icon.trash}</button>
              <button className="icon" title="Keep" aria-label="Keep the selected runs" onClick={() => setBulkArmed(false)}>{Icon.close}</button>
            </span>
          ) : (
            <button className="ghost square" title={`Delete ${picked.length} selected runs`} aria-label={`Delete ${picked.length} selected runs`} onClick={() => setBulkArmed(true)}>{Icon.trash}</button>
          ))}
        <button className="primary push" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'New run'}</button>
      </div>
      {adding && <NewRun config={config} onRun={(id) => { setAdding(false); onOpen(id) }} />}
      {error && <div className="err">{error}</div>}
      <table className="list">
        <thead>
          <tr>
            <th className="pick">
              <input
                type="checkbox"
                className="check"
                aria-label="Select every run listed"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = picked.length > 0 && !all
                }}
                disabled={!selectable.length}
                onChange={() => setSelected(all ? new Set() : new Set(selectable.map((r) => r.id)))}
              />
            </th>
            <th>Started at</th><th>Run</th><th>Agent</th><th>Model</th><th>Status</th>
            <th className="num">Succeeded</th><th className="num">Failed</th><th className="num">Mean reward</th><th className="num">Concurrency</th><th className="act" />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className={selected.has(r.id) ? 'picked' : undefined} onClick={() => onOpen(r.id)} title={r.id}>
              <td className="pick" onClick={(e) => e.stopPropagation()}>
                {!live(r.status) && !deleting.has(r.id) && (
                  <input type="checkbox" className="check" aria-label={`Select run ${shortId(r.id)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                )}
              </td>
              <td>{when(r.startedAt)}</td>
              <td className="mono">{shortId(r.id)}</td>
              <td>{agentLabel(r.agent)}</td>
              <td className="muted">{r.model ?? '—'}</td>
              <td><Status run={r} /></td>
              <td className="num">{r.passed}<span className="muted">/{r.total}</span></td>
              <td className="num">{Math.max(0, r.finished - r.passed)}</td>
              <td className="num">{r.mean === null ? '—' : r.mean.toFixed(3)}</td>
              <td className="num">{r.concurrency}</td>
              <td className="act" onClick={(e) => e.stopPropagation()}>
                {deleting.has(r.id) ? (
                  <span className="deleting" title="Deleting" role="img" aria-label="Deleting">{Spinner}</span>
                ) : armed === r.id ? (
                  <span className="confirm">
                    <button className="danger small" title="Delete run" aria-label={`Delete run ${shortId(r.id)}`} onClick={() => remove([r.id])}>{Icon.trash}</button>
                    <button className="icon" title="Keep" aria-label="Keep the run" onClick={() => setArmed(null)}>{Icon.close}</button>
                  </span>
                ) : (
                  !live(r.status) && (
                    <button className="icon" title="Delete run" aria-label={`Delete run ${shortId(r.id)}`} onClick={() => setArmed(r.id)}>{Icon.trash}</button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** A time limit in seconds, as minutes. */
const minutes = (v: unknown) => (typeof v === 'number' ? `${Math.round(v / 60)} min` : '—')

function TasksView({ dataset, onOpen }: { dataset: string; onOpen: (task: string) => void }) {
  const [tasks, setTasks] = useState<TaskBrief[] | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all categories')
  useEffect(() => {
    setTasks(null)
    let on = true
    api.tasks(dataset).then((t) => on && setTasks(t), () => {})
    return () => {
      on = false
    }
  }, [dataset])
  if (!tasks) return null
  const categories = ['all categories', ...new Set(tasks.map((t) => String(t.metadata.category ?? '')).filter(Boolean))]
  const hasDifficulty = tasks.some((t) => t.metadata.difficulty)
  const hasDomain = tasks.some((t) => t.metadata.domain)
  const needle = query.trim().toLowerCase()
  const shown = tasks.filter(
    (t) =>
      (category === 'all categories' || t.metadata.category === category) &&
      (!needle || t.task.toLowerCase().includes(needle) || t.instruction.toLowerCase().includes(needle))
  )
  return (
    <>
      <div className="toolbar">
        <label className="search">
          {Icon.search}
          <input value={query} placeholder="Search tasks" onChange={(e) => setQuery(e.target.value)} />
        </label>
        {categories.length > 2 && (
          <div className="filter"><Select label="Category" value={category} options={categories} onChange={setCategory} /></div>
        )}
        <span className="count">{shown.length} tasks</span>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Task</th><th>Category</th>
            {hasDifficulty && <th>Difficulty</th>}
            {hasDomain && <th>Domain</th>}
            <th>Agent limit</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.task} onClick={() => onOpen(t.task)}>
              <td className="mono">{t.task}</td>
              <td>{String(t.metadata.category ?? '—')}</td>
              {hasDifficulty && <td>{String(t.metadata.difficulty ?? '—')}</td>}
              {hasDomain && <td className="muted">{String(t.metadata.domain ?? '—')}</td>}
              <td className="mono">{minutes(t.limits['agent.timeout_sec'])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** One task as its directory describes it: the instruction, the workspace and the limits. */
function TaskView({ dataset, task }: { dataset: string; task: string }) {
  const [t, setT] = useState<TaskBrief | null | undefined>(undefined)
  useEffect(() => {
    let on = true
    api.tasks(dataset).then((all) => on && setT(all.find((x) => x.task === task) ?? null), () => on && setT(null))
    return () => {
      on = false
    }
  }, [dataset, task])
  if (t === undefined) return null
  if (t === null) return <div className="err">No task {task} in {dataset}</div>
  const { category, difficulty, upstream, ...rest } = t.metadata
  const facts = Object.entries(rest).filter(([, v]) => v !== '' && v !== null)
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="mono">{t.task}</h1>
          <p className="sub">{[category, difficulty].filter(Boolean).map(String).join(' · ')}</p>
        </div>
      </div>
      <div className="task-page">
        <section>
          <span className="label">Instruction</span>
          <pre className="instruction">{t.instruction || '—'}</pre>
        </section>
        <aside>
          {(upstream || facts.length > 0) && (
            <section>
              <span className="label">Metadata</span>
              <table className="kv">
                <tbody>
                  {upstream ? <tr><td>upstream</td><td className="mono wrap">{String(upstream)}</td></tr> : null}
                  {facts.map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono wrap">{Array.isArray(v) ? v.join(', ') : String(v)}</td></tr>)}
                </tbody>
              </table>
            </section>
          )}
        </aside>
      </div>
    </>
  )
}

function Legend() {
  return (
    <div className="legend">
      {STATES.map(([s, label]) => <span key={s}><span className={`cell ${s}`} />{label}</span>)}
    </div>
  )
}

function Terminal({ cell, onStop, onRetry }: { cell: Cell; onStop: () => void; onRetry: () => void }) {
  return (
    <div className="term" id={`term-${cell.task}`}>
      <header>
        <span className={`cell ${cell.state}`} title={STATES.find(([s]) => s === cell.state)![1]} />
        <b>{cell.task}</b>
        {cell.state === 'in-progress' && cell.trial && (
          <button className="icon" title="Stop" aria-label={`Stop ${cell.task}`} onClick={onStop}>{Icon.stop}</button>
        )}
        {finished(cell) && (
          <button className="icon" title="Retry" aria-label={`Retry ${cell.task}`} onClick={onRetry}>{Icon.retry}</button>
        )}
      </header>
      <div className="body">
        {cell.commands.map((c, i) => <div key={i} className="cmd">{c}</div>)}
      </div>
    </div>
  )
}

function RunView({ id, onChange, head }: { id: string; onChange: () => void; head: (job: JobDetail, actions: ReactNode) => ReactNode }) {
  const [job, setJob] = useState<JobDetail | null>(null)
  const [error, setError] = useState('')
  const [focus, setFocus] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setJob(await api.job(id))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  const running = !!job && live(job.status)
  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, running ? 1000 : 5000)
    return () => clearInterval(timer)
  }, [refresh, running])

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
      onChange()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!job) return error ? <div className="err">{error}</div> : null
  const count = (s: Cell['state']) => job.cells.filter((c) => c.state === s).length
  const ended = job.cells.filter(finished)
  const mean = ended.length ? ended.reduce((s, c) => s + (c.reward ?? 0), 0) / ended.length : null
  const show = (task: string) => {
    setFocus(task)
    document.getElementById(`term-${task}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const actions = (
    <>
      {running && job.owned && <button className="ghost" onClick={() => act(() => api.stop(id))}>{Icon.stop} Stop</button>}
      {job.status === 'stopped' && <button className="ghost" onClick={() => act(() => api.resume(id))}>{Icon.play} Resume</button>}
    </>
  )

  return (
    <>
      {head(job, actions)}
      {error && <div className="err">{error}</div>}
      <div className="stats">
        <div className="stat"><span className="label">Mean reward</span><b>{mean === null ? '—' : mean.toFixed(3)}</b></div>
        <div className="stat"><span className="label">Succeeded</span><b style={{ color: 'var(--gold-ink)' }}>{count('succeeded')}</b></div>
        <div className="stat"><span className="label">Failed</span><b>{count('failed')}</b></div>
        <div className="stat"><span className="label">{running ? 'In progress' : 'Not started'}</span><b>{count(running ? 'in-progress' : 'not-started')}</b></div>
      </div>
      <div className="grid">
        {job.cells.map((c, i) => (
          <button key={`${c.task}-${i}`} className={`cell ${c.state}`} title={describe(c)} aria-label={describe(c)} onClick={() => show(c.task)} />
        ))}
      </div>
      <div className="terms">
        {job.cells.map((c, i) => (
          <div key={`${c.task}-${i}`} className={c.task === focus ? 'focus' : undefined}>
            <Terminal cell={c} onStop={() => act(() => api.stopTrial(c.trial!))} onRetry={() => act(() => api.retry(id, [c.task]))} />
          </div>
        ))}
      </div>
      <Legend />
    </>
  )
}

export function App() {
  const [configs, setConfigs] = useState<Config[]>([])
  const [jobs, setJobs] = useState<JobBrief[]>([])
  const [route, setRoute] = useState<Route | null>(readRoute)

  const refreshJobs = useCallback(() => {
    api.jobs().then(setJobs, () => {})
  }, [])
  useEffect(() => {
    api.configs().then(setConfigs, () => {})
    refreshJobs()
    const timer = setInterval(refreshJobs, 3000)
    const hash = () => setRoute(readRoute())
    window.addEventListener('hashchange', hash)
    return () => {
      clearInterval(timer)
      window.removeEventListener('hashchange', hash)
    }
  }, [refreshJobs])

  const choices = useMemo(() => datasets(configs), [configs])
  const go = (next: Route) => {
    writeRoute(next)
    setRoute(next)
  }
  const config = choices.find((c) => c.dataset === route?.dataset) ?? choices[0]
  if (!config) return <div className="shell" />
  const here: Route = route && route.dataset === config.dataset ? route : { dataset: config.dataset, view: 'runs' }
  const runs = jobs.filter((j) => j.dataset === config.dataset && !j.retryOf)
  const open = (id: string) => {
    refreshJobs()
    go({ dataset: config.dataset, view: 'run', run: id })
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <span className="crumb">/</span>
        <button className="crumb-link" onClick={() => go({ dataset: config.dataset, view: 'runs' })}>{config.dataset}</button>
        {here.view === 'run' && (
          <>
            <span className="crumb">/</span>
            <span className="mono">{shortId(here.run)}</span>
          </>
        )}
        {here.view === 'task' && (
          <>
            <span className="crumb">/</span>
            <button className="crumb-link" onClick={() => go({ dataset: config.dataset, view: 'tasks' })}>tasks</button>
            <span className="crumb">/</span>
            <span className="mono">{here.task}</span>
          </>
        )}
      </header>
      <div className="body">
        <nav className="sidenav">
          <span className="section">Datasets</span>
          {choices.map((c) => (
            <button key={c.dataset} className={`nav-item${c.dataset === config.dataset ? ' on' : ''}`} onClick={() => go({ dataset: c.dataset, view: 'runs' })}>
              {Icon.dataset}
              <span>{c.dataset}</span>
              <span className="muted push">{c.tasks.length}</span>
            </button>
          ))}
        </nav>
        <main className="page">
          {here.view === 'task' ? (
            <TaskView dataset={config.dataset} task={here.task} />
          ) : here.view === 'run' ? (
            <RunView
              key={here.run}
              id={here.run}
              onChange={refreshJobs}
              head={(job, actions) => (
                <div className="page-head">
                  <div>
                    <h1 className="mono">{shortId(job.id)}</h1>
                    <p className="sub">
                      {agentLabel(job.agent)}{job.model ? ` · ${job.model}` : ''} · {when(job.startedAt)} · {live(job.status) ? 'running' : job.status}
                    </p>
                  </div>
                  <div className="actions">{actions}</div>
                </div>
              )}
            />
          ) : (
            <>
              <div className="page-head"><h1>{config.dataset}</h1></div>
              <div className="subtabs">
                <button className={here.view === 'runs' ? 'on' : ''} onClick={() => go({ dataset: config.dataset, view: 'runs' })}>{Icon.runs} Runs</button>
                <button className={here.view === 'tasks' ? 'on' : ''} onClick={() => go({ dataset: config.dataset, view: 'tasks' })}>{Icon.tasks} Tasks</button>
              </div>
              {here.view === 'runs' ? <RunsView config={config} runs={runs} onOpen={open} onChange={refreshJobs} /> : <TasksView dataset={config.dataset} onOpen={(task) => go({ dataset: config.dataset, view: 'task', task })} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
