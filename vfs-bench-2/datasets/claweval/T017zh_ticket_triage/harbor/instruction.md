帮我看看待处理工单，分个类排个优先级，关联的标一下。请不要关闭任何工单。

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 获取工单列表
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: 更新工单信息
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
