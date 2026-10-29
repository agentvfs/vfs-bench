/**
 * gaia2-cli's `shopping` app (apps/shopping.py), each command statement for
 * statement over the run's state, the hidden ENV commands included.
 *
 * State: `products` (product id -> {name, product_id, variants: {item id ->
 * {price, available, item_id, options}}}), `cart` (item id -> {item_id,
 * quantity, price, available, options}), `orders` (order id -> {order_id,
 * order_status, order_date, order_total, order_items}) and `discount_codes`
 * (item id -> {code: percent}).
 */
import { CliError, PyError, PyFloat, get, isFloat, jsonLoads, num, pf, slice, truthy, type Command, type Py, type PyDict } from '../gaia2/store.ts'
import { pyStr, typeName } from '../gaia2/pyrepr.ts'

const APP_NAME = 'Shopping'
export { APP_NAME }

type Call = Parameters<Command['run']>[0]

/** `_load_state`: the state, its four tables set where missing. */
async function loadState(c: Call): Promise<PyDict> {
  const state = await c.state()
  for (const key of ['products', 'cart', 'orders', 'discount_codes']) {
    if (!Object.hasOwn(state, key)) state[key] = {}
  }
  return state
}

const isDict = (v: unknown): v is PyDict => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat)

const table = (state: PyDict, key: string) => state[key] as Record<string, PyDict>

/** `_get_item`: an item merged with its product's name and id, or `{}`. */
function getItem(state: PyDict, itemId: string): PyDict {
  for (const [productId, product] of Object.entries(table(state, 'products'))) {
    const variants = get(product, 'variants', {}) as PyDict
    if (Object.hasOwn(variants, itemId)) {
      const item = variants[itemId]
      return { name: get(product, 'name', ''), product_id: productId, ...(isDict(item) ? item : {}) }
    }
  }
  return {}
}

/** `a + b` / `a - b` on Python numbers: an int unless either is a float. */
function arith(a: Py, b: number, sign: 1 | -1): number | PyFloat {
  const out = num(a) + sign * b
  return isFloat(a) ? pf(out) : out
}

/** Python's `<` on two strs: by code point. */
function codePointLess(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (d !== 0) return d
  }
  return x.length - y.length
}

/** `dict.update(other)` with a JSON value, failing as Python's does. */
function dictUpdate(target: PyDict, other: Py): void {
  if (isDict(other)) {
    for (const [k, v] of Object.entries(other)) target[k] = v
    return
  }
  let seq: Py[]
  if (Array.isArray(other)) seq = other
  else if (typeof other === 'string') seq = [...other]
  else throw new PyError('TypeError', `'${typeName(other)}' object is not iterable`)
  seq.forEach((element, i) => {
    let pair: Py[]
    if (Array.isArray(element)) pair = element
    else if (typeof element === 'string') pair = [...element]
    else if (isDict(element)) pair = Object.keys(element)
    else throw new PyError('TypeError', `cannot convert dictionary update sequence element #${i} to a sequence`)
    if (pair.length !== 2) throw new PyError('ValueError', `dictionary update sequence element #${i} has length ${pair.length}; 2 is required`)
    const [k, v] = pair as [Py, Py]
    if (Array.isArray(k) || isDict(k)) throw new PyError('TypeError', `unhashable type: '${typeName(k)}'`)
    target[pyStr(k)] = v
  })
}

