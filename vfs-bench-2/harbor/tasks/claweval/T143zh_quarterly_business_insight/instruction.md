Q1即将结束，请帮我做一份季度业务分析报告：
1. 从财务系统拉取Q1各客户的收入数据，分析收入趋势（增长/持平/下降）
2. 查看CRM中的客户信息（等级、行业、合同状态）
3. 浏览行业RSS动态，了解各客户所在行业的市场趋势
4. 综合分析：哪些客户在增长（为什么）、哪些在下降（有什么风险）、流失客户的原因
5. 输出Q2预测和建议

## Tools

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `rss list-feeds`: 列出RSS订阅源
- `rss get-feed --feed-id <string>`: 获取RSS源文章列表
- `rss get-article --article-id <string>`: 获取文章详情
