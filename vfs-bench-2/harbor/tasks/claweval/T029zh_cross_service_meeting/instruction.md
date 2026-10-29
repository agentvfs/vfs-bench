Current date: 2026-03-03

收件箱里有一封Partner Corp陈总监发来的项目评审会议邀请。
请帮我处理：
1. 阅读邮件了解会议需求
2. 查找赵磊和李明的联系方式
3. 查看他们周三（2026年3月4日）下午的日程安排
4. 找到所有人都有空的时段，安排一个2小时的会议
5. 给陈总监回复确认邮件，告知会议时间

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 将邮件保存为草稿
- `contacts search --query <string> [--department <string>]`: 搜索通讯录中的联系人
- `contacts get --contact-id <string>`: 获取联系人详细信息
