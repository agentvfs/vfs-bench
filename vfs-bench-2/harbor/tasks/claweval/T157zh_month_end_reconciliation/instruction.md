月末了，请帮我做一次全面对账：
1. 检查对账相关自动化任务的执行状态
2. 检查支付和发票系统集成配置
3. 核对财务流水与CRM客户应收
4. 核对采购记录与库存变动
5. 找出所有异常并输出对账报告

## Tools

Each tool is a shell command; `<command> --help` says more.

- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看财务交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
- `crm list-customers [--status <string>] [--tier <string>]`: 查看客户列表
- `crm get-customer --customer-id <string>`: 获取客户详情
- `config list-integrations [--status <string>]`: 查看所有系统集成配置
- `config get-integration --integration-id <string>`: 获取集成配置详情
- `inventory list-products [--category <string>]`: 查看库存产品列表
- `inventory get-product --product-id <string>`: 获取库存产品详情
- `scheduler list-jobs [--status <string>] [--tag <string>]`: 列出所有定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情（含执行历史）
- `scheduler job-history --job-id <string> [--limit <integer>]`: 查看定时任务执行历史
