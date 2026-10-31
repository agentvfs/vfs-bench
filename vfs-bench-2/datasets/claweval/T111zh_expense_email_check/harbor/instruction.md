收件箱里有几封报销申请邮件。请帮我：
1. 查看所有报销相关邮件，提取每笔报销的金额和发票号
2. 在财务系统中查找对应的交易记录
3. 交叉核对每笔报销：金额是否一致、交易状态是否完成
4. 输出一份核对报告，列出：匹配正常的、金额不符的、状态异常的

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
