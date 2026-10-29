/**
 * A task's `COPY` lines, as Docker carries them out: in order, each
 * source's contents merged into what its destination already holds, a
 * later file replacing an earlier one at the same path.
 *
 * Both adapters read a task's copies into a list (`liveclawbench.ts` from
 * the Dockerfile, `mirage.ts` from mirage.yaml's `copy`), and mocks.ts lays
 * them into the workspace's mounts with `copyInto`. The list keeps two
 * copies to one destination apart, where a map by destination would keep
 * only the last.
 */
import { constants, cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

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
    // a Gaia2 trial's drive is 250 MB.
    else cpSync(from, target, { recursive: true, mode: constants.COPYFILE_FICLONE })
  }
}
