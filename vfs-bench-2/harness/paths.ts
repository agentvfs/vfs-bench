/** Where things live, from the repo root. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const MIRAGE = join(ROOT, 'submodule', 'mirage')
export const INTEG = join(MIRAGE, 'integ')
/** Downloaded datasets, generated fixtures and per-run state; gitignored. */
export const STATE = join(ROOT, 'state')
