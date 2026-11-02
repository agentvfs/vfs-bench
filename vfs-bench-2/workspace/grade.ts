/**
 * The `grade` CLI in a daemon of the job's, loaded by preload.ts: a trial's
 * grade is a workspace there, its frozen inputs on a read-only mount, and
 * `grade` runs the task's grader in the daemon's own process.
 *
 *     clis: {grade: {cli: grade}}      # in the grade workspace's config
 *     grade                            # reads /request.json, prints the grade
 *
 * `/request.json` is the request a grader's runner takes on its stdin
 * (verify.ts, or the dataset's `graders/verify.ts` for a `<dataset>-monty`
 * runtime), which the verifier stages, but for its frozen states and
 * files: `paths` names each by its file beside it, read here as they are
 * (`states` as JSON, `files` as base64). The grade prints as one JSON line;
 * a failed grade exits 1 with its error on stderr, and prints the
 * artifacts it had (`{"artifacts": ...}`) when it had some.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CLI, CLIHandler, CommandSpec, type CommandFnResult, type Context, IOResult } from '@struktoai/mirage-node'

import { GradeError } from './grader.ts'
import { MIRAGE } from './paths.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface Request {
  dataset: string
  runtime?: string
  paths?: { states: Record<string, string>; files: Record<string, string> }
  states?: Record<string, unknown>
  files?: Record<string, string>
}

type Runner = (request: Request) => Promise<unknown>

/** The runner a request's runtime names. */
async function runner(request: Request): Promise<Runner> {
  const runtime = request.runtime ?? 'typescript'
  if (runtime === 'typescript') return (await import('./verify.ts')).verify as unknown as Runner
  if (!/^[a-z0-9]+$/.test(request.dataset) || runtime !== `${request.dataset}-monty`)
    throw new Error(`Unknown verifier runtime: ${runtime}`)
  const own = (await import(new URL(`../datasets/${request.dataset}/graders/verify.ts`, import.meta.url).href)) as {
    verify: Runner
  }
  return own.verify
}

const GRADE = new CLI({
  spec: new CommandSpec({ name: 'grade', description: "Grade a trial's frozen inputs (/request.json)." }),
  handlers: {
    '': new CLIHandler({
      fn: async (_accessor, _paths, _texts, ctx: Context): Promise<CommandFnResult> => {
        try {
          const read = (path: string) => ctx.vfs!.read(path)
          const { paths, ...request } = JSON.parse(decoder.decode(await read('/request.json'))) as Request
          if (paths !== undefined) {
            const states = Object.entries(paths.states).map(async ([alias, path]) => [alias, JSON.parse(decoder.decode(await read(path)))])
            const files = Object.entries(paths.files).map(async ([name, path]) => [name, Buffer.from(await read(path)).toString('base64')])
            request.states = Object.fromEntries(await Promise.all(states))
            request.files = Object.fromEntries(await Promise.all(files))
          }
          const grade = await (await runner(request))(request)
          return [encoder.encode(`${JSON.stringify(grade)}\n`), new IOResult()]
        } catch (error) {
          const stderr = encoder.encode(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
          const stdout = error instanceof GradeError ? encoder.encode(`${JSON.stringify({ artifacts: error.artifacts })}\n`) : null
          return [stdout, new IOResult({ exitCode: 1, stderr })]
        }
      },
    }),
  },
})

// The registry the daemon's own Mirage resolves `clis:` against.
const { registerCliSpec } = (await import(
  pathToFileURL(join(MIRAGE, 'typescript', 'packages', 'core', 'dist', 'commands', 'cli', 'specs.js')).href
)) as typeof import('@struktoai/mirage-core/commands/cli/specs')
registerCliSpec(GRADE)
