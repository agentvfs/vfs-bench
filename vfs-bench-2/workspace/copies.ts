/**
 * A task's copies, as Docker carries out `COPY` lines: in order, each
 * source's contents merged into what its destination already holds, a
 * later file replacing an earlier one at the same path.
 *
 * mirage.ts reads a task's copies into a list from workspace.yaml's `copy`
 * and lays them into the workspace's mounts with `copyInto`. The list keeps
 * two copies to one destination apart, where a map by destination would
 * keep only the last.
 */
import { execFileSync } from 'node:child_process'
import { constants, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** One copy: a host path into a workspace path. `from` null makes an empty directory. */
export interface Copy {
  to: string
  from: string | null
}

/**
 * Where `COPY <src> <dest>` puts its source: a file into a `<dest>` that
 * ends in `/`, else at `<dest>`; a directory's entries into `<dest>`.
 */
export function copyTarget(dest: string, from: string): string {
  return dest.endsWith('/') && statSync(from).isFile() ? `${dest}${basename(from)}` : dest.replace(/\/$/, '')
}

/**
 * The host file behind a workspace path the copies put there, for an
 * `ENV` a mock reads: a file copied to exactly that path, or one under a
 * copied directory, the last copy that holds it winning, as it does in the
 * image. A path no copy holds yet maps through the last directory it is
 * under; one under no copy is undefined.
 */
export function copiedPath(copies: Copy[], path: string): string | undefined {
  const latest = [...copies].reverse()
  let under: string | undefined
  for (const { to, from } of latest) {
    if (from === null) continue
    // A file copied onto a directory goes inside it, as Docker puts it.
    if (path === to || (path === `${to}/${basename(from)}` && statSync(from).isFile())) return from
    if (path.startsWith(`${to}/`)) {
      const host = join(from, path.slice(to.length + 1))
      if (existsSync(host)) return host
      under ??= host
    }
  }
  return under
}

/** Whether `path` is nothing yet, or an empty directory. */
function empty(path: string): boolean {
  return !existsSync(path) || (statSync(path).isDirectory() && readdirSync(path).length === 0)
}

/**
 * Lay the copies out in order, each workspace path through `host` to its
 * directory; a file onto a directory that is there goes inside it.
 */
export function copyInto(copies: Copy[], host: (path: string) => string | undefined, task: string): void {
  for (const { to, from } of copies) {
    const target = host(to)
    if (target === undefined) throw new Error(`${task}: COPY to ${to}, which is outside the workspace's mounts`)
    if (from === null) mkdirSync(target, { recursive: true })
    else if (statSync(from).isFile() && existsSync(target) && statSync(target).isDirectory())
      cpSync(from, join(target, basename(from)))
    // A clone where the file system has them (APFS, Btrfs), else a copy:
    // a Gaia2 trial's drive is 250 MB. On macOS a directory onto nothing,
    // or onto an empty directory (a mount's own), is cloned by `cp -c`
    // (clonefile), much faster than cpSync's file by file.
    else if (process.platform === 'darwin' && statSync(from).isDirectory() && empty(target)) {
      mkdirSync(dirname(target), { recursive: true })
      execFileSync('/bin/cp', ['-cR', `${from}/`, target])
    } else cpSync(from, target, { recursive: true, mode: constants.COPYFILE_FICLONE })
  }
}
