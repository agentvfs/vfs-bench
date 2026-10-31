老板让我整理本周AI/大模型行业简报，请帮忙：
1. 从RSS源中筛选本周与AI/大模型相关的文章
2. 按主题分类（模型发布/应用落地/AI芯片）
3. 整理成结构化的简报草稿
4. 以邮件草稿形式准备好，不要直接发送

## Tools

The mailbox is mounted at /gmail. The `gws` CLI reads and sends mail (`gws gmail --help`).

Each tool is a shell command; `<command> --help` says more.

- `rss list-articles [--feed-name <string>] [--category <string>] [--max-results <integer>]`: 获取RSS文章列表
- `rss get-article --article-id <string>`: 获取文章详情
- `gmail save-draft --to <string> --subject <string> --body <string>`: 保存邮件草稿
