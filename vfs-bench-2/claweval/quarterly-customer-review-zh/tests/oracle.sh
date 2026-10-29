# Upstream's reference_solution, through the CLIs: Q1's transactions, each
# customer's CRM record, the quarter's emails (the list's default window is
# 7 days), both RSS feeds, and the two account managers' contacts.
finance list-transactions

crm list-customers

crm get-customer --customer-id CUS-1601
crm get-customer --customer-id CUS-1602
crm get-customer --customer-id CUS-1603
crm get-customer --customer-id CUS-1604
crm get-customer --customer-id CUS-1605
crm get-customer --customer-id CUS-1606

gmail list-messages --days-back 90

gmail get-message --message-id msg_1601
gmail get-message --message-id msg_1602
gmail get-message --message-id msg_1603
gmail get-message --message-id msg_1604
gmail get-message --message-id msg_1605
gmail get-message --message-id msg_1606
gmail get-message --message-id msg_1607
gmail get-message --message-id msg_1608
gmail get-message --message-id msg_1609

rss list-feeds

rss get-feed --feed-id feed_01
rss get-feed --feed-id feed_02

contacts search --query 赵蕾
contacts search --query 张伟
contacts search --query 王明
