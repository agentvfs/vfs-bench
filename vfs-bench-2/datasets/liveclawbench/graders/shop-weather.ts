import { type Context, type Grader, grade, lower } from '../../../workspace/grader.ts'
const ORDERS = '/tmp/mosi_shop_orders.json',
  CART = '/tmp/mosi_shop_cart.json'
export function purchase(c: Context, id: string) {
  const orders = c.json(ORDERS, [])
  if (
    orders.some(
      (o: any) => o.order_id === 'ORD000008' && o.items[0].id === id && o.status === 'Pending Shipment'
    )
  )
    return grade(1)
  const cart = c.json(CART, [])
  return grade(cart.length === 1 && cart[0].id === id ? 0.5 : 0)
}
export const washerChange: Grader = (c) => {
  const orders = c.json(ORDERS, [])
  const refund = orders.some((o: any) => o.order_id === 'ORD000005' && o.status === 'Returning')
  const bought = orders.some(
    (o: any) => o.order_id === 'ORD000008' && o.items[0].id === 'prod_0074' && o.status === 'Pending Shipment'
  )
  return grade(refund ? (bought ? 1 : 0.5) : 0)
}
export function watch(c: Context, stockout: boolean) {
  let orders: any[]
  try {
    orders = c.json(ORDERS)
  } catch {
    return grade(0)
  }
  let score = 0
  for (const order of orders) {
    const items = order.items ?? []
    if (stockout && items.some((i: any) => i.product_id === 'prod_0068' || i.id === 'prod_0068')) continue
    if (items.some((i: any) => lower(i.title).includes('watch')))
      score = Math.max(
        score,
        ['Pending Shipment', 'Shipped', 'Delivered', 'Completed'].includes(order.status) ? 1 : 0.3
      )
  }
  return grade(score)
}
