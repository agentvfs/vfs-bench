## Supply chain anomaly analysis: shipping delays

### Summary

All the shipping-delay tickets trace back to one supplier. **Supplier A, Huatong Tech (SUP-1001), was suspended on March 15** over product quality issues (a router batch's return rate exceeded the threshold). All four of our purchase orders with them were cancelled, the four products they supply ran out, and three paid customer orders, worth **495,000 CNY**, cannot ship.

### Problem chain

1. **Root cause: supplier suspended.** CRM: SUP-1001 Huatong Tech = "Supplier A", status **suspended** since March 15 for quality issues; cooperation is halted until quality remediation and re-evaluation by procurement.
2. **Purchases cancelled.** Finance: every Supplier A purchase was cancelled with the reason "Supplier shipment suspended":

   | Transaction | Date | Item | Qty | Amount (CNY) |
   |---|---|---|---|---|
   | TXN-1101 | 03-05 | Smart Router X1 (ITEM-1101) | 50 | 150,000 |
   | TXN-1102 | 03-06 | Switch S200 (ITEM-1102) | 20 | 80,000 |
   | TXN-1103 | 03-07 | Firewall F500 (ITEM-1103) | 10 | 60,000 |
   | TXN-1104 | 03-08 | Fiber Optic Module (ITEM-1108) | 30 | 45,000 |
   | | | | **Total** | **335,000** |

   By contrast, the purchases from the other suppliers completed normally: TXN-1105 (Supplier B, cables, 25,000), TXN-1106 (Supplier B, UPS, 35,000), TXN-1107 (Supplier C, servers, 240,000).
3. **Stock-outs.** Inventory: the four products are all supplied by Supplier A and are at or near zero, far below their reorder levels:

   | Item | Product | Qty | Reorder level |
   |---|---|---|---|
   | ITEM-1101 | Smart Router X1 | **0** | 50 |
   | ITEM-1102 | Switch S200 | **3** | 20 |
   | ITEM-1103 | Firewall F500 | **0** | 10 |
   | ITEM-1108 | Fiber Optic Module | **2** | 30 |

   Every other item (cables, servers, UPS, racks, from Suppliers B and C) is at normal levels.
4. **Paid orders that cannot ship:**

   | Customer | Order | Contents | Paid (CNY) |
   |---|---|---|---|
   | CUS-1101 Dingxin Software (**VIP**) | #A001 | 20 routers + 10 switches | 180,000 (TXN-1108) |
   | CUS-1102 Hanhai E-commerce | #A002 | 5 switches + 5 firewalls | 95,000 (TXN-1109) |
   | CUS-1103 Wantong Logistics (**VIP**) | #A003 | 30 routers + 5 firewalls + 20 fiber modules | 220,000 (TXN-1110) |
   | | | **Total collected, unshipped** | **495,000** |

   Together they need 50 routers (0 in stock), 15 switches (3), 10 firewalls (0) and 20 fiber modules (2).
5. **Customer tickets:** TK-1101 (#A001 delay, Dingxin, high), TK-1102 (#A002 five days late, delaying Hanhai's data center deployment, high) and TK-1103 (#A003 out of stock with no restock date, Wantong, **critical**).

Quality issue → Supplier A suspended (3/15) → 4 purchases cancelled (335,000) → 4 products out of stock → 3 paid orders stuck (495,000) → 3 complaint tickets.

### Unrelated tickets and suppliers

- **TK-1104** (Qianfeng Technology, 502 errors at login) is a technical issue; Qianfeng has no outstanding orders.
- **TK-1105** (Dingxin, invoice tax ID correction) is a finance issue.
- **Supplier B, Zhongke Parts (SUP-1002)**: active, stable deliveries and good quality. **Supplier C, Tianhe Servers (SUP-1003)**: active and on schedule, but plans a capacity adjustment in late March.

### Risk assessment

- **Single-supplier dependency:** Supplier A is the only source of all four out-of-stock products, so one suspension stopped the whole network-equipment line.
- **Financial and fulfillment risk:** 495,000 CNY collected for orders we cannot ship, with no restock date; refunds or penalties are possible.
- **Customer risk:** two of the three affected customers are VIPs (Dingxin, Wantong); Wantong has escalated to critical.

### Resolution plan

**Short term**
1. Contact Huatong Tech (President Wang, wang@huatong-tech.com) today for their quality remediation progress and an estimated date to resume supply.
2. Ask Supplier B and Supplier C whether they can source routers, switches, firewalls and fiber modules temporarily, and look for other qualified suppliers in parallel. Book any Supplier C capacity early, before its late-March adjustment.
3. Allocate what is in stock to VIP orders first: the 3 switches and 2 fiber modules toward #A001 (Dingxin) and #A003 (Wantong), and ship partially where the customer agrees.
4. Contact all three customers proactively (Manager Zhou, Director Lin, Director Zhao), explain the cause, give an estimated delivery date, and offer options (partial shipment, substitutes, or a refund). Update TK-1101/1102/1103 with this; keep them open until the orders ship.

**Long term**
1. Qualify at least two suppliers for every key product to avoid single-supplier dependency.
2. Monitor supplier quality (return rates) with early warnings before a suspension.
3. Alert automatically when stock drops below the reorder level, and trigger restocking.
4. Write a contingency plan for supply disruptions, including how to treat orders that are already paid.
