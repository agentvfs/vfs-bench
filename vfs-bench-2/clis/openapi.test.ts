/** `pnpm test`: which headers an OpenAPI CLI sends, against a stubbed fetch. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MountMode, RAMVFS, Workspace } from '@struktoai/mirage-node'

import { type OpenApi, openapiCli } from './openapi.ts'
import type { JsonSchema } from './tools.ts'

const BASE = 'http://api.test'
const HEADERS = ['x-const', 'x-enum-one', 'x-default', 'x-enum-two']

// Four required headers. Only the first two allow a single value; the
// enum of one is a `$ref`, as Box declares its `box-version`.
const SPEC: OpenApi = {
  paths: {
    '/things/{id}': {
      get: {
        summary: 'Get thing',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'x-const', in: 'header', required: true, schema: { type: 'string', const: '1' } as JsonSchema },
          { $ref: '#/components/parameters/Version' },
          { name: 'x-default', in: 'header', required: true, schema: { type: 'string', default: 'd' } },
          { name: 'x-enum-two', in: 'header', required: true, schema: { type: 'string', enum: ['a', 'b'] } },
        ],
      },
    },
  },
  components: { parameters: { Version: { name: 'x-enum-one', in: 'header', required: true, schema: { type: 'string', enum: ['2025.0'] } } } },
}

test('a required header that allows one value is sent with it, and no header is a flag', async () => {
  const sent: { url: string; headers: Record<string, string> }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith(BASE)) return realFetch(input, init)
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)) })
    return new Response('{"id":"7"}', { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const workspace = new Workspace({ '/tmp': new RAMVFS() }, { mode: MountMode.WRITE })
  try {
    workspace.registerCli('api', openapiCli('api', SPEC, 'A test API.'), { url: BASE })
    const io = await workspace.shell('api get-thing --id 7')
    assert.equal(io.exitCode, 0, io.stderrText)
    assert.deepEqual(sent, [{ url: `${BASE}/things/7`, headers: { 'x-const': '1', 'x-enum-one': '2025.0' } }])
    const help = await workspace.shell('api get-thing --help')
    assert.equal(help.exitCode, 0, help.stderrText)
    for (const name of HEADERS) assert.ok(!help.stdoutText.includes(`--${name}`), help.stdoutText)
  } finally {
    globalThis.fetch = realFetch
    await workspace.close()
  }
})
