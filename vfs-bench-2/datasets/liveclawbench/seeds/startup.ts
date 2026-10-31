/**
 * A task's legacy startup script (`startup_extra` in task-binary-map.json),
 * as the SQL it runs on one mock's database.
 *
 * Upstream's image runs the script once its mocks are up. Those scripts
 * seed rows a task needs beyond the mock's own seed, each with
 * `sqlite3 "$<NAME>_DB" "<SQL>"`, where `<NAME>_DB` names the mock's file
 * under `/var/lib/mock-data/<mock>/`. Here each such statement for the mock
 * is returned in the script's order, for the fixture's converter to run on
 * its scratch database after the seed. A `sqlite3` inside `$(...)` only
 * reads (the script's own checks), so it is not a statement here. A file
 * the script writes into the mock's directory with a here-document is
 * `startupFiles`'s. A script that writes to the mock some other way is
 * refused.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function startupSql(platform: string, task: string, mock: string): string[] {
  const map = JSON.parse(readFileSync(join(platform, 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, { startup_extra?: string }>
  }
  const script = map.tasks[task]?.startup_extra
  if (script === undefined) return []
  const text = readFileSync(join(platform, '..', script), 'utf8')
  const files = new Map<string, string>()
  for (const m of text.matchAll(/^([A-Z_]+)="([^"]+)"$/gm)) files.set(m[1]!, m[2]!)
  const dir = `/var/lib/mock-data/${mock}/`
  const statements: string[] = []
  for (const m of text.matchAll(/^sqlite3 "\$([A-Z_]+)" "((?:[^"\\]|\\.)*)"/gm)) {
    const file = files.get(m[1]!)
    if (file === undefined) throw new Error(`${task}: ${script} writes to $${m[1]}, which it never sets`)
    if (file.startsWith(dir)) statements.push(m[2]!.replace(/\\(.)/g, '$1'))
  }
  for (const m of text.matchAll(/^(cat|cp|echo|printf)\b.*$/gm)) {
    if (m[0].includes(dir) && !HEREDOC.test(m[0])) {
      throw new Error(`${task}: ${script} writes ${dir} other than with sqlite3 or a here-document: ${m[0]}`)
    }
  }
  return statements
}

/** `cat > <file> << 'EOF'`, a here-document written to a file. */
const HEREDOC = /^cat > (\S+) << '?(\w+)'?$/

/**
 * The files a task's legacy startup script writes into one mock's data
 * directory, each with a here-document (`cat > <file> << 'EOF'`), by path,
 * in the script's order, the last write of a file winning. The mock's own
 * seed has written them first, as upstream's mock starts before the script.
 */
export function startupFiles(platform: string, task: string, mock: string): Record<string, string> {
  const map = JSON.parse(readFileSync(join(platform, 'config', 'task-binary-map.json'), 'utf8')) as {
    tasks: Record<string, { startup_extra?: string }>
  }
  const script = map.tasks[task]?.startup_extra
  if (script === undefined) return {}
  const lines = readFileSync(join(platform, '..', script), 'utf8').split('\n')
  const dir = `/var/lib/mock-data/${mock}/`
  const files: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = HEREDOC.exec(lines[i]!)
    if (m === null || !m[1]!.startsWith(dir)) continue
    const end = lines.indexOf(m[2]!, i + 1)
    if (end < 0) throw new Error(`${task}: ${script}'s here-document to ${m[1]} never ends`)
    files[m[1]!] = `${lines.slice(i + 1, end).join('\n')}\n`
    i = end
  }
  return files
}
