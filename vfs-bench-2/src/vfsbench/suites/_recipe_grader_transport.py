"""Verifier-only adapter for the ingredient lookup in
cooking-guidance/evaluation."""

import json
from contextlib import nullcontext
from functools import cache
from pathlib import Path
from types import SimpleNamespace


class MCPServerManager:

    def __init__(self, agent_workspace):
        self.servers = {"howtocook": nullcontext()}


@cache
def _recipes():
    return json.loads(Path("recipes.json").read_bytes())


async def call_tool_with_retry(server, tool, arguments):
    if tool != "mcp_howtocook_getRecipeById":
        raise ValueError(f"Unexpected HowToCook verifier tool {tool}")
    query = arguments["query"]
    recipes = _recipes()
    # howtocook-mcp 0.2.2 first resolves an ID, then a name, then a unique
    # partial
    # name. Its ambiguous/missing responses contain no ingredients for the
    # evaluator.
    recipe = next((r for r in recipes if r["id"] == query), None)
    if recipe is None:
        recipe = next((r for r in recipes if r["name"] == query), None)
    if recipe is None:
        matches = [r for r in recipes if query.lower() in r["name"].lower()]
        recipe = matches[0] if len(matches) == 1 else {}
    return SimpleNamespace(
        content=[SimpleNamespace(text=json.dumps(recipe, ensure_ascii=False))])
