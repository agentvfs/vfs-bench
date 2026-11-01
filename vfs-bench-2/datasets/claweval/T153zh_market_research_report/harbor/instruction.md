你是市场研究团队的分析师，需要完成一份综合市场研究报告：

1. 查看邮件，了解报告的具体要求和来自销售团队的市场反馈
2. 从RSS源收集行业最新动态（AI趋势、行业政策、市场变化）
3. 在知识库中查找公司内部的市场分析、竞争力评估和行业策略
4. 从CRM系统获取客户分布数据，分析各行业客户结构
5. 综合以上信息，撰写Q1市场研究报告，包括：
   - 三大行业趋势分析（AI对目标行业的影响、政策变化、风险识别）
   - CRM客户数据与行业趋势的关联分析
   - 战略建议（结合内部能力和外部趋势）
6. 查找管理层联系方式，起草报告邮件草稿发给全体管理层（不要直接发送）

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `rss list-articles [--feed-name <string>] [--category <string>] [--max-results <integer>]`: 获取RSS文章列表
- `rss get-article --article-id <string>`: 获取文章详情
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
- `crm list-customers [--status <string>] [--tier <string>] [--industry <string>]`: 列出客户
- `crm get-customer --customer-id <string>`: 获取客户详情
- `contacts search --query <string> [--department <string>]`: 搜索内部通讯录
- `contacts get --contact-id <string>`: 获取联系人详情
- `gmail save-draft --to <string> --subject <string> --body <string>`: 保存邮件草稿
