/**
 * The Gmail drafts fake's routes: upstream's `save_draft` and `get_audit`
 * (mock_services/gmail/server.py), each statement kept. A Claw-Eval task's
 * mailbox is Mirage's gws fake, which has no drafts (integ/server/gws/fake.ts
 * lists "no threads or drafts resources at all"), so `gmail_save_draft`
 * stays upstream's tool and this is its service. `drafts` is upstream's
 * `_drafts`; `/gmail/audit`'s `calls` are this service's alone, and its
 * `sent` is empty: a task's reads and sends are the gws run's, which the
 * verifier adds to this audit (harbor/claweval_grade.py).
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { REQUIRED, append, calls, isReply, load, logCall, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { C } from './config.ts'

const SAVE_DRAFT = { to: REQUIRED, subject: REQUIRED, body: REQUIRED, reply_to_message_id: opt(null) }

async function saveDraft(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, SAVE_DRAFT)
  if (isReply(req)) return req
  const draft = {
    to: req.to!,
    subject: req.subject!,
    body: req.body!,
    reply_to_message_id: req.reply_to_message_id!,
    timestamp: pyNow(ctx),
  }
  await append(ctx.db, 'drafts', draft)
  const resp = { status: 'draft_saved', draft }
  await logCall(ctx, '/gmail/drafts/save', req, resp)
  return ok(resp)
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await calls(ctx.db), sent: [], drafts: await load(ctx.db, 'drafts') })
}

export function gmailRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/gmail/drafts/save', saveDraft, { write: true }),
    route<C>('GET', '/gmail/audit', audit),
  ]
}
