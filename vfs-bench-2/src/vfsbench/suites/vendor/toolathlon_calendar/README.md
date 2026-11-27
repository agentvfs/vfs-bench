# Toolathlon Calendar MCP

The package manifest, npm integrity lock, Google API redirect and placeholder OAuth files come from the [v1 integration](https://github.com/agentvfs/vfs-bench/tree/3f45f90f620c8096dd85bbe854b757eae1231392/vfs-bench-1). Its original server is `@gongrzhe/server-calendar-autoauth-mcp@1.0.2`. Every trial starts a fresh server connected to its own Mirage calendar. The placeholder OAuth files identify the local mock. The redirect only routes Calendar API calls through the trial controller.
