import type { Config, JobBrief, JobDetail, RunRequest, TaskBrief } from '../server/harbor.ts'

export type { Cell, Config, JobBrief, JobDetail, RunRequest, TaskBrief } from '../server/harbor.ts'

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await res.json()
  if (!res.ok) throw new Error(value?.error ?? res.statusText)
  return value as T
}

export interface SettingsView {
  benchmark: string
  runs: string
  defaultBenchmark: string
  defaultRuns: string
  inUse: { benchmark: string; runs: string }
  datasets: number
  jobs: number
}

export const settings = () => call<SettingsView>('/api/settings')
export const saveSettings = (benchmark: string, runs: string) => call<SettingsView>('/api/settings', { benchmark, runs })
export const configs = () => call<Config[]>('/api/configs')
export const jobs = () => call<JobBrief[]>('/api/jobs')
export const job = (id: string) => call<JobDetail>(`/api/job?id=${encodeURIComponent(id)}`)
export const tasks = (dataset: string) => call<TaskBrief[]>(`/api/tasks?dataset=${encodeURIComponent(dataset)}`)
export const run = (request: RunRequest) => call<{ id: string }>('/api/run', request)
export const stop = (id: string) => call<null>('/api/stop', { id })
export const stopTrial = (trial: string) => call<null>('/api/stop-trial', { trial })
export const resume = (id: string) => call<null>('/api/resume', { id })
export const remove = (id: string) => call<null>('/api/delete', { id })
export const retry = (id: string, tasks: { task: string; slot: number }[]) => call<{ id: string }>('/api/retry', { id, tasks })
