需要整理竞品情报报告：
1. 查看邮件了解报告要求和一线销售反馈
2. 从RSS源收集竞品A和竞品B的最新动态
3. 在知识库中查找我们已有的竞品分析
4. 整合信息，输出竞品情报报告：
   - 竞品A动态分析（新版本+AI功能威胁）
   - 竞品B动态分析（融资+出海策略）
   - 对我司的影响和应对建议
5. 准备邮件草稿（不要直接发送）

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `rss list-articles [--feed-name <string>] [--category <string>] [--max-results <integer>]`: 获取RSS文章列表
- `rss get-article --article-id <string>`: 获取文章详情
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
- `gmail save-draft --to <string> --subject <string> --body <string>`: 保存邮件草稿
