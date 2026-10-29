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
import { cpSync, mkdirSync, statSync } from 'node:fs'
import { basename } from 'node:path'

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

/** Lay the copies out in order, each workspace path through `host` to its directory. */
export function copyInto(copies: Copy[], host: (path: string) => string | undefined, task: string): void {
  for (const { to, from } of copies) {
    const target = host(to)
    if (target === undefined) throw new Error(`${task}: COPY to ${to}, which is outside the workspace's mounts`)
    if (from === null) mkdirSync(target, { recursive: true })
    else cpSync(from, target, { recursive: true })
  }
}
