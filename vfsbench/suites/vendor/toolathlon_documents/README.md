# Toolathlon document servers

The archive contains the Word and PowerPoint MCP implementations, their licenses, and the uv locks from the [Toolathlon-Gym commit used in v1](https://github.com/eigent-ai/toolathlon_gym/tree/45bbff81419fedbb6d5a2cb46029d2980a7c93c4/local_servers). It also includes the [v1 PDF service dependency lock](https://github.com/agentvfs/vfs-bench/tree/3f45f90f620c8096dd85bbe854b757eae1231392/vfs-bench-1/vendor/pdf-tools-mcp). The separately hash-verified upstream PDF wrapper is mounted at runtime.

Docker builds the read-only service image using each server's original uv lock. Every trial starts separate containers for its declared document services, mounts only the trial workspace for document access, and disables networking. The PDF service supports reading the task's local PDF. URL downloads require network access and are unavailable in this execution environment.
