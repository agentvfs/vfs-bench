/**
 * The finance fake's login: mock-lib's JWT session (packages/mock-lib/src/auth),
 * scoped to the run.
 *
 * Upstream signs `{userId, role, iat, exp}` with HS256 under a secret its
 * process draws at start, sets it as the `token` cookie, and takes it back
 * from the `Cookie` header or, failing that, `Authorization: Bearer`. Here
 * the secret is the run's, drawn on the run's first login and forgotten on
 * its reset, so a session from one run, or from before a reset, is refused
 * by every other as one from another process is. `iat` and `exp` read the
 * run's frozen clock.
 *
 * The run's one-shot faults (mock-lib's `shouldInject`) live with it too:
 * upstream fires each once per process, which is once per run here.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { Ctx } from '../../../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { TOKEN_EXPIRY_SECONDS } from './config.ts'
import type { C } from './config.ts'

interface RunMemory {
  /** mock-lib's `generateSecret()`: 64 random bytes, as hex. */
  secret: string
  /** The faults that have fired. */
  fired: Set<string>
}

const memory = new WeakMap<C, RunMemory>()

function of(db: C): RunMemory {
  let held = memory.get(db)
  if (held === undefined) {
    held = { secret: randomBytes(64).toString('hex'), fired: new Set() }
    memory.set(db, held)
  }
  return held
}

/** Forget a run's secret and faults, as a restarted mock would. */
export function forget(db: C): void {
  memory.delete(db)
}

/** mock-lib's `shouldInject`, for this run: true the first time only. */
export function shouldInject(db: C, key: string): boolean {
  const { fired } = of(db)
  if (fired.has(key)) return false
  fired.add(key)
  return true
}

/** The run's now, in whole seconds, without a tick. */
const nowSeconds = (ctx: Ctx<C>) => Math.floor(Date.parse(ctx.clock.lastIso()) / 1000)

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url')

function signature(secret: string, data: string): Buffer {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(data).digest()
}

/** mock-lib's `sign()`. */
export function sign(ctx: Ctx<C>, payload: Record<string, unknown>): string {
  const now = nowSeconds(ctx)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_EXPIRY_SECONDS }))
  return `${header}.${body}.${b64url(signature(of(ctx.db).secret, `${header}.${body}`))}`
}

/** mock-lib's `verify()`: the payload, or null for a bad, foreign or expired token. */
export function verify(ctx: Ctx<C>, token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts as [string, string, string]
  const given = Buffer.from(sig, 'base64url')
  const expected = signature(of(ctx.db).secret, `${header}.${body}`)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    const exp = payload.exp as number | undefined
    if (exp && exp < nowSeconds(ctx)) return null
    return payload
  } catch {
    return null
  }
}

/** mock-lib's `extractToken`: the `token` cookie first, then a Bearer token. */
function token(ctx: Ctx<C>): string | null {
  const cookie = ctx.headers.cookie
  const header = Array.isArray(cookie) ? cookie.join('; ') : cookie
  if (header) {
    const match = /(?:^|;\s*)token=([^;]*)/.exec(header)
    if (match) return match[1]!
  }
  const auth = ctx.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7)
  return null
}

/** The signed-in user, as `authRequired` finds it, or why there is none. */
export function session(ctx: Ctx<C>): { userId: number | undefined } | 'missing' | 'invalid' {
  const raw = token(ctx)
  if (!raw) return 'missing'
  const payload = verify(ctx, raw)
  if (payload === null) return 'invalid'
  return { userId: payload.userId as number | undefined }
}

/** `authOptional`: the user, if a good token came. */
export function optionalUser(ctx: Ctx<C>): number | undefined {
  const found = session(ctx)
  return typeof found === 'object' ? found.userId : undefined
}

/** mock-lib's `tokenCookieOptions()` (not dev or test, so `Secure`), as Hono's `setCookie` writes them. */
export function tokenCookie(value: string, maxAge = TOKEN_EXPIRY_SECONDS): string {
  return `token=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`
}
