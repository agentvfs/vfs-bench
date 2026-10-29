/**
 * The social fake: LiveClawBench's social mock on Mirage's integ kit.
 *
 * Every path goes to upstream's own app (app.ts), which answers it as
 * upstream's mock does: mock-lib's health check, the probe, the API, the
 * pages, then Hono's 404. A run's world is its fixture's rows, seeded by the
 * kit (`/reset`), keyed by upstream's table names; a reset also forgets the
 * run's sessions and faults, as a restarted mock would.
 *
 * Prisma cannot state upstream's CHECK constraints, so each run's file gets
 * them as triggers once seeded: a write that one would refuse aborts, and
 * upstream's error handler answers it 500, as upstream's does.
 */
import type { Dmmf, Fake } from '../../submodule/mirage/integ/server/kit/typescript/index.ts'
import { socialRoutes } from './app.ts'
import { SocialClient, config } from './config.ts'
import type { C } from './config.ts'
import { Prisma } from './client/index.js'
import { forget } from './session.ts'

const dmmf = Prisma.dmmf as unknown as Dmmf

/** Upstream's CHECK constraints (db.ts), by table, each on the row a write leaves (`NEW`). */
const CHECKS: Record<string, string[]> = {
  account: ["NEW.account_type IN ('company', 'personal', 'creator', 'partner')"],
  post: [
    "NEW.status IN ('draft', 'scheduled', 'published', 'deleted')",
    "NEW.visibility IN ('public', 'followers_only', 'unlisted')",
    "NEW.moderation_state IN ('clear', 'flagged')",
  ],
  post_asset: ["NEW.asset_type IN ('image', 'video', 'link_preview')"],
  post_action_log: [
    "NEW.action_type IN ('created', 'updated', 'scheduled', 'published', 'deleted', 'pinned', 'unpinned', 'moderation_changed')",
  ],
  comment: ["NEW.status IN ('visible', 'hidden', 'deleted')"],
  follow_relation: ["NEW.status IN ('following', 'blocked')", 'NEW.follower_account_id != NEW.target_account_id'],
  keyword_rule: [
    "NEW.match_mode IN ('exact', 'contains', 'prefix')",
    "NEW.scope IN ('post', 'comment')",
    "NEW.action IN ('warn', 'block', 'hide')",
  ],
  event_campaign: ['NEW.attendance_goal >= 0', "NEW.status IN ('draft', 'open', 'closed', 'completed')"],
}

/**
 * A trigger for each table and write that aborts as its CHECK would: when a
 * check is false, not when it is NULL.
 */
function checkTriggers(): string[] {
  return Object.entries(CHECKS).flatMap(([table, checks]) =>
    ['INSERT', 'UPDATE'].map(
      (event) =>
        `CREATE TRIGGER "${table}_check_${event.toLowerCase()}" BEFORE ${event} ON "${table}" ` +
        `WHEN ${checks.map((check) => `NOT (${check})`).join(' OR ')} ` +
        `BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: ${table}'); END`,
    ),
  )
}

export const socialFake: Fake<C> = {
  config,
  client: SocialClient,
  dmmf,
  // A fixture names each table as upstream does (`post_action_log`).
  seedRoots: Object.fromEntries(dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m.name])),
  afterSeed: async (db) => {
    for (const sql of checkTriggers()) await db.$executeRawUnsafe(sql)
  },
  afterReset: (db) => forget(db),
  routes: socialRoutes,
}
