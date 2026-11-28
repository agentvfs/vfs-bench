import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

NOTEBOOK = (Path(__file__).resolve().parents[1] / "examples" /
            "complexmcp_colab.ipynb")


@unittest.skipUnless(importlib.util.find_spec("agents"),
                     "install vfsbench[notebook]")
class NotebookTests(unittest.IsolatedAsyncioTestCase):

    async def test_failed_attempts_preserve_messages_and_continue(self):
        from agents import Model, ModelResponse, Usage
        from openai.types.responses import ResponseFunctionToolCall

        class LocalModel(Model):

            def get_model(self, name):
                return self

            async def get_response(self, system_instructions, input, *args,
                                   **kwargs):
                if input[0]["content"] == tasks[0].instruction:
                    raise RuntimeError("simulated model error")
                if any(m.get("type") == "function_call_output" for m in input):
                    waiting.set()
                    await asyncio.Event().wait()
                call = ResponseFunctionToolCall(
                    type="function_call",
                    call_id="c",
                    name="exec_command",
                    arguments='{"cmd":"echo observed"}')
                return ModelResponse([call], Usage(), None)

            async def stream_response(self, *args, **kwargs):
                raise NotImplementedError

        cells = json.loads(NOTEBOOK.read_bytes())["cells"]
        ns = {}
        for cell in cells:
            code = "".join(cell["source"])
            if cell["cell_type"] == "code" and ("suite = ComplexMCP()" in code
                                                or "async def benchmark("
                                                in code):
                exec(code, ns)
        ns.update(PARALLELISM=1, MAX_TURNS=1)
        tasks = [
            ns["suite"][name] for name in ("mint-100g", "mark-sean-baker-read")
        ]
        waiting = asyncio.Event()
        model = LocalModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rewards = await ns["benchmark"](tasks, model, root / "turns")
            self.assertEqual(rewards, [None, 0])
            second = tasks[1]
            ns.update(MAX_TURNS=5, TIMEOUT_SECONDS=1)
            await ns["benchmark"]([second], model, root / "timeout")
            for directory, status in (("turns", "MaxTurnsExceeded"),
                                      ("timeout", "TimeoutError")):
                path = root / directory / f"{second.id}.json"
                report = json.loads(path.read_bytes())
                self.assertEqual(report["agent_status"], status)
                messages = report["trace"]["agent"]["messages"]
                self.assertEqual(messages[0]["content"], second.instruction)
                self.assertTrue(
                    any(m.get("type") == "function_call" for m in messages))
                self.assertTrue(
                    any("observed" in str(m.get("output", ""))
                        for m in messages))

            ns["TIMEOUT_SECONDS"] = 30
            waiting.clear()
            job = asyncio.create_task(ns["benchmark"]([second], model,
                                                      root / "cancel"))
            await asyncio.wait_for(waiting.wait(), 10)
            job.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await job
