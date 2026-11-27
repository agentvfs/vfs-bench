// Point the Google Calendar MCP server at mirage's mock Google Workspace.
//
// `@gongrzhe/server-calendar-autoauth-mcp` reaches Google through exactly
// five calls -- `calendar.events.{insert,get,patch,delete,list}` -- on a
// client built by `google.calendar({version: 'v3', auth})`. Every generated
// googleapis method takes an options object as its second argument and
// reads `rootUrl` out of it, defaulting to `https://www.googleapis.com/`.
// So the redirect is one merged option per call: nothing about the server's
// tools, schemas, argument handling or error text changes, and the bytes
// come from the same fixture the mirage arm's `gws calendar` reads.
//
// Wrapping `rootUrl` rather than the global `fetch` is deliberate.
// googleapis has changed transports between majors -- node-fetch, gaxios,
// the platform fetch -- and a hook that patches the transport silently
// stops intercepting when the pin moves. `rootUrl` is part of the generated
// API's own contract.
//
// Loaded with `node --import`, so the patch is in place before the server
// builds its client:
//
//     GWS_MOCK_URL=http://127.0.0.1:19999 \
//       node --import ./redirect/gws_calendar/calendar_hook.mjs \
//         <server>/build/index.js
//
// The evaluator spawns the server from Toolathlon's own yaml, where there is
// no place to add a flag, so there it arrives through NODE_OPTIONS instead --
// which means it is also loaded into `npx` itself and any other node process
// on the way. Hence the resolution below: googleapis is looked up from the
// script actually being run, and a process that has no googleapis is left
// alone rather than being made to fail.

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const base = process.env.GWS_MOCK_URL
if (!base) throw new Error('GWS_MOCK_URL is not set')
const rootUrl = base.endsWith('/') ? base : `${base}/`

// googleapis is CommonJS, so this is the same module instance the server's
// own `import { google } from 'googleapis'` resolves to.
function loadGoogle() {
  const entry = process.argv[1]
  if (entry === undefined) return null
  try {
    return createRequire(pathToFileURL(entry)).call(null, 'googleapis').google
  } catch {
    return null
  }
}

// A generated method is `(params, options, callback)`, and every overload
// resolves through the same first-two-arguments shape: an object second
// argument is options, a function is a callback and options are absent.
function redirect(method, self) {
  return function (params, optionsOrCallback, callback) {
    if (typeof optionsOrCallback === 'function' || optionsOrCallback === undefined) {
      return method.call(self, params, { rootUrl }, optionsOrCallback ?? callback)
    }
    return method.call(self, params, { rootUrl, ...optionsOrCallback }, callback)
  }
}

// The client is a tree of resources (`events`, `calendars`, `acl`, ...),
// assigned in the constructor so they are own properties; their methods are
// `class Resource$Events { async insert() {} }`, so they live on the
// prototype and `Object.entries` does not see them. Shadowing each one with
// an own property is what makes the redirect stick.
function redirectAll(api) {
  for (const resource of Object.values(api)) {
    if (resource === null || typeof resource !== 'object') continue
    const proto = Object.getPrototypeOf(resource)
    const names = new Set([
      ...Object.keys(resource),
      ...(proto === null ? [] : Object.getOwnPropertyNames(proto)),
    ])
    for (const name of names) {
      if (name === 'constructor') continue
      const method = resource[name]
      if (typeof method !== 'function') continue
      resource[name] = redirect(method, resource)
    }
  }
  return api
}

const google = loadGoogle()
if (google !== null) {
  const build = google.calendar.bind(google)
  google.calendar = (...args) => redirectAll(build(...args))
}
