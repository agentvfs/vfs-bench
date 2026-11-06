# Project Alpha Summary

Seven of the nine inbox messages concern Project Alpha; the two unrelated ones (an office lunch invitation and a conference promotion) were ignored.

## 1. Project Overview

Project Alpha is a new customer-facing analytics dashboard that replaces the legacy reporting system (kickoff by Sarah Chen, Jan 15). The stack is PostgreSQL with TimescaleDB, FastAPI, React with Recharts and OAuth2 on the application side, with Kafka, Flink, TimescaleDB, dbt and Great Expectations running the data pipeline since Phase 1 completed. The original budget was $340K; the expanded budget of $410K was approved after savings from spot instances, below the $432K (27 percent overrun) that finance had flagged.

## 2. Timeline

- Jan 15: kickoff; original plan was Beta Launch Apr 21 and GA May 12.
- Feb 3: finance raises the budget overrun risk ($340K to $432K).
- Feb 10: mandatory security review findings delivered.
- Feb 12: Phase 1 complete, data pipeline live, expanded budget approved at $410K.
- Feb 14: early client feedback from the beta waitlist.
- Feb 18: updated timeline, Phase 2 delayed by the security fixes and the WebSocket gateway: Beta moves to May 6 and GA moves to May 27.
- Feb 25: frontend progress update.

## 3. Key Risks and Issues

- **Security review (critical):** cross-tenant data exposure on the timeseries endpoint and per-message WebSocket authentication.
- **Security review (high):** stronger rate limiting, SSRF hardening on report generation and missing audit logging.
- **Schedule:** the security fixes and the WebSocket gateway pushed Beta and GA out by about two weeks; "shipping secure is non-negotiable".
- **Budget:** the infrastructure cost overrun was contained at $410K, but finance asked for a cost-benefit analysis and sales confirmation before approving it.
- **Frontend dependency:** the live metric widgets are blocked on the WebSocket gateway.

## 4. Client and Business Impact

Five prospects on the beta waitlist gave strong feedback. The immediate pipeline from them is $1.85M ARR, and overall tracking is $2.8M ARR, ahead of the $2.1M projection. Clients are asking for custom alerting, exports, API access and data residency, which should feed the post-GA roadmap.

## 5. Current Status

Phase 1 (data pipeline) is complete and live. Phase 2 is under way with the security fixes and the WebSocket gateway on the critical path. Frontend work has started with Storybook, the dashboard layout engine, Recharts components and SSO integration, with the live metric widgets waiting on the gateway. Budget is approved at $410K. Beta is targeted for May 6 and GA for May 27.
