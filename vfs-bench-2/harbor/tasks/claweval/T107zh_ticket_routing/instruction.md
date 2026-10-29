我们有5个新的客户工单待处理。请帮我做以下分析：
1. 查看每个工单的详情和对应客户的CRM信息（注意客户等级和合同状态）
2. 在知识库中搜索相关技术文档，找到适用的排查方案
3. 根据SLA标准和客户等级，重新评估每个工单的优先级
4. 输出完整的路由建议报告，包含：
   - 每个工单的建议优先级（考虑VIP加速和续约期加速规则）
   - 推荐的知识库解决方案
   - 需要升级处理的工单及原因

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: 更新工单（优先级、标签、分类）
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
