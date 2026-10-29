Current date: 2026-03-05

下周一（3月9日）有3位新员工入职。请帮我协调安排入职事宜：
1. 查看HR发来的入职邮件了解各人需求
2. 查看知识库了解入职流程
3. 查找各部门经理的联系方式
4. 检查IT设备库存
5. 查看日历安排培训时间（注意避免冲突）
6. 给各部门经理发送入职通知（注意：对于没有部门经理的部门，只保存草稿不发送）
7. 创建入职跟进待办事项
8. 给我一份入职安排总结

## Tools

The mailbox is mounted at /gmail and the calendar at /calendar. The `gws` CLI reads and sends mail and reads, creates and deletes events (`gws gmail --help` and `gws calendar --help`).

Each tool is a shell command; `<command> --help` says more.

- `gmail save-draft --to <string> --subject <string> --body <string> [--reply-to-message-id <string>]`: 将邮件保存为草稿
- `todo list-tasks [--status <string>] [--priority <string>]`: 获取待办事项列表
- `todo create-task --title <string> [--description <string>] [--priority <string>] [--due-date <string>] [--tags <value> ...]`: 创建新的待办事项
- `todo update-task --task-id <string> [--status <string>] [--priority <string>] [--title <string>] [--description <string>]`: 更新待办事项
- `contacts search --query <string> [--department <string>]`: 搜索通讯录中的联系人
- `contacts get --contact-id <string>`: 获取联系人详细信息
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章详情
- `inventory list-products [--category <string>] [--status <string>]`: 获取库存产品列表
- `inventory get-product --product-id <string>`: 获取产品库存详情
