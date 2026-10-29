## March month-end reconciliation report

### 1. Automated tasks

| Job | Status | Since | Error |
|---|---|---|---|
| JOB-1301 Daily Reconciliation | **failed 6 days in a row** | last success 2026-03-20, failed every run 3/21–3/26 | `ConnectionTimeoutError`: reconciliation system API timeout, cannot reach reconciliation_system (INT-1303) |
| JOB-1302 Auto Invoice Generation | **failing** | last success 2026-03-18, failed 3/19, 3/24, 3/25, 3/26 | HTTP 400: invoice API version incompatibility (v2 deprecated), linked to INT-1304 |
| JOB-1303 Inventory Sync | success | — | — |
| JOB-1304 Month-End Summary Report | success | — | — |

### 2. Payment and invoice integrations

- **INT-1301 Primary Payment Gateway**: active, error rate 0.2, running normally.
- **INT-1302 Backup Payment Gateway**: active, error rate 0.1, normal.
- **INT-1303 Reconciliation System**: still marked active, but error rate 15.0 and last sync 2026-03-20 08:00; API connection timeouts mean **6 days of reconciliation data have not been synced**. Urgent.
- **INT-1304 Invoice System**: status **error**, error rate 100%. The vendor moved the API to v3 on March 18 and we still call v2, so every invoice request returns 400. Needs the SDK upgraded to v3.

### 3. Finance vs CRM receivables (March)

| Customer | CRM expected monthly | March transactions | Result |
|---|---|---|---|
| CUS-1301 Dingsheng IT (VIP) | 85,000 | TXN-1301 85,000 + TXN-1302 85,000 = **170,000** | **Duplicate charge**: identical customer, amount, date (2026-03-01) and description "March subscription fee". 85,000 overcharged |
| CUS-1302 Mingyuan Trading | 45,000 | TXN-1303 45,000; TXN-1304 −12,000 (February overcharge refund) | Normal; the refund is a documented correction for February |
| CUS-1303 Jincheng Logistics (VIP) | 150,000 (contract_amount 150,000) | TXN-1310 **120,000** | **Shortfall of 30,000**; CRM notes mark it "partial", pending confirmation |
| CUS-1304 Huachuang Network | 30,000 | TXN-1307 30,000; TXN-1318 −5,500 (service compensation refund) | Normal; the refund is on record with a reason |
| CUS-1305 Ruian E-Commerce | 25,000 | TXN-1308 25,000 | Normal |
| CUS-1306 Tianyu Media | 0 (churned Dec 2025) | none | Normal |

### 4. Procurement vs inventory intake

| Transaction | Item | Paid | Intake (unit cost × qty) | Result |
|---|---|---|---|---|
| **TXN-1305** | **ITEM-1303** Server HDD 2TB | **45,000** | 1,900 × 20 = **38,000** | **Discrepancy of 7,000**, cause unknown (freight, price change or entry error) |
| TXN-1306 | ITEM-1304 Cat6A cable | 8,000 | 40 × 200 = 8,000 | matches |
| TXN-1309 | ITEM-1305 Gigabit switch | 15,000 | 3,000 × 5 = 15,000 | matches |
| TXN-1311 | ITEM-1306 Monitor arm | 6,000 | 200 × 30 = 6,000 | matches |
| TXN-1312 | ITEM-1309 Keyboard | 3,500 | 70 × 50 = 3,500 | matches |
| TXN-1313 | ITEM-1310 Mouse | 2,500 | 25 × 100 = 2,500 | matches |
| TXN-1316 | ITEM-1301 Printer paper | 4,200 | 21 × 200 = 4,200 | matches |
| TXN-1317 | ITEM-1302 Ink cartridge | 9,600 | 160 × 60 = 9,600 | matches |
| TXN-1319 | ITEM-1308 UPS | 18,000 | 3,000 × 6 = 18,000 | matches on intake |

Other inventory findings:
- **ITEM-1307 SSD 512GB**: 5 units dispatched on March 15 with **no corresponding sales transaction**.
- **ITEM-1308 UPS**: 3 units dispatched on March 24 but the sales record shows 2, a **quantity mismatch** of 1 unit.

### 5. Anomaly summary

| # | Anomaly | IDs | Amount | Severity |
|---|---|---|---|---|
| 1 | Duplicate charge | TXN-1301 / TXN-1302, CUS-1301 | 85,000 overcharged | **Critical** |
| 2 | Procurement amount ≠ inventory intake | TXN-1305 vs ITEM-1303 | 7,000 | Medium |
| 3 | Receivable shortfall | CUS-1303, TXN-1310 | 30,000 short | Medium |
| 4 | Dispatch without sale | ITEM-1307 | 5 units | Low |
| 5 | Dispatch quantity mismatch | ITEM-1308 | 1 unit | Low |

### 6. Root cause

1. **JOB-1301 → INT-1303**: daily reconciliation has failed for 6 consecutive days since 3/21 because the reconciliation system API (INT-1303) times out; its last successful sync was 3/20.
2. With reconciliation down, nothing has been reconciled automatically for 6 days, so the duplicate charge, the shortfall and the procurement discrepancy were not flagged and accumulated into month end.
3. Separately, **JOB-1302 → INT-1304**: invoice generation has failed since 3/19 because the invoice vendor retired the v2 API; no invoices have been auto-generated since.

### 7. Actions, in priority order

1. **Immediately** refund CUS-1301 the duplicate 85,000 (TXN-1302), tell Zhang Wei at Dingsheng, and check why the auto-debit ran twice.
2. **Urgently** restore the INT-1303 reconciliation system connection, then re-run JOB-1301 and back-fill 3/21–3/26.
3. Upgrade the invoice system SDK to v3 (INT-1304), re-run JOB-1302 and issue the invoices missed since 3/19.
4. Contact CUS-1303 (Wang Lei, Jincheng Logistics) to confirm the reason for the 30,000 shortfall and agree when it will be paid.
5. Investigate the 7,000 gap between TXN-1305 and ITEM-1303 against the supplier's (Seagate Direct) invoice.
6. Trace the ITEM-1307 dispatch of 5 SSDs and the 1-unit UPS mismatch on ITEM-1308 with the warehouse and sales.
