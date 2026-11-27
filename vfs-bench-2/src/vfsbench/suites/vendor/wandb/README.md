# W&B mock server

The wheel ships a loopback W&B GraphQL server for Toolathlon's two `mluo/deepscaler-1.5b` tasks. It runs Mirage's server and VFS-Bench's adapters for the captured file metadata, pagination and history responses. The adapters require every run file to be present in the capture. Each trial starts its own server process. [Mirage server](https://github.com/strukto-ai/mirage/tree/245bf3f2a96442caf830c098c15248e103624eba/integ/server/wandb) · [VFS-Bench adapters](https://github.com/agentvfs/vfs-bench/blob/3f45f90f620c8096dd85bbe854b757eae1231392/vfs-bench-1/server/fakes/wandb_api.mjs)

The bundle includes Mirage under Apache-2.0, GraphQL.js 16.11.0 under MIT and the repository's MIT-licensed adapter. The adjacent license files cover the external components. [GraphQL.js](https://github.com/graphql/graphql-js/tree/v16.11.0)

To rebuild, run the following in `vfs-bench-2` with a Mirage Git checkout containing the referenced commit and the indicated local tool versions.

```bash
python datasets/toolathlon/build_wandb_mock.py --mirage /path/to/mirage \
  --graphql /path/to/node_modules/graphql --esbuild /path/to/esbuild
```
