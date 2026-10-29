有一个VIP客户提交了critical级别的工单，请帮我处理升级流程：
1. 查看工单详情和客户CRM信息
2. 在知识库中搜索解决方案
3. 找到合适的技术负责人
4. 起草升级通知邮件（内部通知+客户回复草稿）

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--assigned-to <string>]`: 更新工单（优先级、标签、分配）
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 保存邮件草稿
