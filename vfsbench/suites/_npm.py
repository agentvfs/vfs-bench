import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def install_locked(dataset, lock):
    """Install the upstream lock once. Trials reuse the immutable Node
    modules."""
    import fcntl

    from nodejs_wheel.executable import ROOT_DIR

    node = Path(ROOT_DIR) / "bin/node"
    npm = Path(ROOT_DIR) / "lib/node_modules/npm/bin/npm-cli.js"
    digest = hashlib.sha256(
        (lock / "package-lock.json").read_bytes()).hexdigest()
    cache = Path(dataset._cache_dir or os.environ.get("XDG_CACHE_HOME")
                 or Path.home() / ".cache")
    cache = (cache / "vfsbench/npm").resolve()
    cache.mkdir(parents=True, exist_ok=True)
    root = cache / digest
    with (cache / (digest + ".lock")).open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        if not root.is_dir():
            with tempfile.TemporaryDirectory(dir=cache) as temporary:
                stage = Path(temporary) / "package"
                shutil.copytree(lock, stage)
                argv = [
                    str(node),
                    str(npm), "ci", "--ignore-scripts", "--no-audit",
                    "--no-fund"
                ]
                if dataset._local_files_only:
                    argv.append("--offline")
                subprocess.run(argv,
                               cwd=stage,
                               check=True,
                               stdout=subprocess.DEVNULL)
                stage.rename(root)
    return node, root / "node_modules"
