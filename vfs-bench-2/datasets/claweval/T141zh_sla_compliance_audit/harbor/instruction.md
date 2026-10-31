请帮我做一次SLA合规审查：
1. 查看系统配置中的SLA响应时间规则
2. 检查近期工单的实际响应时间，对比SLA标准判断是否达标
3. 检查SLA相关自动化任务的运行状态，找出异常
4. 输出一份SLA合规分析报告，包含：达标/超标工单明细、自动化故障影响分析、改进建议

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
