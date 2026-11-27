"""Rebuild the offline W&B server shipped in the Python wheel."""

import argparse
import io
import json
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

MIRAGE = "245bf3f2a96442caf830c098c15248e103624eba"
VFS_BENCH = "3f45f90f620c8096dd85bbe854b757eae1231392"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mirage", required=True, type=Path)
    parser.add_argument("--graphql",
                        required=True,
                        type=Path,
                        help="installed graphql@16.11.0 directory")
    parser.add_argument("--esbuild", required=True, type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[2]
    dest = project / "src/vfsbench/suites/vendor/wandb"
    package = json.loads((args.graphql / "package.json").read_bytes())
    if package["version"] != "16.11.0":
        raise ValueError("Use graphql@16.11.0 from Mirage's pinned lock")
    binary = args.esbuild.resolve()
    if subprocess.check_output([binary, "--version"]).strip() != b"0.28.2":
        raise ValueError("Use esbuild 0.28.2")
    with tempfile.TemporaryDirectory() as temp:
        stage = Path(temp)
        arc = subprocess.check_output([
            "git", "-C", args.mirage, "archive", MIRAGE, "integ/server/wandb",
            "integ/server/kit/typescript", "LICENSE"
        ])
        with tarfile.open(fileobj=io.BytesIO(arc)) as archive:
            archive.extractall(stage, filter="data")
        shutil.copytree(args.graphql, stage / "node_modules/graphql")
        source = subprocess.check_output([
            "git", "-C", project, "show",
            VFS_BENCH + ":vfs-bench-1/server/fakes/wandb_api.mjs"
        ]).decode()
        source = source.replace("../../submodule/mirage/", "./")
        source = source.replace(
            "import { startFiles } from './wandb_files.mjs'\n", "")
        # This capture includes every file. Remove the v1 network-fetch branch.
        source = source[:source.index("const remote =")] + """
if (runs.some(run => Object.values(run.files).some(file => file.remote))) {
  throw new Error('This capture requires unavailable remote files')
}
const server = await startWandb(
  parsePort(), parseFixture(), parseFixtureRoot())
console.log(`WANDB_BASE_URL=${server.base}`)
"""
        (stage / "server.mjs").write_text(source)
        subprocess.run([
            binary, "server.mjs", "--bundle", "--platform=node",
            "--target=node18", "--main-fields=module,main", "--format=esm",
            "--legal-comments=none",
            "--banner:js=// Includes Mirage (Apache-2.0), graphql-js and "
            "VFS-Bench (MIT). See adjacent licenses.",
            f"--outfile={dest}/server.mjs"
        ],
                       cwd=stage,
                       check=True)
        shutil.copyfile(stage / "LICENSE", dest / "LICENSE.mirage")
        shutil.copyfile(args.graphql / "LICENSE", dest / "LICENSE.graphql")


if __name__ == "__main__":
    main()
