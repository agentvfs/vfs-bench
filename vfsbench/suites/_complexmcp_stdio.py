import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from nodejs_wheel.executable import ROOT_DIR

BUNDLE = Path(__file__).parent / "vendor/complexmcp/mock.mjs"


class Mock:

    def __init__(self, process):
        self.process = process
        self.lock = asyncio.Lock()

    async def request(self, op, **kwargs):
        data = json.dumps({
            "op": op,
            **kwargs
        }, allow_nan=False).encode() + b"\n"
        async with self.lock:
            proc = self.process
            try:
                proc.stdin.write(data)
                await proc.stdin.drain()
                line = await proc.stdout.readline()
                if not line:
                    raise RuntimeError("ComplexMCP mock exited during request")
                reply = json.loads(line)
            except BaseException:
                # An interrupted request may leave a reply pending on stdout.
                if proc.returncode is None:
                    proc.kill()
                raise
            if "error" in reply:
                raise RuntimeError(f"ComplexMCP {op} failed: {reply['error']}")
            return reply["result"]


@asynccontextmanager
async def _stdio_run(run_dir):
    node = Path(ROOT_DIR) / ("node.exe" if os.name == "nt" else "bin/node")
    proc = await asyncio.create_subprocess_exec(
        node,
        BUNDLE,
        cwd=run_dir,
        env={"COMPLEXMCP_SRC": str(run_dir)},
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        limit=16 << 20)
    try:
        yield Mock(proc)
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        await proc.communicate()
