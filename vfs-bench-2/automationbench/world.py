"""AutomationBench's simulated SaaS world, as one bridge world.

Upstream's own code does all the work, as its ``AutomationBenchEnv`` does
with ``toolset="api"``, the benchmark's default:

- the tools are upstream's ``API_TOOLS`` (``api_search``, ``api_fetch``,
  ``base64_encode``), described as its environment describes them to a
  model
- ``reset`` builds the ``WorldState`` from the task's ``initial_state``
  (``None`` values stripped) and gates its services with
  ``compute_allowed_services``, as ``setup_state`` does
- a call drops ``{}`` arguments and passes the world, as
  ``update_tool_args`` does
- the snapshot is the world, dumped as JSON
"""
import json
from pathlib import Path
from typing import Any

from automationbench.runner import (AutomationBenchEnv,
                                    compute_allowed_services,
                                    strip_none_values)
from automationbench.rubric import create_rubric
from automationbench.schema.world import WorldState
from automationbench.tools.api import API_TOOLS
from datasets import Dataset


class AutomationBench:
    """One task's world at a time."""

    def __init__(self):
        # Upstream's environment, only to read the tool schemas it builds.
        env = AutomationBenchEnv(
            dataset=Dataset.from_list([{"prompt": [], "answer": "", "info": "{}"}]),
            rubric=create_rubric(), toolset="api")
        self.catalog = [t["function"] for t in env._all_oai_tools]
        self.functions = {tool.__name__: tool for tool in API_TOOLS}
        self.world: WorldState | None = None

    def tools(self) -> list[dict]:
        return self.catalog

    def reset(self, fixture: str, epoch: str | None) -> None:
        """Load the task exported to ``fixture`` by setup.py."""
        info = json.loads(Path(fixture).read_text())["info"]
        initial = strip_none_values(info.get("initial_state", {}))
        self.world = WorldState(**initial)
        self.world.meta.allowed_services = compute_allowed_services(
            initial, info.get("assertions", []), info.get("zapier_tools", []))

    def call(self, tool: str, arguments: dict) -> Any:
        function = self.functions[tool]
        arguments = {k: v for k, v in arguments.items()
                     if not (isinstance(v, dict) and not v)}
        if "world" in function.__code__.co_varnames:
            arguments["world"] = self.world
        return function(**arguments)

    def snapshot(self) -> dict:
        return {"world": self.world.model_dump(mode="json")}
