"""Check provenance, including dependencies hidden by frozen DVC stages."""
import hashlib
import json
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
TASKS = ("wandb-best-score", "wandb-shortest-length")


def file_drift(root: Path) -> list[str]:
    """Check locked file inputs and outputs even when a stage is frozen.

    DVC itself checks directory output hashes; do not invent its tree hash.
    A gitignored entry names bytes no commit carries -- a capture or a
    generated package tree that `dvc repro` materializes. A fresh checkout
    has nothing to hash them against, so their absence is not drift, and
    the recorded hash stands until repro runs.
    """
    stages = yaml.safe_load((root / "dvc.lock").read_text())["stages"]
    drift = []
    for name, stage in stages.items():
        # DVC updates this validator's own inputs only after it succeeds.
        if name == "wandb-lineage":
            continue
        for entry in [*stage.get("deps", []), *stage.get("outs", [])]:
            path = root / entry["path"]
            expected = entry["md5"]
            if not path.exists():
                if not ignored(root, entry["path"]):
                    drift.append(f"{name}: missing {entry['path']}")
            elif expected.endswith(".dir"):
                if not path.is_dir():
                    drift.append(f"{name}: not a directory: {entry['path']}")
            elif not path.is_file() or hashlib.md5(
                    path.read_bytes()).hexdigest() != expected:
                drift.append(f"{name}: changed {entry['path']}")
    return drift


def ignored(root: Path, relative: str) -> bool:
    """Whether git carries no bytes for the path, so none can be checked."""
    # check-ignore matches a directory-only pattern only for a query that
    # names a directory, which a path repro has not built yet does not.
    return any(
        subprocess.run(["git", "check-ignore", "-q", "--", probe],
                       cwd=root,
                       check=False).returncode == 0
        for probe in (relative, relative.rstrip("/") + "/"))


def git(*args: str, cwd: Path = REPO) -> bytes:
    """Read committed source without using setup's patched working tree."""
    return subprocess.check_output(["git", *args], cwd=cwd)


class Lineage(unittest.TestCase):

    def test_locked_files_including_frozen_dependencies(self):
        self.assertEqual(file_drift(REPO), [])

    def test_frozen_dependency_drift_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "capture.py"
            source.write_bytes(b"original")
            lock = {
                "stages": {
                    "capture": {
                        "deps": [{
                            "path":
                            source.name,
                            "md5":
                            hashlib.md5(source.read_bytes()).hexdigest()
                        }]
                    }
                }
            }
            (root / "dvc.lock").write_text(yaml.safe_dump(lock))
            self.assertEqual(file_drift(root), [])
            source.write_bytes(b"changed")
            self.assertEqual(file_drift(root), ["capture: changed capture.py"])

    def test_effective_submodules_match_gitlinks(self):
        for name in ("Toolathlon", "toolathlon_gym", "mirage"):
            path = f"submodule/{name}"
            mode, revision, _ = git("ls-files", "--stage", path).split()[:3]
            self.assertEqual(mode, b"160000")
            self.assertEqual(
                git("rev-parse", "HEAD", cwd=REPO / path).strip(), revision)

    def test_all_toolathlon_prompts_match_pinned_sources(self):
        stages = yaml.safe_load((REPO / "dvc.lock").read_text())["stages"]
        for dataset, upstream, stage in (("toolathlon", "Toolathlon", "ask"),
                                         ("toolathlon-gym", "toolathlon_gym",
                                          "gym-ask")):
            for prompt in (REPO / "task" / dataset).glob("*/shared/task.md"):
                task = prompt.parents[1].name
                with self.subTest(dataset=dataset, task=task):
                    tracked = stages[f"{stage}@{task}"]
                    self.assertIn(str(prompt.relative_to(REPO)),
                                  [out["path"] for out in tracked["outs"]])
                    self.assertEqual(
                        prompt.read_bytes(),
                        git("show",
                            f"HEAD:tasks/finalpool/{task}/docs/task.md",
                            cwd=REPO / "submodule" / upstream))

    def test_wandb_capture_and_task_sources(self):
        base = REPO / "task/toolathlon"
        capture = json.loads((base / "shared/fixtures/wandb/"
                              "deepscaler-1.5b.json").read_text())
        source = capture["source"]
        upstream = REPO / "submodule/Toolathlon"
        self.assertEqual(
            source["toolathlon"]["revision"],
            git("rev-parse", "HEAD", cwd=upstream).decode().strip())
        for path, digest in source["capture_sha256"].items():
            self.assertEqual(
                hashlib.sha256((REPO / path).read_bytes()).hexdigest(), digest,
                path)
        for task in TASKS:
            local = base / task
            path = f"tasks/finalpool/{task}/docs/task.md"
            original = git("show", f"HEAD:{path}", cwd=upstream)
            self.assertEqual((local / "shared/task.md").read_bytes(), original)
            self.assertIn(source["url"].encode(), original)
            self.assertEqual(
                hashlib.sha256(original).hexdigest(),
                source["toolathlon"]["task_sha256"][path])
            manifest = json.loads((local / "shared/wandb.json").read_text())
            workspace = yaml.safe_load(
                (local / "vfs/workspace.yaml").read_text())
            config = workspace["mounts"]["/wandb"]["config"]
            self.assertEqual(set(config["entities"]), set(capture["entities"]))
            for projects in capture["entities"].values():
                self.assertIn(manifest["fixture"], projects)
            prefix = f"tasks/finalpool/{task}/"
            # These inputs are read in place, so the gitlink is their lineage.
            paths = git("ls-tree",
                        "-r",
                        "--name-only",
                        "HEAD",
                        prefix,
                        cwd=upstream).decode().splitlines()
            for path in paths:
                if any(part in path
                       for part in ("/initial_workspace/", "/evaluation/",
                                    "/task_config.json")):
                    self.assertEqual((upstream / path).read_bytes(),
                                     git("show", f"HEAD:{path}", cwd=upstream),
                                     path)

    def test_wandb_mcp_source_and_lock(self):
        vendor = REPO / "vendor/wandb-mcp"
        project = tomllib.loads((vendor / "pyproject.toml").read_text())
        source = project["tool"]["uv"]["sources"]["wandb-mcp-server"]
        self.assertRegex(source["rev"], r"^[0-9a-f]{40}$")
        lock = tomllib.loads((vendor / "uv.lock").read_text())
        package = next(p for p in lock["package"]
                       if p["name"] == "wandb-mcp-server")
        self.assertEqual(
            package["source"]["git"],
            f"{source['git']}?rev={source['rev']}#{source['rev']}")
        config = git("show",
                     "HEAD:configs/mcp_servers/wandb.yaml",
                     cwd=REPO / "submodule/Toolathlon").decode()
        self.assertIn(source["git"], config)


if __name__ == "__main__":
    unittest.main()
