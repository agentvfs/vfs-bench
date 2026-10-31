当前有6个未分配的工单，请帮我做分配建议：
1. 查看每个工单的详情，了解问题类型和提交部门
2. 在通讯录中查找各部门负责人
3. 根据问题类型匹配最合适的处理人
4. 注意区分IT问题和非IT问题
5. 输出分配建议表（工单→建议处理人→分配理由）

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
