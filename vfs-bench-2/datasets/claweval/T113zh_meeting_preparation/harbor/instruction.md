Current date: 2026-03-26

请帮我准备明天的会议材料：
1. 查看明天所有会议的安排
2. 汇总每个会议的参会者清单
3. 在通讯录中查找每位参会者的联系方式和职位
4. 输出一份会议准备材料，包含：每个会议的时间/地点/参会者详情
5. 特别标注外部参会者（不在通讯录中的人）和最忙的同事

## Tools

The calendar is mounted at /calendar. The `gws` CLI reads, creates and deletes events (`gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
