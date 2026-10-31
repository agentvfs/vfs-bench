请帮我做一次月度系统健康巡检：
1. 检查所有API集成配置的状态
2. 检查定时任务的运行情况
3. 查看当前未解决的工单
4. 在知识库中搜索已知解决方案
5. 输出一份系统健康报告，标注故障链和修复建议

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...]`: 更新工单
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
- `scheduler list-jobs [--status <string>] [--tag <string>]`: 列出定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情
- `config list-integrations [--type <string>] [--status <string>]`: 列出系统集成配置
- `config get-integration --integration-id <string>`: 获取集成配置详情
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
