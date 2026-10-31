/** Harbor's fake entry adds a private JSON state view to the existing service. */
import { pathToFileURL } from 'node:url'
import { serve } from '../submodule/mirage/integ/server/kit/typescript/index.ts'
import { withVerifierState } from './fake-state.ts'
const source = process.env.VFSBENCH_FAKE_MODULE
const token = process.env.VFSBENCH_STATE_TOKEN
if (!source || !token) throw new Error('Missing Harbor fake state configuration')
const module = await import(pathToFileURL(source).href)
const candidates = Object.values(module).filter(
  (value: any) => value && typeof value.routes === 'function' && value.dmmf && value.config && value.client
)
if (candidates.length !== 1) throw new Error(`Expected one fake export from ${source}`)
await serve(withVerifierState(candidates[0] as any, token))
