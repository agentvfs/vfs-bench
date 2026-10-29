多个自动化任务连续失败，用户也报了相关工单。请帮我排查：
1. 检查失败的定时任务及其依赖关系
2. 查看API集成配置找出根因
3. 评估对库存数据的影响
4. 关联用户工单
5. 在知识库搜索解决方案
6. 输出故障分析和恢复方案

## Tools

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--tag <string>]`: 列出定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情（含执行历史和依赖关系）
- `config list-integrations [--status <string>]`: 列出API集成配置
- `config get-integration --integration-id <string>`: 获取API集成配置详情
- `inventory list-products [--category <string>]`: 列出库存产品
- `inventory get-product --product-id <string>`: 获取产品库存详情
- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: 更新工单（优先级、标签、分类）
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
