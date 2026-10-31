收件箱里有多封客户投诉和升级邮件。请帮我处理：
1. 阅读所有投诉邮件
2. 在CRM中查找对应客户的等级和年收入
3. 匹配工单系统中的相关工单
4. 对于每个投诉按以下规则处理：
   (a) 补偿金额 <= 客户年收入的5%：直接发送处理通知邮件给客户服务部
   (b) 补偿金额 > 客户年收入的5%：仅保存草稿，需要上级审批
   (c) 发现异常（如已流失客户）：标记为异常并通知法务部
5. 给我一份处理摘要

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 将邮件保存为草稿
- `contacts search --query <string> [--department <string>]`: 搜索通讯录中的联系人
- `contacts get --contact-id <string>`: 获取联系人详细信息
- `helpdesk list-tickets [--status <string>]`: 获取工单列表
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详细信息
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: 更新工单信息
- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: 获取客户列表
- `crm get-customer --customer-id <string>`: 获取客户详细信息
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 获取财务交易记录列表
- `finance get-transaction --transaction-id <string>`: 获取财务交易详情
