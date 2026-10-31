请帮我检查CRM中的客户联系状态：
1. 找出超过30天未联系的活跃客户
2. 查看邮件记录，了解最后沟通内容
3. 根据客户等级（VIP/standard）起草不同风格的跟进邮件草稿
   - VIP客户：正式、重视、提及合作关系
   - 普通客户：友好、简洁、了解需求
4. 注意排除已流失(churned)的客户
5. 输出需跟进客户清单和对应邮件草稿

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `gmail save-draft --to <string> --subject <string> --body <string>`: 保存邮件草稿
