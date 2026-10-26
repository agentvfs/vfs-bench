/**
 * Run a task with scripted shell calls in place of a model, then grade it.
 *
 *     node harness/oracle.ts <dataset>/<task> [script]
 *
 * The script defaults to the task's `tests/oracle.sh`. Each block of lines
 * separated by a blank line is one shell call, and `#` lines are skipped.
 * A task's oracle must pass and doing nothing (`tests/noop.sh`, or an empty
 * script) must fail: that is what shows the seed and the grader agree.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { withRefusal } from '@struktoai/mirage-core/workspace/tools/io_text'

import { execute, loadTask } from './execute.ts'

/** The shell calls in a script. */
export function calls(script: string): string[] {
  const blocks: string[] = []
  let block: string[] = []
  for (const line of [...script.split('\n'), '']) {
    if (line.trim() === '') {
      if (block.length > 0) blocks.push(block.join('\n'))
      block = []
    } else if (!line.trimStart().startsWith('#')) {
      block.push(line)
    }
  }
  return blocks
}

async function main(): Promise<number> {
  const [ref, scriptPath] = process.argv.slice(2)
  if (ref === undefined) {
    console.error('usage: node harness/oracle.ts <dataset>/<task> [script]')
    return 2
  }
  const { task } = await loadTask(ref)
  const lines = calls(readFileSync(scriptPath ?? join(task.dir, 'tests', 'oracle.sh'), 'utf8'))
  const record = await execute(
    ref,
    async (workspace) => {
      const items = []
      // What MirageShellExecutor hands a model for each command.
      for (const command of lines) {
        const io = await workspace.shell(command)
        items.push({ command, stdout: io.stdoutText, stderr: withRefusal(io.stderrText, io.refusal), exit_code: io.exitCode })
      }
      return { status: 'finished', error: null, final_output: null, usage: {}, items }
    },
    { model: 'oracle' },
  )
  for (const item of record.items as { command: string; stdout: string; stderr: string; exit_code: number }[]) {
    console.log(`$ ${item.command}  [exit ${item.exit_code}]\n${(item.stdout + item.stderr).slice(0, 2000)}`)
  }
  for (const check of record.checks) console.log(`${check.passed ? 'ok  ' : 'FAIL'} ${check.name}${check.passed ? '' : `: ${check.detail}`}`)
  console.log(`${record.passed ? 'PASS' : 'FAIL'}  dump: ${record.dump}`)
  return record.passed ? 0 : 1
}

if (import.meta.main) process.exit(await main())
