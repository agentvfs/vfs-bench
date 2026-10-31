帮我从CRM系统导出一份VIP客户报告。需要：
1. 列出所有VIP客户
2. 获取每位VIP客户的详细信息
3. 生成一份包含所有VIP客户的汇总报告，包括客户名称、行业、年收入和最近联系日期
注意：系统最近不太稳定，如果遇到错误请重试。

## Tools

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: 获取CRM客户列表，可按状态、等级、行业筛选
- `crm get-customer --customer-id <string>`: 获取单个客户的完整详细信息
- `crm export-report --title <string> --customer-ids <value> ... --summary <string>`: 导出客户汇总报告
