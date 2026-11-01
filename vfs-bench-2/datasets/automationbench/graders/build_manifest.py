"""Pin the 600 task definitions and generate the Monty rubric.

--check-port works in CI without downloaded task fixtures or Pydantic.
--check additionally verifies all generated task.json inputs.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import DIRECTORY, HERE, Generator  # noqa: E402


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-port", action="store_true")
    args = parser.parse_args()
    target = DIRECTORY / "manifest.json"
    manifest = json.loads(target.read_text())
    models = (DIRECTORY / "models.json").read_bytes()
    port = Generator().generate(json.loads(models)).encode()
    sources = {
        p.relative_to(DIRECTORY / "reference").as_posix():
        digest(p.read_bytes())
        for p in sorted((DIRECTORY / "reference").rglob("*"))
        if p.is_file() and "__pycache__" not in p.parts
    }
    assert sources == manifest["reference"], "Pinned upstream source drift"
    assert digest(models) == manifest["models_sha256"], "Pinned schema drift"
    if args.check or args.check_port:
        assert (DIRECTORY /
                "port.py").read_bytes() == port, "Generated Monty port drift"
        assert digest(port) == manifest["port_sha256"], "Monty port hash drift"
    else:
        (DIRECTORY / "port.py").write_bytes(port)
        manifest["port_sha256"] = digest(port)
    for task, definition in manifest["tasks"].items():
        tests = HERE / task / "workspace" / "verifier"
        for name, pin in definition["files"].items():
            if args.check_port and name == "task.json":
                continue  # Downloaded upstream data, absent in CI.
            assert digest(
                (tests / name).read_bytes()) == pin, f"{task}/{name} drift"
    assert len(manifest["tasks"]) == 600
    if not (args.check or args.check_port):
        target.write_text(json.dumps(manifest, indent=2) + "\n")
    print("600 AutomationBench definitions and generated port verified")


if __name__ == "__main__":
    main()
