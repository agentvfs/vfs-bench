"""Entry point assembled after the generated rubric and model adapter."""
import json
from pathlib import Path

# These functions are supplied by the preceding generated program.
task = json.loads(Path("/input/task.json").read_text())
docs = {
    row["name"]: row["doc"]
    for row in json.loads(Path("/input/state.json").read_text())["doc"]
}
world = build_model(  # noqa: F821
    "world.WorldState", json.loads(docs["world"]))
hidden = json.loads(docs.get("meta") or "{}").get("hidden") or {}
for service, attributes in hidden.items():
    for name, value in attributes.items():
        model_set(  # noqa: F821
            model_get(world, service),  # noqa: F821
            name,
            set(value) if (service, name) == ("google_sheets",
                                              "_updated_row_keys") else value)
state = {
    "info": {
        **task,
        "assertions":
        [strip_none_values(a) for a in task["assertions"]]  # noqa: F821
    },
    "initial_state":
    strip_none_values(  # noqa: F821
        task.get("initial_state", {})),
    "world":
    world,
}
credit = ab_rubric__partial_credit(state)  # noqa: F821
details = {
    "partial_credit": credit,
    "task_completed_correctly": float(credit == 1.0),
    "assertions": state.get("_assertion_results", [])
}
Path("/output/reward_details.json").write_text(
    json.dumps(details, ensure_ascii=False))
print(f"partial_credit {credit}")
