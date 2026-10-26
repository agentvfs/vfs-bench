"""Gaia2's apps, as Meta's own gaia2-cli runs them, as one bridge world.

gaia2-cli is upstream's CLI port of Gaia2: one click program per app
(``contacts``, ``emails``, ``chats``, ``cloud-drive``, ...) keeping its state
in JSON files under ``GAIA2_STATE_DIR``, which ``gaia2-init`` writes from a
scenario. This world runs it unchanged:

- the tools are every app's commands, ``<binary>.<command>``, with their
  options as JSON schemas (a bare switch marked ``x-flag``)
- ``reset`` runs ``gaia2-init`` on the scenario into a fresh state dir,
  copying the Files app's files from the ``gaia2_filesystem`` download
- a call runs the binary's command as its own process, as upstream does,
  on the scenario's clock (``launch.py``)
- the snapshot is every app's state file and ``events.jsonl``
"""
import importlib
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import click

from bridge.server import ToolError

HERE = Path(__file__).resolve().parent
LAUNCH = HERE / "launch.py"
# gaia2-cli's own programs that are not apps.
NOT_APPS = {"gaia2-init", "gaia2-eventd", "gaia2-replay"}


def option_schema(param: click.Option) -> dict:
    if param.is_flag:
        schema: dict[str, Any] = {"type": "boolean", "x-flag": True}
    elif isinstance(param.type, click.Choice):
        schema = {"type": "string", "enum": list(param.type.choices)}
    elif param.type is click.INT:
        schema = {"type": "integer"}
    elif param.type is click.FLOAT:
        schema = {"type": "number"}
    else:
        schema = {"type": "string"}
    if param.multiple:
        schema = {"type": "array", "items": schema}
    if param.help:
        schema["description"] = param.help
    # Click marks "no default" with a sentinel object, not None.
    if not param.is_flag and isinstance(param.default, (str, int, float, list, tuple)):
        schema["default"] = param.default
    return schema


class Gaia2:
    """One scenario's apps at a time."""

    def __init__(self, state: str, filesystem: str):
        self.state = Path(state)
        self.filesystem = filesystem
        self.sim_time: float | None = None
        dist = importlib.metadata.distribution("gaia2-cli")
        self.apps = {ep.name: ep.value for ep in dist.entry_points
                     if ep.group == "console_scripts" and ep.name not in NOT_APPS}
        self.catalog: list[dict] = []
        # tool -> property -> (option string, is a switch)
        self.options: dict[str, dict[str, tuple[str, bool]]] = {}
        for binary, target in sorted(self.apps.items()):
            module, _, attr = target.partition(":")
            group = getattr(importlib.import_module(module), attr)
            for name, command in group.commands.items():
                if name == "schema" or command.hidden:
                    continue
                self._add(f"{binary}.{name}", command)

    def _add(self, tool: str, command: click.Command) -> None:
        properties, required, options = {}, [], {}
        for param in command.params:
            if not isinstance(param, click.Option):
                raise ValueError(f"{tool}: positional '{param.name}' is not supported")
            if param.name == "help":
                continue
            flag = max(param.opts, key=len)
            prop = flag.lstrip("-").replace("-", "_")
            properties[prop] = option_schema(param)
            options[prop] = (flag, param.is_flag)
            if param.required:
                required.append(prop)
        self.catalog.append({
            "name": tool,
            "description": (command.help or "").strip(),
            "parameters": {"type": "object", "properties": properties,
                           "required": required},
        })
        self.options[tool] = options

    def tools(self) -> list[dict]:
        return self.catalog

    def reset(self, fixture: str, epoch: str | None) -> None:
        """Load the scenario at ``fixture``, a scenario JSON file."""
        if self.state.exists():
            shutil.rmtree(self.state)
        self.state.mkdir(parents=True)
        scenario = json.loads(Path(fixture).read_text())
        self.sim_time = float(scenario["metadata"]["definition"]["start_time"])
        done = subprocess.run(
            [sys.executable, "-I", LAUNCH, "gaia2_cli.init_cmd:main",
             "gaia2-init", "--scenario", fixture, "--state-dir", str(self.state),
             "--fs-backing-dir", self.filesystem],
            env=self._env(), capture_output=True, text=True)
        if done.returncode != 0:
            raise RuntimeError(f"gaia2-init failed:\n{done.stderr}")

    def _env(self) -> dict:
        return {**os.environ, "GAIA2_STATE_DIR": str(self.state),
                "GAIA2_SIM_TIME": str(self.sim_time)}

    def call(self, tool: str, arguments: dict) -> str:
        binary, _, command = tool.partition(".")
        argv = [command]
        for prop, value in arguments.items():
            flag, switch = self.options[tool][prop]
            if switch:
                if value:
                    argv.append(flag)
            elif isinstance(value, list):
                for item in value:
                    argv += [flag, str(item)]
            else:
                argv += [flag, str(value)]
        done = subprocess.run(
            [sys.executable, "-I", LAUNCH, self.apps[binary], binary, *argv],
            env=self._env(), cwd=self.state, capture_output=True, text=True)
        if done.returncode != 0:
            raise ToolError((done.stderr or done.stdout).strip())
        return done.stdout

    def close(self) -> None:
        # The Files app's copy of the drive is about 250 MB a run; the
        # state files stay for inspection.
        shutil.rmtree(self.state / "filesystem", ignore_errors=True)

    def snapshot(self) -> dict:
        apps = {path.stem: json.loads(path.read_text())
                for path in sorted(self.state.glob("*.json"))}
        events = self.state / "events.jsonl"
        lines = events.read_text().splitlines() if events.exists() else []
        return {"apps": apps, "events": [json.loads(line) for line in lines]}
