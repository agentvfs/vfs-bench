/**
 * LightShop (`software/LightShop/shop.py`): shops and their items, a cart
 * and a balance, generated from the session's seed, and the app's tools,
 * statement for statement. Paying takes the payment password first, which
 * one time in ten is entered wrong.
 */
import { type Os, clone, corpus, sorted, uuid } from './common.ts'
import { type PyFloat, type PyNum, add, div, int, levSim, mul, num, sub } from './py.ts'
import { PyRandom } from './pyrandom.ts'
import type { RandomState } from './pyrandom.ts'
import { type App, type Tools, failed, ok } from './tool.ts'

interface Item {
  tid: string
  name: string
  price: PyFloat
  star: boolean
}

interface Shop {
  sid: string
  name: string
  category: string
  items: Record<string, Item>
  count: Record<string, number>
  star: boolean
}

interface CartItem {
  caid: string
  sid: string
  tid: string
  count: number
}

interface Transaction {
  timestamp: string
  trid: string
  total: PyNum
  info: Record<string, Record<string, number>>
}

export interface ShopData {
  shops: Record<string, Shop>
  my_balance: PyNum
  cart: CartItem[]
  trans_history: Transaction[]
  my_starred_shops: string[]
  my_starred_items: [string, string][]
  enter_password: boolean
  rng: RandomState
}

export class ShopSession {
  d: ShopData
  rng: PyRandom
  os: Os

  constructor(d: ShopData, os: Os) {
    this.d = d
    this.rng = PyRandom.from(d.rng)
    this.os = os
  }

  /** `ShopSession(seed, os_cfg)`. */
  static async create(seed: number, os: Os): Promise<ShopSession> {
    const rng = new PyRandom(seed)
    const shops: Record<string, Shop> = {}
    const config = corpus<{ shops: { category: string; shop_names: string[]; items: string[] }[] }>('LightShop', 'shop.yaml')
    for (const cfg of config.shops) {
      const count = rng.randint(0, 3)
      for (const name of rng.sample(cfg.shop_names, count)) {
        const k = rng.randint(5, cfg.items.length)
        const items: Record<string, Item> = {}
        const counts: Record<string, number> = {}
        for (const line of rng.sample(cfg.items, k)) {
          const [itemName, price] = line.split('=') as [string, string]
          const scaled = Number(price.trim()) * rng.uniform(0.6, 1.2)
          const item: Item = { tid: `item_${uuid(rng)}`, name: itemName.trim(), price: div(int(100 * scaled), 100), star: false }
          items[item.tid] = item
          counts[item.tid] = rng.randint(0, 100)
        }
        const shop: Shop = { sid: `shop_${uuid(rng)}`, name, category: cfg.category, items, count: counts, star: false }
        shops[shop.sid] = shop
      }
    }
    const d: ShopData = {
      shops,
      my_balance: rng.randint(8000, 100000),
      cart: [],
      trans_history: [],
      my_starred_shops: [],
      my_starred_items: [],
      enter_password: false,
      rng: [[], null],
    }
    const s = new ShopSession(d, os)
    s.rng = rng
    // `__mock_cart`
    if (rng.uniform(0, 1) >= 0.4) {
      const shop = rng.choice(Object.values(shops))
      for (const item of rng.sample(Object.values(shop.items), rng.randint(1, 5))) s.addToCart(shop.sid, item.tid, 1)
    }
    return s
  }

  data(): ShopData {
    return { ...this.d, rng: this.rng.getstate() }
  }

  shop(sid: string): [Shop | null, ReturnType<typeof failed<string>> | null] {
    const shop = this.d.shops[sid]
    return shop ? [shop, null] : [null, failed(`Shop with ID ${sid} not found.`)]
  }

  addToCart(sid: string, tid: string, cnt: number) {
    const [shop, err] = this.shop(sid)
    if (err) return err
    const item = shop!.items[tid]
    if (item === undefined) return failed(`Item with ID ${tid} not found in shop '${shop!.name}' (ID: ${shop!.sid}).`)
    if (shop!.count[tid]! < cnt) {
      return failed(`Shop '${shop!.name}' (ID: ${shop!.sid}) has ${shop!.count[tid]} of '${item.name}' (ID: ${tid}), which is less than the requested ${cnt}.`)
    }
    shop!.count[tid] = shop!.count[tid]! - cnt
    this.d.cart.push({ caid: `cart_${uuid(this.rng)}`, sid, tid, count: cnt })
    return ok(`Added ${cnt} × '${item.name}' (ID: ${tid}) to your cart.`)
  }
}

const itemRow = (item: Item, shop?: Shop) => ({ tid: item.tid, name: item.name, price: item.price, ...(shop ? { shop: shop.name } : {}) })

