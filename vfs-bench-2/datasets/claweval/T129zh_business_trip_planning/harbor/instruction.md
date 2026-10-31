Current date: 2026-03-25

收件箱有几封出差邀请邮件，请帮我规划：
1. 查看所有出差相关邮件
2. 检查日历中对应日期是否有冲突
3. 查找出差目的地的当地同事联系方式
4. 综合分析后给出出差建议方案：
   - 哪些行程冲突需要取舍
   - 推荐的行程安排
   - 各地联系人清单

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