export function commands(): Command[] {
  return [
    {
      name: 'list-all-products',
      async run(c) {
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 10)!
        const state = await loadState(c)
        const products = table(state, 'products')
        const byName = new Map<string, string>()
        for (const [pid, info] of Object.entries(products)) {
          if (!Object.hasOwn(info, 'name')) throw new PyError('KeyError', "'name'")
          byName.set(info.name as string, pid)
        }
        const sortedItems = [...byName.entries()].sort((a, b) => codePointLess(a[0], b[0]) || codePointLess(a[1], b[1]))
        const page: PyDict = {}
        for (const [name, pid] of slice(sortedItems, offset, offset + limit)) page[name] = pid
        const total = Object.keys(products).length
        const result = { products: page, metadata: { range: [offset, Math.min(offset + limit, total)], total } }
        await c.log('list_all_products', { offset, limit }, result)
        return { status: 'success', ...result }
      },
    },
    {
      name: 'get-product-details',
      async run(c) {
        const productId = c.str('product_id')!
        const state = await loadState(c)
        const products = table(state, 'products')
        if (!Object.hasOwn(products, productId)) throw new CliError('Product does not exist')
        const product = products[productId]!
        await c.log('get_product_details', { product_id: productId }, product)
        return { status: 'success', product }
      },
    },
    {
      name: 'search-products',
      async run(c) {
        const productName = c.str('product_name')!
        const offset = c.int('offset', 0)!
        const limit = c.int('limit', 10)!
        const state = await loadState(c)
        const products = table(state, 'products')
        const results: PyDict[] = []
        for (const info of Object.values(products)) {
          const name = get(info, 'name', '') as string
          if (name.toLowerCase().includes(productName.toLowerCase())) results.push(info)
        }
        const paginated = slice(results, offset, offset + limit)
        await c.log('search_product', { product_name: productName, offset, limit }, paginated)
        return { status: 'success', products: paginated }
      },
    },
    {
      name: 'add-to-cart',
      async run(c) {
        const itemId = c.str('item_id')!
        const quantity = c.int('quantity', 1)!
        const state = await loadState(c)
        if (quantity <= 0) throw new CliError('Quantity cannot be negative or zero')
        const item = getItem(state, itemId)
        if (!truthy(item)) throw new CliError('Product does not exist')
        if (!truthy(get(item, 'available', true))) throw new CliError('Product is not available')
        const cart = table(state, 'cart')
        if (Object.hasOwn(cart, itemId)) {
          cart[itemId]!.quantity = arith(cart[itemId]!.quantity!, quantity, 1)
        } else {
          cart[itemId] = {
            item_id: get(item, 'item_id', itemId),
            quantity,
            price: get(item, 'price', new PyFloat(0)),
            available: get(item, 'available', true),
            options: get(item, 'options', {}),
          }
        }
        await c.save(state)
        await c.log('add_to_cart', { item_id: itemId, quantity }, itemId, true)
        return { status: 'success', item_id: itemId, quantity: cart[itemId]!.quantity! }
      },
    },
    {
      name: 'remove-from-cart',
      async run(c) {
        const itemId = c.str('item_id')!
        const quantity = c.int('quantity', 1)!
        const state = await loadState(c)
        const cart = table(state, 'cart')
        if (quantity < 0) throw new CliError('Quantity cannot be negative')
        if (!Object.hasOwn(cart, itemId)) throw new CliError('Product not in cart')
        if (quantity > num(cart[itemId]!.quantity)) throw new CliError('Quantity exceeds available quantity')
        cart[itemId]!.quantity = arith(cart[itemId]!.quantity!, quantity, -1)
        if (num(cart[itemId]!.quantity) === 0) delete cart[itemId]
        await c.save(state)
        await c.log('remove_from_cart', { item_id: itemId, quantity }, itemId, true)
        return { status: 'success', item_id: itemId }
      },
    },
    {
      name: 'list-cart',
      async run(c) {
        const state = await loadState(c)
        const cart = table(state, 'cart')
        await c.log('list_cart', {}, cart)
        return { status: 'success', cart }
      },
    },
    {
      name: 'checkout',
      async run(c) {
        const discountCode = c.str('discount_code')
        const state = await loadState(c)
        const cart = table(state, 'cart')
        const discountCodes = table(state, 'discount_codes')
        if (!truthy(cart)) throw new CliError('Cart is empty')
        const useCode = discountCode !== null && discountCode.length > 0
        if (useCode) {
          for (const iid of Object.keys(cart)) {
            const itemDiscounts = get(discountCodes, iid, {}) as PyDict
            if (!Object.hasOwn(itemDiscounts, discountCode!)) {
              throw new CliError(`The provided discount code is not valid for the item with id - ${iid}`)
            }
          }
        }
        let orderTotal = 0
        for (const [iid, cartItem] of Object.entries(cart)) {
          const price = num(get(cartItem, 'price', new PyFloat(0)))
          const qty = num(get(cartItem, 'quantity', 1))
          let itemTotal = price * qty
          if (useCode) {
            const itemDiscounts = get(discountCodes, iid, {}) as PyDict
            const discountPct = num(get(itemDiscounts, discountCode!, new PyFloat(0)))
            itemTotal = itemTotal * (1 - discountPct / 100)
          }
          orderTotal += itemTotal
        }
        const orderId = c.uuidHex()
        const order: PyDict = {
          order_id: orderId,
          order_status: 'processed',
          order_date: c.now(),
          order_total: pf(orderTotal),
          order_items: { ...cart },
        }
        table(state, 'orders')[orderId] = order
        state.cart = {}
        await c.save(state)
        await c.log('checkout', { discount_code: discountCode }, orderId, true)
        return { status: 'success', order_id: orderId, total: pf(orderTotal) }
      },
    },
    {
      name: 'get-discount-code-info',
      async run(c) {
        const discountCode = c.str('discount_code')!
        const state = await loadState(c)
        const result: PyDict = {}
        for (const [iid, codes] of Object.entries(table(state, 'discount_codes'))) {
          if (Object.hasOwn(codes, discountCode)) result[iid] = codes[discountCode]!
        }
        await c.log('get_discount_code_info', { discount_code: discountCode }, result)
        return { status: 'success', discount_code: discountCode, info: result }
      },
    },
    {
      name: 'get-all-discount-codes',
      async run(c) {
        const state = await loadState(c)
        const discountCodes = table(state, 'discount_codes')
        await c.log('get_all_discount_codes', {}, discountCodes)
        return { status: 'success', discount_codes: discountCodes }
      },
    },
    {
      name: 'list-orders',
      async run(c) {
        const state = await loadState(c)
        const orders = table(state, 'orders')
        await c.log('list_orders', {}, orders)
        return { status: 'success', orders }
      },
    },
    {
      name: 'get-order-details',
      async run(c) {
        const orderId = c.str('order_id')!
        const state = await loadState(c)
        const orders = table(state, 'orders')
        if (!Object.hasOwn(orders, orderId)) throw new CliError('Order does not exist')
        const order = orders[orderId]!
        await c.log('get_order_details', { order_id: orderId }, order)
        return { status: 'success', order }
      },
    },
    {
      name: 'cancel-order',
      async run(c) {
        const orderId = c.str('order_id')!
        const state = await loadState(c)
        const orders = table(state, 'orders')
        if (!Object.hasOwn(orders, orderId)) throw new CliError('Order does not exist')
        const currentStatus = get(orders[orderId]!, 'order_status', '')
        if (currentStatus !== 'processed' && currentStatus !== 'shipped') {
          throw new CliError(`Order ${orderId} cannot be cancelled, current status: ${pyStr(currentStatus)}`)
        }
        orders[orderId]!.order_status = 'cancelled'
        await c.save(state)
        await c.log('cancel_order', { order_id: orderId }, orderId, true)
        return { status: 'success', order_id: orderId }
      },
    },
    // ENV commands (hidden, invoked by gaia2-eventd).
    {
      name: 'add-product',
      async run(c) {
        const name = c.str('name')!
        const state = await loadState(c)
        const productId = c.uuidHex()
        table(state, 'products')[productId] = { name, product_id: productId, variants: {} }
        await c.save(state)
        await c.log('add_product', { name }, productId, true)
        return { status: 'success', product_id: productId }
      },
    },
    {
      name: 'add-item-to-product',
      async run(c) {
        const productId = c.str('product_id')!
        const price = c.float('price')!
        const options = c.str('options', '{}')!
        const available = c.str('available', 'True')!
        const state = await loadState(c)
        const products = table(state, 'products')
        if (!Object.hasOwn(products, productId)) throw new CliError('Product does not exist')
        let parsedOptions: Py = {}
        if (options) {
          try {
            parsedOptions = jsonLoads(options)
          } catch (error) {
            if (!(error instanceof PyError && error.type === 'json.decoder.JSONDecodeError')) throw error
            parsedOptions = {}
          }
        }
        const avail = !['false', '0', 'no'].includes(available.toLowerCase())
        const itemId = c.uuidHex()
        const product = products[productId]!
        if (!Object.hasOwn(product, 'variants')) product.variants = {}
        ;(product.variants as PyDict)[itemId] = { item_id: itemId, price, available: avail, options: parsedOptions }
        await c.save(state)
        await c.log('add_item_to_product', { product_id: productId, price, options: parsedOptions, available: avail }, itemId, true)
        return { status: 'success', item_id: itemId }
      },
    },
    {
      name: 'update-item',
      async run(c) {
        const itemId = c.str('item_id')!
        const newPrice = c.float('new_price')
        const newAvailability = c.str('new_availability')
        if (newPrice === null && newAvailability === null) throw new CliError('No update provided')
        const state = await loadState(c)
        for (const product of Object.values(table(state, 'products'))) {
          const variants = get(product, 'variants', {}) as Record<string, PyDict>
          if (Object.hasOwn(variants, itemId)) {
            const item = variants[itemId]!
            if (newPrice !== null) item.price = newPrice
            if (newAvailability !== null) item.available = !['false', '0', 'no'].includes(newAvailability.toLowerCase())
            await c.save(state)
            await c.log('update_item', { item_id: itemId, new_price: newPrice, new_availability: newAvailability }, itemId, true)
            return { status: 'success', item_id: itemId }
          }
        }
        throw new CliError(`Item with id ${itemId} does not exist`)
      },
    },
    {
      name: 'add-discount-code',
      async run(c) {
        const itemId = c.str('item_id')!
        const discountCode = c.str('discount_code')!
        const state = await loadState(c)
        let found = false
        for (const product of Object.values(table(state, 'products'))) {
          if (Object.hasOwn(get(product, 'variants', {}) as PyDict, itemId)) {
            found = true
            break
          }
        }
        if (!found) throw new CliError(`Item ${itemId} does not exist in the inventory.`)
        let parsed: Py
        try {
          parsed = jsonLoads(discountCode)
        } catch (error) {
          if (!(error instanceof PyError && error.type === 'json.decoder.JSONDecodeError')) throw error
          throw new CliError('Invalid JSON for discount_code')
        }
        const codes = table(state, 'discount_codes')
        if (!Object.hasOwn(codes, itemId)) codes[itemId] = {}
        dictUpdate(codes[itemId]!, parsed)
        await c.save(state)
        await c.log('add_discount_code', { item_id: itemId, discount_code: parsed }, 'Successfully added the discount code', true)
        return { status: 'success', message: 'Successfully added the discount code' }
      },
    },
    {
      name: 'update-order-status',
      async run(c) {
        const orderId = c.str('order_id')!
        const status = c.str('status', 'shipped')!
        const state = await loadState(c)
        const orders = table(state, 'orders')
        if (!Object.hasOwn(orders, orderId)) throw new CliError('Order does not exist')
        if (!['processed', 'shipped', 'delivered', 'cancelled'].includes(status)) throw new CliError('Invalid status')
        orders[orderId]!.order_status = status
        await c.save(state)
        await c.log('update_order_status', { order_id: orderId, status }, orderId, true)
        return { status: 'success', order_id: orderId }
      },
    },
  ]
}
