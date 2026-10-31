自动补货系统最近出了问题，多个品类缺货。请帮我排查：
1. 查看所有补货定时任务的状态
2. 检查相关API集成配置是否正常
3. 查看库存水位，找出低于安全线的品类
4. 追踪每条故障链：失败任务 → 配置问题 → 库存影响
5. 输出排查报告，包含根因分析和修复建议

## Tools

Each tool is a shell command; `<command> --help` says more.

- `scheduler list-jobs [--status <string>] [--tag <string>]`: 列出定时任务
- `scheduler get-job --job-id <string>`: 获取定时任务详情
- `config list-integrations [--status <string>]`: 查看集成配置列表
- `config get-integration --integration-id <string>`: 获取集成配置详情
- `inventory list-items [--category <string>]`: 查看库存列表
- `inventory get-item --product-id <string>`: 获取库存品详情
