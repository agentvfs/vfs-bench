import assert from 'node:assert/strict'
import { test } from 'node:test'

import { paymentClockClash } from './upstream-errors.ts'

test('only the payment transaction-ID UNIQUE conflict permits a clock-clash exception', () => {
  const error = 'UNIQUE constraint failed: payments.transaction_id'
  assert.equal(paymentClockClash({ status: 500, error }, { status: 201 }), true)
  for (const other of [null, 'Internal server error', 'database is locked', 'UNIQUE constraint failed: bookings.booking_reference']) {
    assert.equal(paymentClockClash({ status: 500, error: other }, { status: 201 }), false)
  }
  assert.equal(paymentClockClash({ status: 400, error }, { status: 201 }), false)
  assert.equal(paymentClockClash({ status: 500, error }, { status: 500 }), false)
})
