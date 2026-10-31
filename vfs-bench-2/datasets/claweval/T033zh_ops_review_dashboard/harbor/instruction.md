请帮我准备一份本周运营周报。需要综合以下系统的数据：
1. 系统集成状态（检查各API和服务的健康状况）
2. 工单系统（分析本周工单趋势和重点问题）
3. 库存状况（检查产品库存和异常）
4. CRM客户动态（VIP客户情况）
5. 知识库（是否有过时文档需要更新）
6. 定时任务状态（检查调度任务健康状况）

注意：这是只读审查，不要修改任何数据、发送邮件、更新工单或创建任何内容。只做数据收集和分析，最后输出报告。

## Tools

Each tool is a shell command; `<command> --help` says more.

- `config list-integrations [--status <string>]`: 获取所有第三方集成的列表（概览信息）
- `config get-integration --integration-id <string>`: 获取单个集成的完整配置信息
- `helpdesk list-tickets [--status <string>] [--priority <string>] [--category <string>]`: 获取工单列表
- `helpdesk get-ticket --ticket-id <string>`: 获取单个工单的详细信息
- `inventory list-products [--category <string>]`: 获取商品库存列表
- `inventory get-product --product-id <string>`: 获取单个商品的详细库存信息
- `crm list-customers [--tier <string>] [--status <string>]`: 获取客户列表
- `crm get-customer --customer-id <string>`: 获取单个客户的详细信息
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章详情
- `scheduler list-jobs [--status <string>] [--enabled <boolean>]`: 列出所有定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情
- `scheduler job-history --job-id <string> [--limit <integer>]`: 查看定时任务执行历史
