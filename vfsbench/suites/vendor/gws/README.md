# Mirage Google Workspace mock

`gws.mjs` is Mirage's Apache-2.0 Google Workspace mock at commit `3e0c6d500bddd2be028e4ceaa5439604ed4fb9c4`, immediately before its Prisma migration. The mock keeps its state in the Node process. VFS-Bench starts a separate loopback listener and process for each trial. This version needs only Node built-ins. [Mirage source](https://github.com/strukto-ai/mirage/blob/3e0c6d500bddd2be028e4ceaa5439604ed4fb9c4/integ/server/gws_server.ts)

The vendored file was compiled with esbuild 0.28.2 through `esbuild --loader=ts --format=esm --target=node18 --legal-comments=none` on the original source through stdin. The original copyright header was prepended. `start.mjs` selects a kernel-assigned port and reports its address to the controller. The upstream license accompanies the bundle.

The calendar fixture loader preserves an explicitly supplied primary flag and event ID, status, creation time and update time. MCP-Atlas uses these fields to reproduce its recorded calendar. Unspecified fields retain the mock's generated defaults.

The controller may also restore captured Drive file timestamps, permissions, spreadsheet cells and ID counters from Toolathlon’s SQLite fixture via the private reset route. The live Drive and Sheets handlers subsequently serve this trial state.
