// Stdio transport for the existing ComplexMCP simulators. One process owns
// one trial's clock and mutable sessions. Only "call" is bound to agent CLIs.
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { dumps, loads, toJson } from '../../../vfs-bench-2/workspace/py.ts'
import { APPS, login, type AppName } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/world.ts'
import { call, clientError } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/tool.ts'
import { tools as math } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/math.ts'
import { tools as unit } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/unit.ts'
import { tools as osint } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/osint.ts'
import { tools as time } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/time.ts'
import { tools as lang } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/lang.ts'
import { tools as crypto } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/crypto.ts'
import { tools as graph } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/graph.ts'
import { tools as chem } from '../../../vfs-bench-2/datasets/complexmcp/mocks/complexmcp/plain/chem.ts'

const plain = {math, unit, osint, time, lang, crypto, graph, chem}
const sessions = new Map<AppName, any>()
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const session_id = 'session_' + Array.from(randomBytes(22), b => alphabet[b % alphabet.length]).join('')
const names = new Map(Object.keys(APPS).map(k => [k.replace('Light', 'light-').toLowerCase(), k as AppName]))
function state() {
  return Object.fromEntries(Array.from(sessions, ([name, session]) =>
    [name, {status: 'ok', output: APPS[name].sessionDict(session)}]))
}

async function dispatch(req: any) {
  if (req.op === 'snapshot') {
    return dumps(Object.fromEntries(Array.from(sessions, ([name, session]) => [name, APPS[name].save(session)])))
  }
  if (req.op === 'init' || req.op === 'load') {
    const data = req.op === 'init' ? await login(req.seed, req.apps) : loads<Record<AppName, any>>(req.snapshot)
    const clock = APPS.LightSystem.load(data.LightSystem, undefined!)
    sessions.set('LightSystem', clock)
    for (const name of Object.keys(data) as AppName[]) {
      if (name !== 'LightSystem') sessions.set(name, APPS[name].load(data[name], clock.os()))
    }
    return state()
  }
  if (req.op === 'state') return state()
  if (req.op !== 'call') throw new Error('Unknown operation')
  const app = names.get(req.service)
  if (app) {
    if (!sessions.has(app)) return clientError('failed', app + ' has not been logged into yet.')
    return call(APPS[app].tools, req.tool, sessions.get(app), req.args, {session_id})
  }
  const server = req.service.replace(/-server$/, '') as keyof typeof plain
  return call(plain[server], req.tool, null, req.args)
}

for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
  try {
    process.stdout.write(toJson({result: await dispatch(loads(line))}) + '\n')
  } catch (err) {
    process.stdout.write(JSON.stringify({error: String(err)}) + '\n')
  }
}
