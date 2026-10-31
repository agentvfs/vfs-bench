最近收到多个客户工单反映发货延迟，请帮我追查原因：
1. 查看相关工单了解客户诉求
2. 检查库存系统找出缺货产品
3. 查看采购记录和财务流水
4. 在CRM中查看供应商状态
5. 输出一份供应链异常分析报告，还原完整问题链

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk update-ticket --ticket-id <string> [--priority <string>] [--tags <value> ...] [--category <string>]`: 更新工单（优先级、标签、分类）
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
- `inventory list-items [--category <string>]`: 查看库存列表
- `inventory get-item --product-id <string>`: 获取库存品详情
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户和供应商
- `crm get-customer --customer-id <string>`: 获取客户或供应商详情
