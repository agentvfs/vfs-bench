/**
 * Run a task with scripted shell calls in place of a model, then grade it.
 *
 *     node harness/oracle.ts <dataset>/<task> [script]
 *
 * The script defaults to the task's `tests/oracle.sh`. Each block of lines
 * separated by a blank line is one shell call, and `#` lines are skipped.
 * The script's `<name>.reply.md`, when there is one, is the model's last
 * reply, for a grader that judges it.
 * A task's oracle must pass and doing nothing (`tests/noop.sh`, or an empty
 * script) must fail: that is what shows the seed and the grader agree.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { withRefusal } from '@struktoai/mirage-core/workspace/tools/io_text'

import { execute, loadTask } from './execute.ts'
import { ROOT } from './paths.ts'

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
  // For a grader's judge, which run.ts's model reaches the same way.
  const env = join(ROOT, '.env')
  if (existsSync(env)) process.loadEnvFile(env)
  const { task } = await loadTask(ref)
  const script = scriptPath ?? join(task.dir, 'tests', 'oracle.sh')
  const lines = calls(readFileSync(script, 'utf8'))
  const replyPath = `${script.replace(/\.sh$/, '')}.reply.md`
  const reply = existsSync(replyPath) ? readFileSync(replyPath, 'utf8') : null
  const record = await execute(
    ref,
    async (workspace) => {
      const items: unknown[] = []
      // What MirageShellExecutor hands a model for each command.
      for (const command of lines) {
        const io = await workspace.shell(command)
        items.push({ command, stdout: io.stdoutText, stderr: withRefusal(io.stderrText, io.refusal), exit_code: io.exitCode })
      }
      // As the agents SDK records a model's reply.
      if (reply !== null) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] })
      return { status: 'finished', error: null, final_output: reply, usage: {}, items }
    },
    { model: 'oracle' },
  )
  for (const item of record.items as { command?: string; stdout: string; stderr: string; exit_code: number }[]) {
    if (item.command === undefined) continue // the reply
    console.log(`$ ${item.command}  [exit ${item.exit_code}]\n${(item.stdout + item.stderr).slice(0, 2000)}`)
  }
  for (const check of record.checks) console.log(`${check.passed ? 'ok  ' : 'FAIL'} ${check.name}${check.passed ? '' : `: ${check.detail}`}`)
  console.log(`${record.passed ? 'PASS' : 'FAIL'}  dump: ${record.dump}`)
  return record.passed ? 0 : 1
}

if (import.meta.main) process.exit(await main())
