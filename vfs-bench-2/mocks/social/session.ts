/**
 * mock-lib's JWT session (packages/mock-lib/src/auth/jwt.ts) and one-shot
 * faults (src/fault-injection.ts), scoped to the run. Upstream's handlers
 * and mock-lib's own `authRequired` and `authOptional` call these in place
 * of mock-lib's (app.ts).
 *
 * Upstream signs `{userId, iat, exp}` with HS256 under a secret its process
 * draws at start. Here the secret is the run's, drawn on the run's first
 * request and forgotten on its reset, so a session from one run, or from
 * before a reset, is refused by every other as one from another process is.
 * `iat` and `exp` read the request's time. The cookie's options are
 * mock-lib's outside development and tests: `Secure`, `SameSite=Strict`, an
 * hour.
 *
 * Upstream fires each fault once per process, which is once per run here.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { C } from './config.ts'
import { type RunMemory, request } from './sqlite.ts'

const memory = new WeakMap<C, RunMemory>()

/** The run's secret and faults, made on its first request. */
export function of(db: C): RunMemory {
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

/** mock-lib's `getTokenExpirySeconds()`. */
function expirySeconds(): number {
  const env = Number(process.env.MOCK_TOKEN_EXPIRY_SECONDS)
  return Number.isFinite(env) && env > 0 ? env : 3600
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url')

function signature(secret: string, data: string): Buffer {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(data).digest()
}

const nowSeconds = () => Math.floor(request().nowMs / 1000)

/** mock-lib's `sign()`. */
export async function sign(payload: Record<string, unknown>): Promise<string> {
  const now = nowSeconds()
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + expirySeconds() }))
  return `${header}.${body}.${b64url(signature(request().run.secret, `${header}.${body}`))}`
}

/** mock-lib's `verify()`: the payload, or null for a bad, foreign or expired token. */
export async function verify(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts as [string, string, string]
  try {
    const given = Buffer.from(sig, 'base64url')
    const expected = signature(request().run.secret, `${header}.${body}`)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    const exp = payload.exp as number | undefined
    if (exp && exp < nowSeconds()) return null
    return payload
  } catch {
    return null
  }
}

/** mock-lib's `tokenCookieOptions()`, not in development or tests. */
export function tokenCookieOptions() {
  return { httpOnly: true, secure: true, sameSite: 'Strict' as const, maxAge: expirySeconds(), path: '/' }
}

/** The faults mock-lib registers for the social mock (its REGISTERED_FAULTS). */
const REGISTERED = new Set([
  'social-post-rate-limit::social::POST /api/posts::c1-rate-limit',
  'social-unlike-verify::social::POST /api/posts/:id/like::c2-skip-unlike',
])

/** mock-lib's `shouldInject`, for this run: true the first time only. */
export function shouldInject(taskName: string, service: string, route: string, faultId: string): boolean {
  const key = `${taskName}::${service}::${route}::${faultId}`
  const { fired } = request().run
  if (!REGISTERED.has(key) || fired.has(key)) return false
  fired.add(key)
  return true
}

/** mock-lib's `startServer`, which the fake never calls: the kit serves. */
export function startServer(): never {
  throw new Error('the social fake is served by the kit')
}
