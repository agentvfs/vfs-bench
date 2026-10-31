/** Diagnostics from the comparison server, never from the fake under test. */
export const UPSTREAM_ERROR_HEADER = 'x-vfsbench-upstream-error'

export function paymentClockClash(upstream: { status: number; error: string | null }, fake: { status: number }): boolean {
  return upstream.status === 500 && fake.status === 201 && upstream.error === 'UNIQUE constraint failed: payments.transaction_id'
}
