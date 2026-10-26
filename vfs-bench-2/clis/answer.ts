/**
 * `complete-task [--answer <text>]`: how an agent hands in its answer.
 *
 * Question-answering tasks grade what the agent submits here; the harness
 * reads it from the run's `answer.json` (the install's `path`). A later
 * call replaces an earlier one, as a resubmission would.
 */
import { writeFileSync } from 'node:fs'

import { Argument, CLI, CLIHandler, CommandSpec, FlagView, IOResult, z } from '@struktoai/mirage-node'
import type { NOOPAccessor } from '@struktoai/mirage-core/accessor/base'

const ConfigSchema = z.strictObject({ path: z.string() })

export const COMPLETE_TASK = new CLI({
  spec: new CommandSpec({
    name: 'complete-task',
    description: 'Mark the task done, with the final answer if the task asks a question.',
    arguments: [new Argument('--answer', { help: 'the final answer, exactly as asked for' })],
  }),
  handlers: {
    '': new CLIHandler({
      fn: (accessor: NOOPAccessor, _paths, _texts, ctx) => {
        const answer = new FlagView(ctx.flags, ctx.spec).asStr('answer') ?? null
        writeFileSync((accessor.config as z.infer<typeof ConfigSchema>).path, JSON.stringify({ answer }))
        return [new TextEncoder().encode('Task marked complete.\n'), new IOResult()]
      },
      write: true,
    }),
  },
  configModel: ConfigSchema,
})
