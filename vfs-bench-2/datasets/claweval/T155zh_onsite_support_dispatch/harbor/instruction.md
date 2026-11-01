Current date: 2026-03-26

有一个VIP客户的紧急工单需要安排现场支持。请帮我：
1. 查看紧急工单详情和客户CRM信息
2. 查看技术人员的技能和今天的日程安排
3. 选择最合适的工程师派遣
4. 起草通知邮件草稿（给工程师和客户经理）

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 保存邮件草稿
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>] [--assigned-to <string>]`: 更新工单（优先级、标签、分类）
