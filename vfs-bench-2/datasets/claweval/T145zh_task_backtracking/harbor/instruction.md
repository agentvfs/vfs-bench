收件箱里有几封催办邮件，请帮我：
1. 阅读每封催办邮件，理解催办内容
2. 在待办事项中查找对应的任务，了解当前进展
3. 在会议纪要中查找相关讨论记录，补充上下文
4. 对每个催办事项，整理出：当前状态、阻塞原因（如有）、预计完成时间
5. 为每封催办邮件起草回复草稿，说明进展

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 保存邮件草稿
- `todo list-tasks [--status <string>]`: 列出待办事项
- `todo get-task --task-id <string>`: 获取待办详情
- `notes list [--days-back <integer>]`: 列出会议纪要
- `notes get --note-id <string>`: 获取会议纪要详情
