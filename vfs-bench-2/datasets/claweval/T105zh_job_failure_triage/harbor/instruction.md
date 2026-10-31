最近有几个用户报了工单说系统有问题，同时我们的定时任务也有一些失败记录。
请帮我：
1. 查看所有失败的定时任务及其错误信息
2. 查看当前未解决的工单
3. 分析哪些工单与定时任务故障有关联
4. 输出一份关联分析报告，说明每个故障任务对应了哪些工单、影响范围和建议处理优先级

## Tools

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--tag <string>]`: 列出定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情（含执行历史）
- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: 更新工单（优先级、标签、分类）
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
