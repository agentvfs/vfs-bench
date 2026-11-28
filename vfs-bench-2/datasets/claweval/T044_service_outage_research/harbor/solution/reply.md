# CloudPay Outage Research Report (2026-03-01)

This is research and analysis only. No action was taken: the payment gateway was not switched, no notification was sent and no vendor was contacted. Sources: CloudPay's status page (status.cloudpay.com, incident INC-20260301-001), the CloudPay engineering blog, the CloudPay developer community, AsiaPay's integration docs, the PCI SSC incident response guidance and Fintech Insights' outage cost analysis.

## 1. Outage summary

| Item | Detail |
|---|---|
| Affected service | CloudPay payment gateway (our primary gateway) |
| Start | 2026-03-01 14:30 UTC, when monitoring detected elevated error rates; the triggering deployment went out at 14:00 UTC |
| Scope | Asia-Pacific (AP region, APAC) only; the US/EU payment API and the dashboard are not affected |
| Symptoms | Payment API returning 503 errors for about 60% of requests; Refund API fully unavailable; webhook delivery queue depth 450,000+ (450K) |
| Incident status | Investigating (status page updated 17:30 UTC), rollback in progress |

**Root cause.** At 14:00 UTC CloudPay deployed release **v3.2.1** to its Asia-Pacific database cluster, including a schema migration (database migration) on the **`payment_transactions`** table (2.3TB, about 1.8 billion rows): an ALTER TABLE / CREATE INDEX adding the composite index `idx_merchant_date`. On PostgreSQL a plain CREATE INDEX takes a **SHARE lock**, which blocked all INSERTs; the resulting **lock contention** exhausted the 500-connection **connection pool** (pool exhaustion), causing cascading timeouts and the 503s. Staging did not catch it because its copy of the table has only 50,000 rows.

## 2. Current status and estimated recovery

- **17:00 UTC**: **rollback** of the migration started; it has to rebuild the original index structure and is slower than expected because of the 2.3TB table size.
- **18:00 UTC**: **partial recovery**. Payment API success rate improved from about 40% to about **75%** (roughly 25% still failing); the Refund API is still unavailable; webhooks are still backed up and will be replayed in order after delivery resumes.
- **Estimated full recovery: 22:30 UTC**, about **8 hours** after the incident started. Next official update at 19:00 UTC.
- CloudPay will issue service credits to affected merchants, with details within 7 business days, and has announced prevention measures (mandatory `CREATE INDEX CONCURRENTLY`, table-size checks in the deployment pipeline, an off-peak 02:00-06:00 UTC deployment window for AP, production-scale staging data).
- Context: this is CloudPay's second major outage in 12 months (September 2025, a misconfigured load balancer, 4 hours, all regions). Its 2025 uptime was 99.92%, below its 99.99% SLA.

## 3. Business impact assessment

1. **Payment conversion.** From this afternoon until the expected recovery, about 60% of AP payment requests failed (about 25% after 18:00 UTC), which matches the frequent payment failures our customers are seeing.
2. **Refunds.** The Refund API is unavailable for the whole window; refunds submitted now are queued and processed after recovery, so support needs a consistent answer for refund enquiries.
3. **Order status sync.** With 450,000+ webhooks queued, payment confirmations will arrive hours late even after the payment API recovers. If fulfilment depends on webhooks we will see "paid but order not updated" cases, so payment status must be polled instead.
4. **Financial impact.** Per Fintech Insights' 2026 analysis, mid-size merchants ($1M-$50M annual GMV) lose on average **$35,000-$50,000 per hour** of direct revenue during a payment gateway outage; over 8 hours that is on the order of $280,000-$400,000, to be scaled to our actual volume. Indirect cost is typically 2-3x the direct loss: 15-20% of customers who hit a failed payment do not return within 30 days (customer churn), a failed payment raises cart abandonment by 40-60%, and support volume spikes 300-500%.
5. **Compliance.** See section 5: we have a 72-hour obligation to report to our acquiring bank.

