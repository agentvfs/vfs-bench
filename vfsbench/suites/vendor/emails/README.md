The uv project and lockfile are the original vfs-bench-1/vendor/emails-mcp project at 3f45f90f620c8096dd85bbe854b757eae1231392. tools.json lists all 25 original emails-mcp 0.1.12 tools. The service runs in a disposable container that shares only its private Mirage mail server’s network namespace. Its only writable host mount is the trial workspace.

The image verifies the original SMTP backend hash and adds the missing initial EHLO on its plain loopback connection, so the original authentication check sees the server capabilities.
