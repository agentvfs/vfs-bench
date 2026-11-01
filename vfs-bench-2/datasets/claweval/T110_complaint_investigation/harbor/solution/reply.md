## Complaint investigation: 3 cases

The inbox has three complaints (msg_601, msg_602, msg_603); msg_604 is the SaaS Industry Weekly newsletter and needs no action.

### Case 1: Zhonghe Group (CUS-601, VIP): bill doubled. Most urgent

**Complaint (msg_601, Li Wei):** contract fee is 120,000 CNY/month, but the February and March bills are 240,000 CNY each. Sales has not responded, and they threaten to terminate the contract if it is not fixed this week.

**Verification**
- CRM: VIP tier, annual contract 1.44M CNY (= 120,000/month); notes record a recent billing complaint.
- Finance:
  - TXN-601, 2026-01-05: **120,000**, "January standard edition service fee" (normal)
  - TXN-602, 2026-02-05: **240,000**, "February service fee (including add-on modules)"
  - TXN-603, 2026-03-05: **240,000**, "March service fee (including add-on modules)"
- The customer's claim is **accurate**: since February an extra **120,000/month** has been billed as "add-on modules", 240,000 over two months. The customer says they bought the standard edition, so the add-ons were likely added without their confirmation, or the billing system applied them in error.

**Recommendation:** handle first, as a VIP account at risk of churn. Have **Liu Yang** (Finance Dept, Accounts Receivable Supervisor, liuyang@company.com, 13900601002) verify the bills, and **Zhao Lei** (Sales Dept, Key Account Sales Director, zhaolei@company.com, 13900601004) check whether the add-on modules were ever authorized. If not, refund 240,000 CNY and correct future bills. **Chen Ping** (Customer Success Manager for VIP customers, chenping@company.com) should own communication with the customer.

### Case 2: Qianfeng Tech (CUS-602): outage compensation not received

**Complaint (msg_602, Wang Min):** a 3-day outage on March 1–3 cost them about 50,000 CNY in lost orders; support promised compensation, but no refund has arrived.

**Verification**
- CRM: standard tier; notes say "affected by early March service outage, compensation promised but not executed".
- Finance: **TXN-604**, 2026-03-05, **−50,000 CNY**, "service outage compensation (approved, pending execution)", status **pending**, **approved by Liu Yang**.
- The claim is **accurate**. The compensation was approved but is **stuck at the execution stage**; it was never paid out.

**Recommendation:** ask **Liu Yang** (Finance Dept) to execute TXN-604 now, and give the customer a firm date for when the 50,000 CNY will arrive, with an apology for the delay.

### Case 3: Sunlight Media (CUS-603): features downgraded without notice

**Complaint (msg_603, Zhang Hua):** premium features were downgraded to basic on March 15; they only noticed on March 20 and got no notification. They want the reason and the features restored.

**Verification**
- CRM notes: "premium features automatically downgraded due to payment delay, payment made on March 18".
- Finance: TXN-605, 2026-02-15, 40,000 (February fee); **TXN-606, 2026-03-18, 40,000, "March service fee (late payment)"**, completed.
- Event chain: March payment late → **automatic downgrade on March 15** → **payment received March 18** → features **still not restored** when the customer wrote in → the customer was **never notified** of the downgrade.

**Recommendation:** ask **Ma Qiang** (Tech Dept, Ops Supervisor, maqiang@company.com, 13900601003) to restore the premium features now, explain the cause to the customer, and fix the system so that (1) the customer is notified before and when a downgrade happens and (2) features are restored automatically once payment arrives.

### Priority

1. **Zhonghe Group** (VIP, 240,000 CNY possible overcharge, termination threat)
2. **Qianfeng Tech** (approved 50,000 refund not executed)
3. **Sunlight Media** (paid, but features not restored)

### Reply draft

I saved a **draft** (not sent) to Li Wei at Zhonghe Group (liwei@zhonghe-group.com), replying to msg_601. It apologizes for the billing problem and the lack of response, explains that our internal investigation found the extra "add-on module" charges since February, commits to a verified result **within 48 hours**, and promises to **refund the 240,000 CNY difference** if the add-ons were not authorized. Please review it in Gmail before sending.
