# Upstream's reference_solution, through the CLIs: read the three complaints,
# check each customer in the CRM and their transactions, find who owns
# billing, sales and the platform, then save (not send) a reply to the VIP.
gmail list-messages

gmail get-message --message-id msg_601
gmail get-message --message-id msg_602
gmail get-message --message-id msg_603

crm get-customer --customer-id CUS-601
crm get-customer --customer-id CUS-602
crm get-customer --customer-id CUS-603

finance list-transactions

finance get-transaction --transaction-id TXN-604

contacts search --query Finance
contacts search --query Sales
contacts search --query Tech
contacts search --query 'Customer Success'

gmail save-draft --to liwei@zhonghe-group.com --reply-to-message-id msg_601 --subject 'Re: Urgent complaint: Bill amount doubled for two consecutive months' --body 'Dear Mr. Li Wei,
Thank you for raising this, and we sincerely apologize for the billing problem and for the lack of response so far. As one of our most valued VIP customers, Zhonghe Group has our full priority.
We have started an internal investigation. Our records show your contract fee of 120,000 CNY per month was billed correctly in January, but the February and March bills of 240,000 CNY each include an extra 120,000 CNY per month for "add-on modules". We are now verifying with our Finance Department and your account team whether these add-on modules were ever authorized by you.
We will send you the verified result within 48 hours. If the add-on charges were not authorized, we will refund the overcharged difference of 240,000 CNY in full (120,000 CNY each for February and March) and correct your future bills.
Your dedicated customer success manager, Chen Ping, will keep you updated in the meantime.
With our apologies and best regards,
Customer Support'
