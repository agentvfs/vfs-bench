当前有5个未解决的客户工单。请帮我：
1. 查看每个工单的详情
2. 在知识库中搜索相关文章，为每个工单匹配最相关的解决方案
3. 注意检查知识库文章的更新日期，标注过时的文章
4. 对于知识库中没有匹配方案的工单，标注为需要人工处理
5. 输出建议回复汇总表

## Tools

Each tool is a shell command; `<command> --help` says more.

- `helpdesk list-tickets [--status <string>]`: 列出工单
- `helpdesk get-ticket --ticket-id <string>`: 获取工单详情
- `helpdesk close-ticket --ticket-id <string> --resolution <string>`: 关闭工单
- `kb search --query <string> [--category <string>] [--max-results <integer>]`: 搜索知识库文章
- `kb get-article --article-id <string>`: 获取知识库文章全文
