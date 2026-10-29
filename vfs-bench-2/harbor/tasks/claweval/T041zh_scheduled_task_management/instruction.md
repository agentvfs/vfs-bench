帮我整理一下系统的定时任务。检查所有计划任务的运行状态，找出失败或异常的任务，查看知识库里有没有相关的排查指南，然后：
1. 修复能修复的（重新启用被误禁用的任务、调整时间避免冲突）
2. 对于需要人工介入的问题，发邮件通知运维团队
3. 给我一份定时任务健康报告

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--enabled <boolean>] [--tag <string>]`: 列出所有定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情
- `scheduler create-job --name <string> --cron-expression <string> --action <string> [--enabled <boolean>] [--tags <value> ...]`: 创建新的定时任务
- `scheduler update-job --job-id <string> [--enabled <boolean>] [--cron-expression <string>] [--name <string>] [--action <string>] [--tags <value> ...]`: 更新定时任务配置
- `scheduler delete-job --job-id <string>`: 删除定时任务
- `scheduler job-history --job-id <string> [--limit <integer>]`: 查看定时任务执行历史
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章详情
- `gmail save-draft --to <string> --subject <string> --body <string>`: 保存邮件草稿
