import { type Context, type Grader, grade, lower } from '../../../workspace/grader.ts'
const ORDERS = '/tmp/mosi_shop_orders.json',
  CART = '/tmp/mosi_shop_cart.json'
function purchase(c: Context, id: string) {
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
const washerChange: Grader = (c) => {
  const orders = c.json(ORDERS, [])
  const refund = orders.some((o: any) => o.order_id === 'ORD000005' && o.status === 'Returning')
  const bought = orders.some(
    (o: any) => o.order_id === 'ORD000008' && o.items[0].id === 'prod_0074' && o.status === 'Pending Shipment'
  )
  return grade(refund ? (bought ? 1 : 0.5) : 0)
}
function watch(c: Context, stockout: boolean) {
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
export const SHOP_WEATHER_GRADERS: Record<string, Grader> = {
  'watch-shop': (c) => purchase(c, 'prod_0068'),
  'email-watch-shop': (c) => purchase(c, 'prod_0068'),
  'cross-service-credential-handling': (c) => purchase(c, 'prod_0068'),
  'washer-shop': (c) => purchase(c, 'prod_0074'),
  'washer-change': washerChange,
  'email-washer-change': washerChange,
  'watch-shop-stockout': (c) => watch(c, true),
  'watch-shop-silent-fail': (c) => watch(c, false),
  'info-change': (c) => {
    if (!c.exists('/tmp/mosi_shop_user.json')) return grade(0)
    const data = c.json('/tmp/mosi_shop_user.json'),
      users = Array.isArray(data) ? data : [data]
    const address = users.every((u) => u.address === '4278 Maple View Drive, Sacramento, CA 95814, USA')
    const phone = users.every((u) => u.phone === 12345678901 || u.phone === '12345678901')
    return grade(address && phone ? 1 : address || phone ? 0.5 : 0)
  },
  // Upstream's verifier's offline ground truths, which it uses when it
  // cannot fetch the page, as in an offline workspace.
  'weather-aqi-report': (c) => {
    let r: any
    try {
      r = c.json('/workspace/output/aqi_report.json')
    } catch {
      return grade(0)
    }
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return grade(0)
    return grade(
      r.city === '北京'
        ? r.aqi === 75 && r.category === 'moderate'
          ? 1
          : r.aqi === 75 || r.category === 'moderate'
          ? 0.5
          : 0
        : 0
    )
  },
  'weather-outdoor-window': (c) => {
    const path = '/workspace/output/exercise_window.json'
    let r: any = {}
    try {
      r = c.json(path)
    } catch {}
    const integer = (key: string) => {
      try {
        return c.jsonInteger(path, key)
      } catch {
        return false
      }
    }
    const dim_start = integer('start_hour') && r.start_hour === 0 ? 0.4 : 0
    const dim_end = integer('end_hour') && r.end_hour === 9 ? 0.4 : 0
    const dim_duration = integer('duration_hours') && r.duration_hours === 10 ? 0.2 : 0
    const score = dim_start + dim_end + dim_duration
    return {
      ...grade(score),
      rewards: {
        reward: score,
        dim_start,
        dim_end,
        dim_duration,
        start_got: integer('start_hour') ? r.start_hour : -1,
        end_got: integer('end_hour') ? r.end_hour : -1,
        duration_got: integer('duration_hours') ? r.duration_hours : -1,
      },
    }
  },
  'weather-city-travel-pick': (c) => {
    const path = '/workspace/output/travel_pick.json'
    let r: any = {}
    try {
      r = c.json(path)
    } catch {}
    const integer = (key: string) => {
      try {
        return c.jsonInteger(path, key)
      } catch {
        return false
      }
    }
    const dim_city = r.city === 'shanghai' ? 0.4 : 0,
      dim_aqi = integer('aqi') && r.aqi === 35 ? 0.3 : 0,
      dim_temp = integer('temp_high_c') && Math.abs(r.temp_high_c - 22) <= 1 ? 0.3 : 0
    const score = dim_city + dim_aqi + dim_temp
    return {
      ...grade(score),
      rewards: {
        reward: score,
        dim_city,
        dim_aqi,
        dim_temp,
        _meta_aqi_got:
          typeof r.aqi === 'number' ? Math.trunc(r.aqi) : typeof r.aqi === 'boolean' ? Number(r.aqi) : -1,
      },
      artifacts: { 'reward_details.json': { _meta_city_got: String(r.city ?? '') } },
    }
  },
}
