我们需要采购一批服务器，帮我做一个供应商评估。请：
1. 查看库存系统了解当前服务器库存和需求
2. 检查RSS新闻了解各供应商的市场动态
3. 在CRM中查看各供应商的合作历史和状态
4. 查看知识库的采购政策和评估标准
5. 查看财务系统的预算和历史采购记录
6. 综合所有信息给出供应商评估报告和采购建议
注意：不要直接下采购单或联系供应商，只做评估分析。

## Tools

Each tool is a shell command; `<command> --help` says more.

- `inventory list-products [--category <string>]`: 获取商品库存列表
- `inventory get-product --product-id <string>`: 获取单个商品的详细库存信息
- `rss list-articles [--source <string>] [--category <string>] [--max-results <integer>]`: 获取文章列表
- `rss get-article --article-id <string>`: 获取文章完整内容
- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: 获取CRM客户列表，可按状态、等级、行业筛选
- `crm get-customer --customer-id <string>`: 获取单个客户的完整详细信息
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章详情
- `finance list-transactions [--start-date <string>] [--end-date <string>]`: 获取费用交易记录列表
- `finance get-transaction --transaction-id <string>`: 获取单笔交易详情
- `finance report-submit --title <string> --content <string> [--total-amount <number>] [--report-type <string>]`: 提交财务报告
