Current date: 2026-03-26

请帮我检查所有活跃客户的合同到期情况，找出60天内即将到期的客户。
对于每个即将到期的客户：
1. 查看CRM中的客户详情（等级、收入、销售负责人）
2. 查找对应销售负责人的联系方式
3. 检查收件箱是否有该客户近期的沟通记录
4. 根据客户等级(VIP/standard)和紧急程度，为VIP客户起草续约提醒邮件草稿
最后输出一份完整的续约预警报告。

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
- `gmail save-draft --to <string> --subject <string> --body <string>`: 保存邮件草稿
