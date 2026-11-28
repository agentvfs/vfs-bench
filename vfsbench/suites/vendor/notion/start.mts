// One immutable service install. The kit creates the SQLite store in /tmp.
import { notionFake } from './integ/server/notion/fake.ts'
import { makeRuntime, createKitServer } from './integ/server/kit/typescript/http.ts'
import { closeSync, openSync } from 'node:fs'
import { join } from 'node:path'

const name = process.env.NOTION_TENANT
if (!name) throw new Error('Missing Notion tenant')
const runtime = makeRuntime(notionFake, '/fixtures')
closeSync(openSync(join(runtime.pool.root, '.templates', 'schema.db'), 'wx'))
await runtime.reset({fixture: 'task', tenants: [name]})
const server = createKitServer(runtime)
server.listen(5091, '127.0.0.1')
