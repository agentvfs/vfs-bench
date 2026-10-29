/**
 * The inventory fake's routes: upstream's `server.py`, each statement kept,
 * over the run's lists. `products` is the fixture's products; `orders` is
 * each order upstream records.
 */
import { route } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { Dict } from '../claweval/store.ts'
import type { C } from './config.ts'

const LIST = { category: opt(null), status: opt(null) }
const GET = { product_id: REQUIRED }
const ORDER = { product_id: REQUIRED, quantity: REQUIRED, supplier: opt(null) }

const copy = (p: Dict): Dict => structuredClone(p)

async function listProducts(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, LIST, true)
  if (isReply(req)) return req
  const results: Dict[] = []
  for (const p of await load(ctx.db, 'products')) {
    if (req.category && p.category !== req.category) continue
    if (req.status && req.status !== 'all' && (p.status ?? null) !== req.status) continue
    results.push(copy(p))
  }
  const resp = { products: results, total: results.length }
  await logCall(ctx, '/inventory/products', req, resp)
  return ok(resp)
}

async function getProduct(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, GET)
  if (isReply(req)) return req
  for (const p of await load(ctx.db, 'products')) {
    if (p.product_id === req.product_id) {
      const resp = copy(p)
      await logCall(ctx, '/inventory/products/get', req, resp)
      return ok(resp)
    }
  }
  const resp = { error: `Product ${String(req.product_id)} not found` }
  await logCall(ctx, '/inventory/products/get', req, resp)
  return ok(resp)
}

async function createOrder(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, ORDER)
  if (isReply(req)) return req
  const order = {
    product_id: req.product_id!,
    quantity: req.quantity!,
    supplier: req.supplier!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'orders', order)
  const resp = { status: 'created', order }
  await logCall(ctx, '/inventory/orders/create', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), orders: await load(ctx.db, 'orders') })
}

export function inventoryRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/inventory/products', listProducts, { write: true }),
    route<C>('POST', '/inventory/products/get', getProduct, { write: true }),
    route<C>('POST', '/inventory/orders/create', createOrder, { write: true }),
    route<C>('GET', '/inventory/audit', audit),
  ]
}
