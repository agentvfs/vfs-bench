最近开了几次重要会议，请帮我：
1. 查看所有会议纪要，提取其中的行动项
2. 查看当前待办清单
3. 将会议行动项与现有待办对比，找出已有对应待办的（避免重复创建）
4. 列出需要新建的待办事项
5. 输出完整的行动项跟踪表（含来源会议、负责人、截止日期、是否已有待办）

## Tools

Each tool is a shell command; `<command> --help` says more.

- `notes list [--tag <string>]`: 列出会议纪要
- `notes get --note-id <string>`: 获取纪要详情
- `todo list-tasks [--status <string>]`: 查看待办事项列表
- `todo get-task --task-id <string>`: 获取待办详情
