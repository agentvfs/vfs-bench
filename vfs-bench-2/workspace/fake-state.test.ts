import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withVerifierState } from './fake-state.ts'

test('JSON state export requires its host capability and only invokes declared delegates', async () => {
  const calls: unknown[] = []
  const fake: any = {
    config: { service: 'chat' },
    routes: () => [],
    dmmf: {
      datamodel: {
        models: [
          {
            name: 'Record',
            dbName: 'records',
            fields: [
              { name: 'id', kind: 'scalar', type: 'Int' },
              { name: 'enabled', dbName: 'active', kind: 'scalar', type: 'Boolean' },
              { name: 'payload', kind: 'scalar', type: 'Bytes' },
              { name: 'parent', kind: 'object' },
            ],
          },
        ],
      },
    },
  }
  const view = withVerifierState(fake, 'host-token').routes()[0]!
  const context: any = {
    headers: {},
    query: new URLSearchParams('table=records'),
    db: {
      record: {
        findMany: async (args: unknown) => {
          calls.push(args)
          return [{ id: 1, enabled: true, payload: new Uint8Array([0, 255]) }]
        },
      },
      $queryRawUnsafe: () => {
        throw new Error('No raw SQL in the state view')
      },
    },
  }
  assert.equal((await view.handler(context)).status, 403)
  assert.equal(calls.length, 0)
  context.headers['x-vfsbench-state-token'] = 'host-token'
  context.query = new URLSearchParams('table=unregistered')
  assert.equal((await view.handler(context)).status, 400)
  assert.equal(calls.length, 0)
  context.query = new URLSearchParams('table=records')
  assert.deepEqual(await view.handler(context), {
    status: 200,
    body: { records: [{ __order: 1, id: 1, active: 1, payload: 'AP8=' }] },
  })
  assert.deepEqual(calls, [{}])
})

test('airline snapshots fetch only seats reachable by passenger records', async () => {
  const calls: unknown[] = []
  const fields = (names: string[]) => names.map((name) => ({ name, kind: 'scalar', type: 'Int' }))
  const fake: any = {
    config: { service: 'airline' },
    routes: () => [],
    dmmf: {
      datamodel: {
        models: [
          { name: 'passengers', fields: fields(['id', 'seat_id']) },
          { name: 'seats', fields: fields(['id', 'seat_number']) },
        ],
      },
    },
  }
  const view = withVerifierState(fake, 'host-token').routes()[0]!
  const result = await view.handler({
    headers: { 'x-vfsbench-state-token': 'host-token' },
    query: new URLSearchParams('table=passengers&table=seats'),
    db: {
      passengers: {
        findMany: async () => [
          { id: 1, seat_id: 42 },
          { id: 2, seat_id: null },
          { id: 3, seat_id: 42 },
        ],
      },
      seats: {
        findMany: async (args: unknown) => {
          calls.push(args)
          return [{ id: 42, seat_number: '2F' }]
        },
      },
    },
  } as any)
  assert.equal(result.status, 200)
  assert.deepEqual(calls, [{ where: { id: { in: [42] } } }])
})

test('unmodeled grocery rows retain store order and nullable keys', async () => {
  const rows = [
    { product_id: null, name: 'Z eggs', quantity: 36, unit: 'pieces' },
    { product_id: 'eggs', name: 'A eggs', quantity: 36, unit: 'pieces' },
  ]
  let reads = 0
  const fake: any = {
    config: { service: 'smarthome' },
    dmmf: { datamodel: { models: [] } },
    routes: () => [],
  }
  const view = withVerifierState(fake, 'host-token').routes()[0]!
  assert.equal(view.write, true)
  const context: any = {
    headers: {},
    query: new URLSearchParams('table=grocery_product'),
    db: {
      snapshotGroceryRows: async () => {
        reads++
        return rows
      },
    },
  }
  assert.equal((await view.handler(context)).status, 403)
  assert.equal(reads, 0)
  context.headers['x-vfsbench-state-token'] = 'host-token'
  assert.deepEqual(await view.handler(context), {
    status: 200,
    body: { grocery_product: rows.map((row, i) => ({ ...row, __order: i + 1 })) },
  })
  assert.equal(reads, 1)
})
