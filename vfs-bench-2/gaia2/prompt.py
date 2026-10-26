"""Render gaia2-cli's agent prompt for a scenario, as upstream does.

Reads ``{"scenario", "template", "exec_tool"}`` on stdin and prints the
prompt as JSON: upstream's ``render_agent_prompt.render`` fills
``AGENTS_TEMPLATE.md`` with the scenario's apps from gaia2-cli's
registry. That script ships outside gaia2-cli's package, so its few lines
are repeated here.
"""
import json
import sys
from pathlib import Path

from gaia2_cli.app_registry import resolve_scenario_tools

MESSAGING = {"messages", "chats"}


def main() -> int:
    data = json.load(sys.stdin)
    tools = resolve_scenario_tools(data["scenario"])["tools"]
    tool_list = "\n".join(f"- `{name}` — {about}"
                          for name, about in sorted(tools.items()))
    messaging = [k for k in sorted(tools) if k in MESSAGING]
    prompt = (Path(data["template"]).read_text()
              .replace("{{TOOL_LIST}}", tool_list)
              .replace("{{MESSAGING_TOOLS}}",
                       ", ".join(messaging) if messaging else "messages, chats")
              .replace("{{EXEC_TOOL}}", data["exec_tool"]))
    print(json.dumps(prompt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
