"""Download Claw-Eval at its pinned commit.

    uv run --project datasets/claweval python -I datasets/claweval/download.py

Clones upstream (MIT) into ``state/claweval/src``, checking out only
``mock_services/``, ``tasks/`` and ``src/``: the services, each task's
definition, fixtures and grader, and the graders' shared code. The
services and graders run in this directory's uv project.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
HARBOR = ROOT / "formats" / "harbor"
SRC = ROOT / "state" / "claweval" / "src"
REPO = "https://github.com/claw-eval/claw-eval.git"
COMMIT = "5680b8b11ff2ee5dd2b07b89086a29a5c5c984d7"


def git(*args: str) -> None:
    subprocess.run(["git", "-C", str(SRC), *args], check=True)


def main() -> int:
    if not (SRC / ".git").is_dir():
        SRC.parent.mkdir(parents=True, exist_ok=True)
        clone = ["git", "clone", "--quiet", "--filter=blob:none"]
        subprocess.run([*clone, "--no-checkout", REPO, str(SRC)], check=True)
    git("sparse-checkout", "set", "--no-cone", "/mock_services/", "/tasks/",
        "/src/")
    git("checkout", "--quiet", COMMIT)
    print(f"Claw-Eval {COMMIT[:7]} in {SRC}")
    # The files not committed: the PDFs and the config-audit fixtures, then
    # the graders that quote those fixtures' credentials, and their ports.
    for script, project, *args in ((HERE / "convert.py", HARBOR),
                                   (HERE / "graders" / "build.py", HERE,
                                    "--withheld")):
        done = subprocess.run([
            "uv", "run", "--project",
            str(project), "python", "-I",
            str(script), *args
        ])
        if done.returncode:
            return done.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
