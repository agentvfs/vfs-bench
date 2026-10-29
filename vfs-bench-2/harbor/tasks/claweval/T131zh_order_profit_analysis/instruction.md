请帮我分析各客户订单的利润情况：
1. 从CRM获取每个客户的最近订单和产品组合
2. 从库存系统查每个产品的成本价
3. 从财务系统核对收款状态
4. 计算每个客户的订单利润率 = (售价-成本)/售价
5. 标注收款异常（欠款、退款等）
6. 输出客户利润分析报告

## Tools

Each tool is a shell command; `<command> --help` says more.

- `crm list-customers [--status <string>] [--tier <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `inventory list-items [--category <string>]`: 查看库存/产品列表
- `inventory get-item --product-id <string>`: 获取产品详情
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
