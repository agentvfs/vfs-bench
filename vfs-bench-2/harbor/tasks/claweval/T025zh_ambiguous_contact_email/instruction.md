看看收件箱最新邮件，李明说让我通知张经理参加周五的预算评审会议。
帮我给张经理发一封邮件通知他。

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `contacts search --query <string> [--department <string>]`: 搜索通讯录中的联系人
- `contacts get --contact-id <string>`: 获取联系人详细信息
- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 将邮件保存为草稿
