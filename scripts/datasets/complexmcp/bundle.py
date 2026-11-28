import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PORT = ROOT / "vfs-bench-2/datasets/complexmcp"
VENDOR = ROOT / "vfsbench/suites/vendor/complexmcp"


def main():
    description = ('Rebuild the installed mock and judge from the existing '
                   'ComplexMCP port.')
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--esbuild", default="esbuild")
    parser.add_argument("--yaml",
                        type=Path,
                        default=ROOT / "vfs-bench-2/node_modules/yaml")
    args = parser.parse_args()
    if subprocess.check_output([args.esbuild, "--version"],
                               text=True).strip() != "0.28.2":
        parser.error("Install esbuild@0.28.2")
    yaml_version = json.loads(
        (args.yaml / "package.json").read_bytes())["version"]
    if yaml_version != "2.9.0":
        parser.error("Install yaml@2.9.0")
    subprocess.run([
        args.esbuild, "scripts/datasets/complexmcp/mock.ts", "--bundle",
        "--platform=node", "--format=esm", "--target=node24", "--minify",
        ("--banner:js=import {createRequire} from 'node:module'; "
         "const require=createRequire(import.meta.url);"),
        "--legal-comments=none",
        "--outfile=vfsbench/suites/vendor/complexmcp/mock.mjs",
        f"--alias:yaml={args.yaml.resolve()}"
    ],
                   cwd=ROOT,
                   check=True)
    shutil.copyfile(args.yaml / "LICENSE", VENDOR / "LICENSE.yaml.txt")
    shutil.copyfile(PORT / "graders/reference/LICENSE", VENDOR / "LICENSE")
    shutil.copyfile(PORT / "graders/levenshtein.py", VENDOR / "dist.py")
    judge = (PORT / "graders/reference/judge.py").read_text()
    judge = judge.replace("from software.utils.dist import",
                          "from .dist import")
    lines = (line.rstrip() for line in judge.splitlines())
    (VENDOR / "judge.py").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
