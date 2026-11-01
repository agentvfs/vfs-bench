/**
 * The exceptions upstream's servers raise and catch, by Python class: a
 * port raises the one upstream raises, so the layer that catches it turns
 * it into the same reply.
 */

/** Python's `ValueError`. */
export class ValueError extends Error {}

/** Python's `KeyError`: `str()` of one is the key's repr. */
export class KeyError extends Error {}

/** FastAPI's `HTTPException(status_code, detail)`. */
export class HTTPException extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail))
    this.status = status
    this.detail = detail
  }
}
