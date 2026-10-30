"""Fetch EnterpriseOps-Gym at its pinned commit, its seeds and its tasks.

    uv run --project enterpriseops python -I enterpriseops/setup.py

Clones upstream (ServiceNow/EnterpriseOps-Gym, Apache-2.0) into
``state/enterpriseops/src``, unzips its seed databases (``gym_dbs.zip``) into
``state/enterpriseops/dbs``, and downloads the Hugging Face dataset's task
files (ServiceNow-AI/EnterpriseOps-Gym, Apache-2.0) at a pinned revision into
``state/enterpriseops/hf/<mode>/<domain>.parquet``.

Upstream's tool servers ship only as Docker images. Their tool lists, as
each image's ``tools/list`` answers, are committed under
``enterpriseops/tools/`` with the image's digest; their tables are each
fake's ``schema.sql`` (mocks/enterpriseops_<domain>/).
"""
import subprocess
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "state" / "enterpriseops"
REPO = "https://github.com/ServiceNow/EnterpriseOps-Gym.git"
COMMIT = "271f2c357f763376997dfd16807fcde2474ae41b"
DATASET = "ServiceNow-AI/EnterpriseOps-Gym"
REVISION = "c8e538eae8a6205294f0a86675fefdc1fac408f6"
MODES = ["oracle", "plus_5_tools", "plus_10_tools", "plus_15_tools"]
DOMAINS = ["calendar", "csm", "drive", "email", "hr", "hybrid", "itsm", "teams"]


def main() -> int:
    src = STATE / "src"
    if not (src / ".git").is_dir():
        STATE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", REPO, str(src)], check=True)
    subprocess.run(["git", "-C", str(src), "checkout", "--quiet", COMMIT],
                   check=True)
    dbs = STATE / "dbs"
    if not dbs.is_dir():
        with zipfile.ZipFile(src / "gym_dbs.zip") as archive:
            archive.extractall(STATE / "dbs.partial")
        (STATE / "dbs.partial").rename(dbs)
    for mode in MODES:
        for domain in DOMAINS:
            target = STATE / "hf" / mode / f"{domain}.parquet"
            if target.is_file():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            url = (f"https://huggingface.co/datasets/{DATASET}/resolve/"
                   f"{REVISION}/{mode}/{domain}-00000-of-00001.parquet")
            with urllib.request.urlopen(url, timeout=120) as reply:
                data = reply.read()
            partial = target.with_suffix(".partial")
            partial.write_bytes(data)
            partial.rename(target)
    print(f"EnterpriseOps-Gym {COMMIT[:7]} and {DATASET}@{REVISION[:7]} "
          f"in {STATE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
