**Alderwood Furniture · Binh Duong factory · Channel order sync and customer capture**

This week's Wayfair export is in the shared drive and a new buyer sent their details over chat. Bring the orders that are not yet in the system across without creating duplicates, capture the new customer as a proper master record instead of a chat message, and confirm the value that was synced. Log the sync in the register and prepare the update for Nguyen Thanh Tam to review.

Use the evidence available in the connected systems. Leave unrelated records and other tenants unchanged, keep outbound communication in review status, and do not claim completion until the durable state and readbacks agree.

## Tools

The connected systems are CLIs, one per system: `erpbench`,
`oracle-fusion`, `gmail`, `google-drive`, `google-sheets` and
`slack-tools` (`<cli> <command> --help` lists a command's
flags). Each command is one of the system's tools, and each
flag the tool's parameter of the same name; an object, or a
list of objects, takes a JSON string.

- `erpbench get-task`: Read the task-scoped outcome contract without revealing the gold answer.
- `erpbench get-decision`: Read back the durable decision record for a task.
- `erpbench get-submission`: Read back the durable submitted answer.
- `erpbench record-decision`: Record the selected option, status, primary ERP record, rationale and source references.
- `erpbench submit-answer`: Persist the structured final answer for deterministic grading.
- `oracle-fusion items list`: Get items for an inventory organization.
- `oracle-fusion items update`: Update the list price of one item as of an effective date.
- `oracle-fusion customer-account-activities get`: Get one customer account with open receivables and credit status.
- `oracle-fusion sales-orders list`: Get sales orders from Order Management.
- `oracle-fusion sales-orders get`: Get one sales order with its lines.
- `oracle-fusion sales-orders create`: Create one sales order; SubmittedFlag false leaves it as a draft awaiting release.
- `oracle-fusion shipments list`: Get shipments.
- `oracle-fusion shipment-lines list`: Get shipment lines with requested and shipped quantities.
- `oracle-fusion shipment-lines update`: Update the shipped quantity of one unconfirmed shipment line.
- `oracle-fusion receivables-invoices list`: Get receivables invoices.
- `oracle-fusion receivables-invoices get`: Get one receivables invoice.
- `oracle-fusion standard-receipts list`: Get standard receipts for a customer account.
- `oracle-fusion standard-receipts create`: Create a standard receipt and apply it through remittance references.
- `oracle-fusion onhand-balances list`: Get on-hand and reserved quantities.
- `oracle-fusion purchase-orders list`: Get purchase orders.
- `oracle-fusion purchase-orders get`: Get one purchase order.
- `oracle-fusion purchase-order-lines list`: Get the lines of one purchase order.
- `oracle-fusion suppliers list`: Get suppliers with lead times.
- `oracle-fusion purchase-requisitions create`: Create a purchase requisition with lines.
- `oracle-fusion purchase-requisitions submit`: Submit a requisition for approval.
- `oracle-fusion purchase-requisitions get`: Get one purchase requisition.
- `oracle-fusion receiving-receipt-requests list`: Get receiving receipt requests.
- `oracle-fusion receiving-receipt-requests create`: Create a receiving receipt request for delivered purchase-order lines.
- `oracle-fusion invoices list`: Get Payables invoices.
- `oracle-fusion invoices get`: Get one Payables invoice with holds.
- `oracle-fusion invoices create`: Create one Payables invoice matched to purchase-order lines.
- `oracle-fusion invoices validate`: Validate an invoice for payment.
- `oracle-fusion invoice-holds create`: Place one Payables invoice on hold with a reason.
- `oracle-fusion workers list`: Get workers for a legal employer.
- `oracle-fusion workers create`: Hire one worker under a standard contract.
- `oracle-fusion document-records list`: Get worker documents of record with expiry and check status.
- `oracle-fusion document-records update`: Update the status or verification flag of one document record.
- `oracle-fusion absences list`: Get absence records.
- `oracle-fusion absences create`: Record one absence for a worker.
- `gmail messages list`: Search mailbox messages.
- `gmail messages get`: Read one mailbox message.
- `gmail drafts create`: Save a review-only email draft; drafts are never sent by the sandbox.
- `gmail drafts get`: Read back one draft.
- `google-drive files list`: List files; supports name contains 'text'.
- `google-drive files get`: Read file metadata, version and current-authority flag.
- `google-drive files download`: Download the content of one file.
- `google-sheets spreadsheets values get`: Read a range from the ops workbook.
- `google-sheets spreadsheets values update`: Write one controlled range; other cells are preserved.
- `google-sheets spreadsheets values append`: Append rows to a tab.
- `slack-tools conversations-history`: Read a channel's messages, including task posts.
- `slack-tools search-messages`: Search messages across channels.
- `slack-tools chat-postMessage`: Post the review handoff to a channel.
