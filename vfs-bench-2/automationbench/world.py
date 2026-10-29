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

One change: the ids upstream draws from ``uuid4`` and ``random`` come from
generators seeded with the task's name, so seeding a task twice gives the
same world. Its timestamps still follow the wall clock, as upstream's do
(``index.ts`` declares them).
"""
import json
import random
import sys
import uuid
from pathlib import Path
from typing import Any

from automationbench.rubric import create_rubric
from automationbench.runner import (AutomationBenchEnv,
                                    compute_allowed_services,
                                    strip_none_values)
from automationbench.schema.world import WorldState
from automationbench.tools.api import API_TOOLS
from datasets import Dataset

UUID4 = uuid.uuid4
IDS = random.Random()


def seeded_uuid4() -> uuid.UUID:
    """A version-4 UUID from ``IDS``."""
    return uuid.UUID(int=IDS.getrandbits(128), version=4)


def seed_ids(key: str) -> None:
    """Draw upstream's ids from generators seeded with ``key``.

    ``uuid4`` ids come from ``IDS``. Upstream calls both ``uuid.uuid4()``
    and a module's own ``uuid4()``; both names are looked up at call time.
    The ids its apps draw from ``random`` (HubSpot's, Zendesk's,
    Mailchimp's) come from the module's own generator, seeded here too.
    """
    IDS.seed(key)
    random.seed(key)
    uuid.uuid4 = seeded_uuid4
    for name, module in list(sys.modules.items()):
        if name.startswith("automationbench") and getattr(
                module, "uuid4", None) is UUID4:
            module.uuid4 = seeded_uuid4


class AutomationBench:
    """One task's world at a time."""

    def __init__(self):
        # Upstream's environment, only to read the tool schemas it builds.
        row = {"prompt": [], "answer": "", "info": "{}"}
        env = AutomationBenchEnv(dataset=Dataset.from_list([row]),
                                 rubric=create_rubric(),
                                 toolset="api")
        self.catalog = [t["function"] for t in env._all_oai_tools]
        self.functions = {tool.__name__: tool for tool in API_TOOLS}
        self.world: WorldState | None = None

    def tools(self) -> list[dict]:
        return self.catalog

    def reset(self, fixture: str, epoch: str | None) -> None:
        """Load the task exported to ``fixture`` by setup.py."""
        info = json.loads(Path(fixture).read_text())["info"]
        seed_ids(info["task_name"])
        initial = strip_none_values(info.get("initial_state", {}))
        self.world = WorldState(**initial)
        self.world.meta.allowed_services = compute_allowed_services(
            initial, info.get("assertions", []), info.get("zapier_tools", []))

    def call(self, tool: str, arguments: dict) -> Any:
        function = self.functions[tool]
        arguments = {
            k: v
            for k, v in arguments.items()
            if not (isinstance(v, dict) and not v)
        }
        if "world" in function.__code__.co_varnames:
            arguments["world"] = self.world
        return function(**arguments)

    def snapshot(self) -> dict:
        return {"world": self.world.model_dump(mode="json")}
