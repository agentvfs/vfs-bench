Current date: 2026-03-24

请帮我为3个并行项目(Alpha/Beta/Gamma)生成进度汇报：
1. 查看每个项目的相关会议
2. 阅读会议纪要中的行动项
3. 对比待办事项的完成情况
4. 查找项目负责人联系方式
5. 输出每个项目的进度报告，标注风险项

## Tools

The calendar is mounted at /calendar. The `gws` CLI reads, creates and deletes events (`gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `notes list [--tag <string>]`: 列出会议纪要
- `notes get --note-id <string>`: 获取纪要详情
- `todo list-tasks [--status <string>]`: 查看待办事项列表
- `todo get-task --task-id <string>`: 获取待办详情
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
