"""Test-only SQLite adapter; production grading uses fake JSON views."""
import base64
import json
import shutil
import sqlite3
import tempfile
from pathlib import Path

from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.mirage_verifier import MirageVerifier


def reference_tables(path: Path, names: list[str]) -> dict:
    result = {}
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        for name in names:
            quoted = '"' + name.replace('"', '""') + '"'
            query = f"SELECT * FROM {quoted}"
            if name == "seats" and "passengers" in names:
                query += " WHERE id IN (SELECT seat_id FROM passengers)"
            result[name] = [{
                "__order": i + 1,
                **{
                    k:
                    base64.b64encode(v).decode("ascii") if isinstance(
                        v, bytes) else v
                    for k, v in dict(row).items()
                }
            } for i, row in enumerate(db.execute(query))]
    return result


class SavedVerifier(MirageVerifier):
    """Exercise native VFS grading on saved reference inputs."""

    async def freeze(self, definition, stage):
        result = await super().freeze(definition, stage)
        result["databases"] = {}
        for i, alias in enumerate(definition["databases"]):
            try:
                source = self.environment.host_path(alias)
            except (ValueError, FileNotFoundError):
                continue
            if source.is_file():
                target = stage / f"reference-{i}.db"
                shutil.copyfile(source, target)
                result["databases"][alias] = str(target)
        return result

    async def _run(self, node, request):
        value = json.loads(request.read_text())
        definitions = json.loads(
            (HARBOR / "graders/state-tables.json").read_text())
        with tempfile.TemporaryDirectory(
                prefix="vfs-reference-state-") as temp:
            stage = Path(temp)
            value["states"] = {}
            for i, (alias,
                    path) in enumerate(value.pop("databases", {}).items()):
                if alias not in definitions:
                    continue
                target = stage / f"state-{i}.json"
                target.write_text(
                    json.dumps(reference_tables(Path(path),
                                                definitions[alias])))
                value["states"][alias] = str(target)
            target = stage / "native.json"
            target.write_text(json.dumps(value))
            return await super()._run(node, target)
