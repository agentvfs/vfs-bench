收件箱里有几封客户投诉邮件，需要你帮我逐一调查并给出处理建议。
请对每封投诉邮件：
1. 阅读投诉内容，了解客户诉求
2. 在CRM中查看客户信息（等级、合同金额等）
3. 在财务系统中查看相关交易记录，核实客户说的是否属实
4. 查找内部对应负责人的联系方式
5. 给每个投诉案例写出调查结论和处理建议，最后为最紧急的案例起草回复邮件草稿

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 保存邮件草稿
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