/** Every item whose name matches, as `search_items` and its kin list them. */
function searchItems(match: (name: string) => boolean, shops: Shop[], withShop: boolean) {
  const out = []
  for (const shop of shops) {
    for (const item of Object.values(shop.items)) {
      if (match(item.name.toLowerCase())) out.push(itemRow(item, withShop ? shop : undefined))
    }
  }
  return out
}

const tools: Tools<ShopSession> = {
  list_all_shop_categories: {
    params: [],
    run: async (s) => ok(sorted([...new Set(Object.values(s.d.shops).map((x) => x.category))])),
  },
  list_all_shops_by_category: {
    params: [['category', 'str']],
    run: async (s, { category }) => ok(sorted(Object.values(s.d.shops).filter((x) => x.category === category).map((x) => x.name))),
  },
  get_shop_id_by_name: {
    params: [['shop_name', 'str']],
    run: async (s, { shop_name }) => {
      const shop = Object.values(s.d.shops).find((x) => x.name === shop_name)
      return shop ? ok(shop.sid) : failed(`Shop named ${shop_name} not found.`)
    },
  },
  list_items: {
    params: [['sid', 'str']],
    run: async (s, { sid }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      return ok(sorted(Object.values(shop!.items).map(clone), (x) => x.name))
    },
  },
  add_to_cart: { params: [['sid', 'str'], ['tid', 'str'], ['cnt', 'int']], run: async (s, { sid, tid, cnt }) => s.addToCart(sid, tid, cnt) },
  get_item_info: {
    params: [['sid', 'str'], ['tid', 'str']],
    run: async (s, { sid, tid }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      const item = shop!.items[tid]
      if (item === undefined) return failed(`Item with ID ${tid} not found in shop '${shop!.name}' (ID: ${sid})`)
      return ok({ name: item.name, price: item.price, count: shop!.count[tid] })
    },
  },
  delete_item_in_cart: {
    params: [['caid', 'str']],
    run: async (s, { caid }) => {
      const i = s.d.cart.findIndex((c) => c.caid === caid)
      if (i >= 0) {
        const c = s.d.cart[i]!
        const shop = s.d.shops[c.sid]!
        shop.count[c.tid] = shop.count[c.tid]! + c.count
        s.d.cart.splice(i, 1)
        return ok(`Removed item (ID: ${caid}) from your cart.`)
      }
      return failed(`Item with ID ${caid} not found in your cart.`)
    },
  },
  check_balance: { params: [], run: async (s) => ok(s.d.my_balance) },
  checkout_all: {
    params: [],
    run: async (s) => {
      if (!s.d.enter_password) return failed('This operation requires the user to enter their payment password first.')
      s.d.enter_password = false
      if (s.d.cart.length === 0) return failed('Your cart is empty.')
      let total: PyNum = 0
      const info: Record<string, Record<string, number>> = {}
      for (const c of s.d.cart) {
        ;(info[c.sid] ??= {})[c.tid] = c.count
        total = add(total, mul(s.d.shops[c.sid]!.items[c.tid]!.price, c.count))
      }
      if (num(total) > num(s.d.my_balance)) return failed('Insufficient balance.')
      s.d.my_balance = sub(s.d.my_balance, total)
      const trans: Transaction = { timestamp: await s.os.step(), trid: `trans_${uuid(s.rng)}`, total, info }
      s.d.trans_history.push(trans)
      s.d.cart = []
      return ok(`Checkout successful. Transaction ID: ${trans.trid}.`)
    },
  },
  get_trans_history: { params: [], run: async (s) => ok(clone(s.d.trans_history)) },
  get_cart_summary: { params: [], run: async (s) => ok(clone(s.d.cart)) },
  search_shops: {
    params: [['shop_name', 'str']],
    run: async (s, { shop_name }) => ({
      status: 'ok',
      results: Object.values(s.d.shops)
        .filter((x) => x.name.toLowerCase().includes((shop_name as string).toLowerCase()))
        .map((x) => `${x.name} (${x.sid})`),
    }),
  },
  fuzzy_search_shops: {
    params: [['shop_name', 'str']],
    run: async (s, { shop_name }) => {
      const q = (shop_name as string).toLowerCase()
      return ok(
        Object.values(s.d.shops)
          .filter((x) => x.name.toLowerCase().includes(q) || levSim(x.name.toLowerCase(), q) > 0.6)
          .map((x) => `${x.name} (${x.sid})`),
      )
    },
  },
  search_items: {
    params: [['item_name', 'str']],
    run: async (s, { item_name }) => {
      const q = (item_name as string).toLowerCase()
      return ok(searchItems((n) => n.includes(q), Object.values(s.d.shops), true))
    },
  },
  fuzzy_search_items: {
    params: [['item_name', 'str']],
    run: async (s, { item_name }) => {
      const q = (item_name as string).toLowerCase()
      return ok(searchItems((n) => n.includes(q) || levSim(q, n) > 0.4, Object.values(s.d.shops), true))
    },
  },
  search_items_in_shop: {
    params: [['sid', 'str'], ['item_name', 'str']],
    run: async (s, { sid, item_name }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      const q = (item_name as string).toLowerCase()
      return ok(searchItems((n) => n.includes(q), [shop!], false))
    },
  },
  fuzzy_search_items_in_shop: {
    params: [['sid', 'str'], ['item_name', 'str']],
    run: async (s, { sid, item_name }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      const q = (item_name as string).toLowerCase()
      return ok(searchItems((n) => n.includes(q) || levSim(q, n) > 0.6, [shop!], false))
    },
  },
  get_trans_info: {
    params: [['trid', 'str']],
    run: async (s, { trid }) => {
      const t = s.d.trans_history.find((x) => x.trid === trid)
      return t ? ok(clone(t)) : failed(`Transaction with ID (${trid}) not found`)
    },
  },
  delete_trans_history: {
    params: [['trid', 'str']],
    run: async (s, { trid }) => {
      const i = s.d.trans_history.findIndex((x) => x.trid === trid)
      if (i >= 0) {
        s.d.trans_history.splice(i, 1)
        return ok(`You have successfully deleted one transaction history (TRID=${trid})`)
      }
      return failed(`Transaction history with TRID=${trid} not found`)
    },
  },
  star_shop: {
    params: [['sid', 'str']],
    run: async (s, { sid }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      if (shop!.star) return failed(`You have already starred the shop ${shop!.name} (${shop!.sid})`)
      shop!.star = true
      if (!s.d.my_starred_shops.includes(shop!.sid)) s.d.my_starred_shops.push(shop!.sid)
      return ok(`You have successfully starred the shop ${shop!.name} (${shop!.sid})`)
    },
  },
  unstar_shop: {
    params: [['sid', 'str']],
    run: async (s, { sid }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      if (!shop!.star) return failed(`The shop ${shop!.name} (${shop!.sid}) is not starred.`)
      shop!.star = false
      s.d.my_starred_shops = s.d.my_starred_shops.filter((x) => x !== shop!.sid)
      return ok(`You have successfully unstarred the shop ${shop!.name} (${shop!.sid})`)
    },
  },
  star_item: {
    params: [['sid', 'str'], ['tid', 'str']],
    run: async (s, { sid, tid }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      const item = shop!.items[tid]
      if (item === undefined) return failed(`Item with ID ${tid} not found in shop '${shop!.name}' (ID: ${shop!.sid}).`)
      if (item.star) return failed(`You have already starred the item '${item.name}' (ID: ${tid}) in shop '${shop!.name}' (ID: ${shop!.sid}).`)
      item.star = true
      if (!s.d.my_starred_items.some(([a, b]) => a === sid && b === tid)) s.d.my_starred_items.push([sid, tid])
      return ok(`You have successfully starred the item '${item.name}' (ID: ${tid}) in shop '${shop!.name}' (ID: ${shop!.sid}).`)
    },
  },
  unstar_item: {
    params: [['sid', 'str'], ['tid', 'str']],
    run: async (s, { sid, tid }) => {
      const [shop, err] = s.shop(sid)
      if (err) return err
      const item = shop!.items[tid]
      if (item === undefined) return failed(`Item with ID ${tid} not found in shop '${shop!.name}' (ID: ${shop!.sid}).`)
      if (!item.star) return failed(`The item '${item.name}' (ID: ${tid}) in shop '${shop!.name}' (ID: ${shop!.sid}) is not starred.`)
      item.star = false
      s.d.my_starred_items = s.d.my_starred_items.filter(([a, b]) => !(a === sid && b === tid))
      return ok(`You have successfully unstarred the item '${item.name}' (ID: ${tid}) in shop '${shop!.name}' (ID: ${shop!.sid}).`)
    },
  },
  get_starred_shops: {
    params: [],
    run: async (s) =>
      ok(s.d.my_starred_shops.map((sid) => ({ sid, shop_name: s.d.shops[sid]!.name, category: s.d.shops[sid]!.category }))),
  },
  get_my_starred_items: {
    params: [],
    run: async (s) =>
      ok(
        s.d.my_starred_items.map(([sid, tid]) => {
          const item = s.d.shops[sid]!.items[tid]!
          return { sid, tid, item_name: item.name, price: item.price }
        }),
      ),
  },
  wait_payment_password: {
    params: [],
    run: async (s) => {
      if (s.rng.uniform(0, 1) < 0.1) return { status: 'internal error', output: 'Incorrect password, please try again.' }
      s.d.enter_password = true
      return ok('The user has entered the correct payment password.')
    },
  },
}

export const LightShop: App<ShopSession, ShopData> = {
  name: 'LightShop',
  tools,
  load: (data, os) => new ShopSession(data, os),
  save: (s) => s.data(),
  sessionDict: (s) => ({
    shops: clone(s.d.shops),
    cart: sorted(clone(s.d.cart), (c) => c.caid),
    trans_history: clone(s.d.trans_history),
  }),
}