## 4. Recommended emergency measures

**Short term (tonight)**

1. **Queue and retry.** When CloudPay returns 503, do not fail the order: save the payment intent to a local queue (Redis or the database), show "Payment processing..." and retry with exponential backoff (30s, 60s, 120s, 300s); after 3 failed retries switch to the backup provider, after 5 tell the customer to try again later. **Always use idempotency keys** so nobody is double-charged. Merchants report this cuts customer-facing failures by 70-80%.
2. **Route through US-West.** CloudPay's **us-west.api.cloudpay.com** endpoint is unaffected; AP transactions can be routed there temporarily at about 200ms extra latency. It works for payment creation only; refunds still go through the AP infrastructure.
3. **Webhook fallback.** Poll payment status instead of waiting for webhooks; do not cache and replay webhook events (they may be stale); do not assume recovery from a few successful requests, it is intermittent.
4. **Customer communication.** Warn customers of payment delays at checkout and brief support on queued refunds.

**Alternative provider (feasibility of an emergency switch)**

- **AsiaPay** offers a drop-in, **API-compatible** mode for CloudPay merchants and quotes an **emergency migration of 30 minutes**: create an account (5 minutes), replace the endpoint `api.cloudpay.com` with `api.asiapay.com` and use AsiaPay Bearer keys in the same header structure (10 minutes), test in `sandbox.api.asiapay.com` (15 minutes). The webhook payload is compatible with CloudPay's, the Refund API is available immediately and currency codes are the same ISO 4217.
- **The one field difference:** AsiaPay uses `merchant_ref` where CloudPay uses `merchant_reference`; that must change before switching.
- Pricing: 2.9% + $0.30 standard, 2.5% + $0.25 for the first 30 days of an emergency migration, no setup fee or monthly minimum; settlement T+2 (T+1 for an extra 0.1%); 22 countries in Asia-Pacific; 99.98% uptime in 2025.
- Conclusion: technically a switch is feasible tonight; the work is the endpoint, the keys, the `merchant_ref` field and a sandbox test. Whether to switch is a business decision; this report does not act on it.

## 5. Compliance (PCI DSS)

Under **PCI DSS v4.0** section 12.10.1, a payment processing disruption (including service unavailability) is a "service disruption" that must be documented and reported even when no cardholder data is compromised:

- **Document the incident within 24 hours**: time, services affected, estimated transactions impacted, root cause.
- **Notify the acquiring bank / payment processor within 72 hours**: incident summary, customer impact assessment, mitigation measures, recovery timeline.
- Cardholders need notifying only if a data breach is suspected; there is no sign of unauthorized data access here.
- Some card networks require notification when an outage lasts more than 4 hours; keep records for at least 12 months.

This outage has already run more than 4 hours from 14:30 UTC, so the 72-hour report to the acquiring bank (by March 4, 14:30 UTC) applies. No notification has been sent by this report.

## 6. Follow-up action items

- [ ] Track incident INC-20260301-001 on the status page from 19:00 UTC and confirm full recovery at 22:30 UTC, especially the Refund API and the webhook replay.
- [ ] After recovery, reconcile: export every failed, queued and retried transaction since 14:30 UTC and check for double charges or missing orders.
- [ ] Complete the incident documentation within 24 hours and the acquiring-bank report within 72 hours (compliance owner).
- [ ] Watch for CloudPay's service-credit details within 7 business days and claim them.
- [ ] Medium term: integrate a second gateway (AsiaPay has the lowest migration cost) with health-check-based automatic failover; industry data puts multi-gateway redundancy at $10,000-$50,000 to implement and about $180,000/year in prevented outage losses.
- [ ] Medium term: make queue-and-retry with idempotency keys permanent, monitor gateway status pages programmatically and write a payment-outage incident response plan.
