从RSS源里挑几篇跟我们AI团队相关的，整理一期技术周报发出去。

## Tools

Each tool is a shell command; `<command> --help` says more.

- `rss list-feeds [--category <string>]`: 获取所有RSS订阅源
- `rss list-articles [--source <string>] [--category <string>] [--max-results <integer>]`: 获取文章列表
- `rss get-article --article-id <string>`: 获取文章完整内容
- `rss publish --title <string> --content <string> [--recipients <value> ...]`: 发布Newsletter
