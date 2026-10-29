Current date: 2026-03-27

我的待办事项和日历安排经常冲突。请帮我：
1. 查看所有待办事项及其截止日期
2. 查看本周的日历安排
3. 找出截止日期当天有大段会议无法工作的待办
4. 给出重新安排建议：哪些待办需要提前或延后
5. 输出冲突分析和重排建议

## Tools

The calendar is mounted at /calendar. The `gws` CLI reads, creates and deletes events (`gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `todo list-tasks [--status <string>]`: 查看待办事项列表
- `todo get-task --task-id <string>`: 获取待办详情
