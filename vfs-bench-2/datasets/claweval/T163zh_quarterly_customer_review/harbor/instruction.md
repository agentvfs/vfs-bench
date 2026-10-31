Q1结束了，请帮我为6个重点客户做季度回顾：
1. 查看每个客户的Q1财务数据
2. 查看CRM中的客户信息和满意度
3. 检查邮件中的沟通记录
4. 浏览行业动态了解客户所在行业趋势
5. 查找对应客户经理联系方式
6. 输出客户回顾报告，标注风险和增长机会

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `rss list-feeds`: 列出RSS订阅源
- `rss get-feed --feed-id <string>`: 获取RSS源文章列表
- `rss get-article --article-id <string>`: 获取文章详情
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
