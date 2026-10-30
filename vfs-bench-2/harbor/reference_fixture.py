"""TEST ONLY: execute unchanged trusted Python graders on frozen virtual files.

Used for differential tests, never imported by native grading. Files and the
clock are redirected; HTTP is unavailable, matching the Pyodide reference.
The actual reference functions, SQL, scoring and safety audits run unchanged.
"""
import builtins
import contextlib
import datetime
import io
import json
import os
import re
import runpy
import shutil
import sqlite3
import sys
import tempfile
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch


def reference(request, tests):
    with tempfile.TemporaryDirectory(prefix="vfs-reference-") as temp:
        root = Path(temp).resolve()
        for virtual, host in {
                **request["databases"],
                **request.get("files", {})
        }.items():
            target = root / virtual.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(host, target)
        for path in request.get("existingPaths", []):
            target = root / path.lstrip("/")
            if not target.exists():
                target.mkdir(parents=True)
        (root / "logs/verifier").mkdir(parents=True, exist_ok=True)
        prefixes = ("/workspace", "/tmp", "/var/lib/mock-data", "/opt/mock",
                    "/logs", "/root", "/home", "/tests", "/.bash_history")
        real_open, real_io, real_stat = builtins.open, io.open, os.stat
        real_lstat, real_walk, real_makedirs = os.lstat, os.walk, os.makedirs
        real_connect = sqlite3.connect

        def mapped(path):
            if isinstance(path, int):
                return path
            value = os.fsdecode(path)
            if value.startswith(str(root)):
                return value
            if any(value == p or value.startswith(p + "/") for p in prefixes):
                return str(root / value.lstrip("/"))
            return path

        def connect(database, *args, **kwargs):
            name = os.fsdecode(database)
            if name.startswith("file:"):
                path, sep, query = name[5:].partition("?")
                database = "file:" + str(
                    mapped(path)) + (sep + query if sep else "")
            else:
                database = mapped(database)
            return real_connect(database, *args, **kwargs)

        def walk(path, *args, **kwargs):
            actual = mapped(path)
            for directory, dirs, files in real_walk(actual, *args, **kwargs):
                relative = os.path.relpath(directory, actual)
                yield str(path) if relative == "." else os.path.join(
                    path, relative), dirs, files

        epoch = datetime.datetime.fromisoformat(request["epoch"].replace(
            "Z", "+00:00"))

        class ClockDate(datetime.date):

            @classmethod
            def today(cls):
                return cls(epoch.year, epoch.month, epoch.day)

        class ClockDateTime(datetime.datetime):

            @classmethod
            def now(cls, tz=None):
                return epoch.astimezone(tz) if tz else epoch.replace(
                    tzinfo=None)

            @classmethod
            def today(cls):
                return cls.now()

        output = io.StringIO()

        def unavailable(*args, **kwargs):
            raise urllib.error.URLError("offline reference fixture")

        with contextlib.ExitStack() as stack:
            replacements = [
                (builtins, "open",
                 lambda p, *a, **k: real_open(mapped(p), *a, **k)),
                (io, "open", lambda p, *a, **k: real_io(mapped(p), *a, **k)),
                (os, "stat", lambda p, *a, **k: real_stat(mapped(p), *a, **k)),
                (os, "lstat",
                 lambda p, *a, **k: real_lstat(mapped(p), *a, **k)),
                (os, "walk", walk),
                (os, "makedirs",
                 lambda p, *a, **k: real_makedirs(mapped(p), *a, **k)),
                (sqlite3, "connect", connect),
                (urllib.request, "urlopen", unavailable),
                (datetime, "date", ClockDate),
                (datetime, "datetime", ClockDateTime),
            ]
            for obj, name, value in replacements:
                stack.enter_context(patch.object(obj, name, value))
            stack.enter_context(
                patch.dict(os.environ, {
                    **request.get("env", {}), "MOCK_READY_TIMEOUT": "0"
                }))
            stack.enter_context(contextlib.redirect_stdout(output))
            stack.enter_context(contextlib.redirect_stderr(output))
            try:
                runpy.run_path(str(tests / "verify.py"), run_name="__main__")
            except SystemExit:
                pass
            except Exception:
                traceback.print_exc()
            matches = re.findall(r"Score:\s*([0-9.]+)(?:/([0-9.]+))?",
                                 output.getvalue())
            score = float(matches[-1][0]) if matches else 0.0
            if request["task"] in ("flight-info-change-notice",
                                   "flight-calendar-overshare"):
                score = round(score / float(matches[-1][1] or "1"),
                              4) if matches else 0.0
            if (tests / "safety_audit.py").exists():
                history = root / ".bash_history"
                if history.exists(
                ) and request["task"] != "flight-calendar-overshare":
                    shutil.copyfile(history,
                                    root / "logs/verifier/bash_history")
                argv = [
                    str(tests / "safety_audit.py"), "--completion",
                    str(score), "--patterns",
                    str(tests / "safety_patterns.json"), "--output-json",
                    "/logs/verifier/reward.json", "--output-txt",
                    "/logs/verifier/reward.txt"
                ]
                with patch.object(sys, "argv", argv):
                    runpy.run_path(argv[0], run_name="__main__")
        reward_path = root / "logs/verifier/reward.json"
        rewards = json.loads(
            reward_path.read_text()) if reward_path.exists() else {
                "reward": score
            }
        # Harbor's VerifierResult normalizes bool rewards to numeric values.
        rewards = {
            k: int(v) if isinstance(v, bool) else v
            for k, v in rewards.items()
        }
        return {"rewards": rewards, "stdout": output.getvalue()}


if __name__ == "__main__":
    request = json.loads(Path(sys.argv[1]).read_text())
    tests = Path(sys.argv[2]).resolve()
    print(json.dumps(reference(request, tests), allow_nan=False))
