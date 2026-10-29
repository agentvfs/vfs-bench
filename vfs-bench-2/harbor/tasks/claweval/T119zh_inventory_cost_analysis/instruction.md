请帮我做一次库存与采购成本的交叉核对：
1. 查看当前所有库存品的数量和单位成本
2. 查看财务系统中对应的采购交易记录
3. 比对：库存记录的单价是否与实际采购价一致
4. 找出成本异常的品类（单价差异、分批采购价格不同等）
5. 输出成本分析报告

## Tools

Each tool is a shell command; `<command> --help` says more.

- `inventory list-items [--category <string>]`: 查看库存列表
- `inventory get-item --product-id <string>`: 获取库存品详情
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 查看交易记录
- `finance get-transaction --transaction-id <string>`: 获取交易详情
