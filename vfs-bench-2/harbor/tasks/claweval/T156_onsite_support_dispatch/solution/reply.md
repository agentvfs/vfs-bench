## Dispatch plan for the urgent VIP ticket

**Urgent ticket: TK-1201.** Wantong Logistics (CUS-1201) has a complete production system outage, priority critical. It is the only ticket that needs urgent onsite support: TK-1202 (medium), TK-1203 (low) and TK-1204 (medium) can be handled remotely.

- **Customer:** VIP tier, platinum SLA, 4-hour onsite response for critical tickets, located in Shanghai Pudong (Zhangjiang Hi-Tech Park). The account manager is Zhao Lei.
- **Problem:** the production ERP system has been down since 10:00, with the database connection pool exhausted and a suspected primary database node failure.
- **SLA deadline:** the ticket was created at 10:15, so the deadline is 14:15. General Manager Wang's email (msg_1201) demands an engineer onsite by 2:00 PM, which matches.

**Technicians compared**

| Engineer | Skills | Schedule today | Verdict |
|---|---|---|---|
| Ma Qiang (CT-1201), Senior Operations Engineer | System troubleshooting, database operations, network diagnostics; 10 years in ops, OCP and RHCE | Meetings 9:00–10:00 and 10:30–12:00, nothing in the afternoon; based at Shanghai HQ | **Primary**: best skill match, can reach Pudong well before 14:15 |
| Li Hua (CT-1202), Senior Architect | Architecture design, performance optimization | Only the 10:30–12:00 architecture review | **Backup**: available, but not an incident-recovery or database-ops specialist; supports remotely |
| Zhou Ming (CT-1203), Frontend Engineer | Frontend development, React, Vue | In Shenzhen all day (9:00–17:00) at a customer site | **Unavailable**: cannot reach Shanghai Pudong, and the skills do not match |

**Decision:** dispatch Ma Qiang onsite to Wantong Logistics as soon as his morning meetings end at 12:00, to be onsite before the customer's 2:00 PM request and the 14:15 SLA deadline. Li Hua is the backup and supports remotely.

**Notifications (saved as drafts, not sent):**
1. To Ma Qiang, with Wang Ming (Technical Director) copied for the escalation: the dispatch, customer address and contact, problem description, SLA deadline 14:15, expected arrival, the tools to bring, and Li Hua as backup.
2. To Zhao Lei (Account Manager for Wantong Logistics), with Wang Ming copied: who is going, the expected arrival before 14:15, and a request to confirm with the customer.

Please review the two drafts in Gmail and send them when you are happy with them.
