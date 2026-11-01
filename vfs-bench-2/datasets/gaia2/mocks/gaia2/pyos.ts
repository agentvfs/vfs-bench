/**
 * Python's `OSError`s from the file calls of the Gaia2 fakes: a Node `fs`
 * error as the exception Python raises for the same failure, whose
 * `str(e)` is `[Errno <n>] <strerror>: '<path>'`.
 */
import { PyError } from './store.ts'
import { strRepr } from './pyrepr.ts'

/** Each errno Node names: Python's exception class, errno and message (Linux's). */
const ERRORS: Record<string, [string, number, string]> = {
  ENOENT: ['FileNotFoundError', 2, 'No such file or directory'],
  EACCES: ['PermissionError', 13, 'Permission denied'],
  EPERM: ['PermissionError', 1, 'Operation not permitted'],
  EEXIST: ['FileExistsError', 17, 'File exists'],
  ENOTDIR: ['NotADirectoryError', 20, 'Not a directory'],
  EISDIR: ['IsADirectoryError', 21, 'Is a directory'],
  ENAMETOOLONG: ['OSError', 36, 'File name too long'],
  ENOSPC: ['OSError', 28, 'No space left on device'],
  ELOOP: ['OSError', 40, 'Too many levels of symbolic links'],
}

/**
 * The `OSError` Python raises where a Node `fs` call threw `error`; anything
 * else is thrown on as it is.
 *
 * Args:
 *   error: what the `fs` call threw.
 *   path: the path Python's call names in its message (Node's own where omitted).
 */
export function osError(error: unknown, path?: string): PyError {
  const e = error as NodeJS.ErrnoException
  const known = typeof e?.code === 'string' ? ERRORS[e.code] : undefined
  if (known === undefined) throw error
  const [type, errno, message] = known
  const where = path ?? e.path
  return new PyError(type, where === undefined ? `[Errno ${errno}] ${message}` : `[Errno ${errno}] ${message}: ${strRepr(where)}`)
}
