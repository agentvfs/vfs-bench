import { type Grader, eq, like, containsAny, grade, lower, round } from '../../../workspace/grader.ts'
import { DB, response } from '../graders/smarthome.ts'
export const grader: Grader = (c) => {
    const eggRow =
      c
        .rows(DB, 'grocery_product')
        .filter(
          (r) =>
            (like(r.name, '%egg%') || like(r.product_id, '%egg%')) &&
            eq(r.quantity, 36.0) &&
            eq(r.unit, 'pieces')
        )[0] ??
      c
        .rows(DB, 'grocery_product')
        .filter(
          (r) =>
            (like(r.name, '%egg%') || like(r.product_id, '%egg%')) &&
            eq(r.quantity, 3.0) &&
            eq(r.unit, 'dozen')
        )[0]
    const egg = eggRow?.product_id
    let orders: any[] = []
    try {
      orders = c.json('/tmp/mosi_shop_orders.json')
    } catch {}
    const order = orders.find((o) =>
      (o.items ?? []).some(
        (i: any) =>
          (lower(i.product_id).includes('egg') || lower(i.title).includes('egg')) && i.quantity === 3
      )
    )
    const d1 = egg != null,
      d2 = order !== undefined,
      d3 =
        d1 &&
        order?.order_id != null &&
        c.rows(DB, 'grocery_product').filter((r) => eq(r.product_id, egg))[0]?.reference === order.order_id
    const text = lower(response(c, true)),
      d4 =
        containsAny(text, ['round', 'rounding', 'convert', 'conversion', 'adjust', 'up to', 'instead of']) ||
        (text.includes('dozen') && text.includes('only') && (/\b3\b/.test(text) || text.includes('three')))
    let d5 = false
    if (d1 && d2 && d3)
      d5 = (
        [
          ['PROD001', 'gallon', 'ORD000001'],
          ['PROD002', 'lb', 'ORD000002'],
        ] as const
      ).every(([id, unit, ref]) => {
        const r = c.rows(DB, 'grocery_product').filter((r) => eq(r.product_id, id))[0]
        return r?.quantity === 1 && r.unit === unit && r.reference === ref
      })
    const score = round(
      (d1 ? 0.25 : 0) + (d2 ? 0.25 : 0) + (d3 ? 0.25 : 0) + (d4 ? 0.15 : 0) + (d5 ? 0.1 : 0),
      2
    )
    return {
      ...grade(score, { D1: d1, D2: d2, D3: d3, D4: d4, D5: d5 }),
      rewards: { reward: score },
      artifacts: {
        'reward_details.json': {
          _meta_dimensions: {
            D1: d1 ? 'PASS' : 'FAIL',
            D2: d2 ? 'PASS' : 'FAIL',
            D3: d3 ? 'PASS' : 'FAIL',
            D4: d4 ? 'PASS' : 'FAIL',
            D5: d5 ? 'PASS' : 'SKIPPED',
          },
        },
      },
    }
  }
