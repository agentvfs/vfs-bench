/**
 * The OCR fake's routes: upstream's `server.py`, each statement kept, over
 * the run's lists. `ocr` is one doc, the text upstream loads at start from
 * the task's files; `call_log` is upstream's `_call_log`, which records each
 * extract's request but not its reply, so it is a list of its own rather
 * than the audit log the other services share.
 */
import { route } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import type { Ctx, KitRoute, Reply } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { append, isReply, load, model, ok, opt, pyNow } from '../claweval/store.ts'
import type { C } from './config.ts'

const EXTRACT = { image_path: opt('') }

async function ocrExtract(ctx: Ctx<C>): Promise<Reply> {
  const req = model(ctx, EXTRACT)
  if (isReply(req)) return req
  await append(ctx.db, 'call_log', { endpoint: '/ocr/extract', request_body: req, timestamp: pyNow(ctx) })
  const text = (await load(ctx.db, 'ocr'))[0]?.text ?? ''
  return ok({ text, confidence: 0.95, language: 'mixed' })
}

function health(): Reply {
  return ok({ status: 'ok', service: 'ocr' })
}

async function audit(ctx: Ctx<C>): Promise<Reply> {
  return ok({ calls: await load(ctx.db, 'call_log') })
}

export function ocrRoutes(): KitRoute<C>[] {
  return [
    route<C>('POST', '/ocr/extract', ocrExtract, { write: true }),
    route<C>('GET', '/ocr/health', health),
    route<C>('GET', '/ocr/audit', audit),
  ]
}
