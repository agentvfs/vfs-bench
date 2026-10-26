/**
 * Run a dataset's Python, such as upstream's own grader, in its uv project.
 *
 * The script reads one JSON value on stdin and prints one on stdout. Only
 * code that is genuinely foreign belongs here (an upstream checker in
 * Python); the harness's own logic stays in TypeScript.
 */
import { spawn } from 'node:child_process'

export async function runPython(project: string, script: string, input: unknown): Promise<unknown> {
  const child = spawn('uv', ['run', '--quiet', '--project', project, 'python', '-I', script], {
    cwd: project,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
  child.stdin.end(JSON.stringify(input))
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve))
  if (code !== 0) throw new Error(`${script} exited ${code}:\n${Buffer.concat(err).toString()}`)
  return JSON.parse(Buffer.concat(out).toString())
}
