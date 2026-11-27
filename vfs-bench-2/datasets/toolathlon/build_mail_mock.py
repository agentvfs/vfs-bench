"""Build Mirage's IMAP/SMTP handlers and the run database schema for the
wheel."""

import argparse
import io
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

REVISION = "b8a3422d28f2fecf32ccb0ff9e7bd87317e4bad1"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mirage", type=Path, required=True)
    parser.add_argument("--esbuild", type=Path, required=True)
    parser.add_argument("--prisma", type=Path, required=True)
    args = parser.parse_args()
    dest = Path(
        __file__).resolve().parents[2] / "src/vfsbench/suites/vendor/mail"
    esbuild, prisma = args.esbuild.resolve(), args.prisma.absolute()
    if subprocess.check_output([esbuild, "--version"]).strip() != b"0.28.2":
        raise ValueError("Use esbuild 0.28.2")
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        paths = [
            "integ/server/mail", "integ/server/kit/typescript",
            "integ/prisma/mail.prisma", "LICENSE"
        ]
        source = subprocess.check_output(
            ["git", "-C", args.mirage, "archive", REVISION, *paths])
        with tarfile.open(fileobj=io.BytesIO(source)) as archive:
            archive.extractall(stage, filter="data")
        subprocess.run([
            esbuild, "integ/server/mail/arms.ts", "--bundle",
            "--platform=node", "--format=esm", "--target=node24",
            "--packages=external", "--legal-comments=none",
            "--banner:js=// Mirage IMAP/SMTP handlers, Apache-2.0. See "
            "LICENSE.", f"--outfile={dest}/arms.mjs"
        ],
                       cwd=stage,
                       check=True)
        sql = subprocess.check_output([
            prisma, "migrate", "diff", "--from-empty", "--to-schema-datamodel",
            "integ/prisma/mail.prisma", "--script"
        ],
                                      cwd=stage)
        (dest / "schema.sql").write_bytes(sql.rstrip() + b"\n")
        shutil.copyfile(stage / "LICENSE", dest / "LICENSE")


if __name__ == "__main__":
    main()
