Current date: 2026-03-26

请帮我生成上周的会议行动项跟踪报告：
1. 查看上周的日历会议
2. 找到有纪要的会议，查看行动项
3. 在待办中查找每个行动项的完成状态
4. 找出遗漏的行动项（纪要中有但待办中没有的）
5. 输出周进度报告：按会议分组，标注每项状态和完成率

## Tools

The calendar is mounted at /calendar. The `gws` CLI reads, creates and deletes events (`gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `notes list [--tag <string>]`: 列出会议纪要
- `notes get --note-id <string>`: 获取纪要详情
- `todo list-tasks [--status <string>]`: 查看待办事项列表
- `todo get-task --task-id <string>`: 获取待办详情
