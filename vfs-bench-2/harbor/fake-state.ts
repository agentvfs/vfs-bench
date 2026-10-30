/** Read-only state export from an existing fake's own async data client.
 * The verifier consumes JSON through Mirage VFS; it never opens the store.
 */
import type { Dmmf, Fake, MinimalClient } from '../submodule/mirage/integ/server/kit/typescript/index.ts'
import { route } from '../submodule/mirage/integ/server/kit/typescript/index.ts'
export function withVerifierState<C extends MinimalClient>(fake: Fake<C>, token: string): Fake<C> {
  if (!token) throw new Error('Verifier state requires a capability token')
  return {
    ...fake,
    routes: () => [
      route<C>(
        'GET',
        '/_verifier/state',
        async (ctx) => {
          if (ctx.headers['x-vfsbench-state-token'] !== token)
            return { status: 403, body: { error: 'forbidden' } }
          const requested = ctx.query.getAll('table')
          if (!requested.length || new Set(requested).size !== requested.length)
            return { status: 400, body: { error: 'invalid_tables' } }
          const tables: Record<string, unknown[]> = {}
          for (const name of requested) {
            // Prisma cannot model this nullable primary key. The fake's store
            // client exports it in reference order (the public API sorts it).
            if (fake.config.service === 'smarthome' && name === 'grocery_product') {
              const rows = await (
                ctx.db as C & {
                  snapshotGroceryRows(): Promise<Record<string, unknown>[]>
                }
              ).snapshotGroceryRows()
              tables[name] = rows.map((row, i) => ({ ...row, __order: i + 1 }))
              continue
            }
            const model = (fake.dmmf as Dmmf).datamodel.models.find((m) => (m.dbName ?? m.name) === name)
            if (!model) return { status: 400, body: { error: 'unknown_table', table: name } }
            const key = model.name[0]!.toLowerCase() + model.name.slice(1)
            const delegate = (ctx.db as any)[key]
            // Airline grading can only inspect seats referenced by passengers.
            // Its seed contains 317k unrelated seats; keep those out of the VFS
            // snapshot while retaining every seat the checks can reach.
            const options =
              fake.config.service === 'airline' && name === 'seats'
                ? {
                    where: {
                      id: {
                        in: [
                          ...new Set(
                            ((tables.passengers as any[]) ?? [])
                              .map((p) => p.seat_id)
                              .filter((id) => id != null)
                          ),
                        ],
                      },
                    },
                  }
                : {}
            const rows = await delegate.findMany(options)
            const fields = model.fields.filter((f) => f.kind !== 'object')
            tables[name] = rows.map((row: Record<string, any>, i: number) => ({
              __order: i + 1,
              ...Object.fromEntries(
                fields.map((f) => {
                  let value = row[f.name]
                  if (typeof value === 'boolean') value = Number(value)
                  if (typeof value === 'bigint') {
                    value = Number(value)
                    if (!Number.isSafeInteger(value))
                      throw new Error('State integer exceeds exact JSON range')
                  }
                  if (value instanceof Uint8Array) value = Buffer.from(value).toString('base64')
                  if (value instanceof Date) value = value.toISOString()
                  return [f.dbName ?? f.name, value]
                })
              ),
            }))
          }
          return { status: 200, body: tables as any }
          // Serialize the snapshot with the mock's own handlers.
        },
        { write: true }
      ),
      ...fake.routes(),
    ],
  }
}
