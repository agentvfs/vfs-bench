"""microsandbox.py's reading of guest.py's answer, against a stand-in msb.

    uv run --project harbor python -I harbor/test_microsandbox.py

The stand-in's ``exec`` writes a scripted answer: ``STARTED``, beats, ``END``
and a tar, or silence where msb's guest hangs. A framed answer gives the tar
after ``END``; silence before ``STARTED`` or between beats is ``Hung``, which
``retried`` starts again; an answer that ends without ``END`` is an error;
a probe's output comes back as it is. guest.py's heart beats until stopped.
"""
import asyncio
import io
import json
import os
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from vfsbench_harbor import guest, microsandbox
from vfsbench_harbor.microsandbox import Hung, Sandbox

# Each step of the answer: {"out": text} on stdout, {"tar": path}'s bytes on
# stdout, {"sleep": seconds}, or {"exit": status}.
FAKE = """#!{python}
import json, os, sys, time
if sys.argv[1] != "exec":
    sys.exit(0)
for step in json.load(open(os.environ["FAKE_MSB_ANSWER"])):
    if "out" in step:
        sys.stdout.buffer.write(step["out"].encode())
    elif "tar" in step:
        sys.stdout.buffer.write(open(step["tar"], "rb").read())
    elif "sleep" in step:
        time.sleep(step["sleep"])
    elif "exit" in step:
        sys.exit(step["exit"])
    sys.stdout.buffer.flush()
"""


class Answer(unittest.TestCase):

    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        self.msb = root / "msb"
        self.msb.write_text(FAKE.format(python=sys.executable))
        self.msb.chmod(0o755)
        self.answer = root / "answer.json"
        self.tar = root / "logs.tar"
        with tarfile.open(self.tar, "w") as tar:
            data = b"1.0\n"
            info = tarfile.TarInfo("reward.txt")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        patches = [
            mock.patch.dict(os.environ, {"FAKE_MSB_ANSWER": str(self.answer)}),
            mock.patch.object(microsandbox, "ANSWER_TIMEOUT", 1),
            mock.patch.object(microsandbox, "STALL_TIMEOUT", 1),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def tearDown(self) -> None:
        self.dir.cleanup()

    def guest(self, steps: list[dict], *args: str):
        self.answer.write_text(json.dumps(steps))
        return asyncio.run(Sandbox(str(self.msb), "vm").guest(*args))

    def test_framed(self) -> None:
        code, out, _ = self.guest([{
            "out": "STARTED\n"
        }, {
            "out": "BEAT\n"
        }, {
            "out": "BEAT\n"
        }, {
            "out": "END\n"
        }, {
            "tar": str(self.tar)
        }])
        self.assertEqual(code, 0)
        with out:
            names = microsandbox.extract(out,
                                         Path(self.dir.name, "verifier"),
                                         include=None,
                                         exclude=None,
                                         protect=())
        self.assertEqual(names, ["reward.txt"])
        self.assertEqual(
            Path(self.dir.name, "verifier/reward.txt").read_text(), "1.0\n")

    def test_beats_slower_than_the_stall_timeout_hang(self) -> None:
        started = time.monotonic()
        with self.assertRaisesRegex(Hung, "stopped beating after 1s"):
            self.guest([{
                "out": "STARTED\n"
            }, {
                "out": "BEAT\n"
            }, {
                "sleep": 10
            }, {
                "out": "END\n"
            }])
        # The stand-in is killed, not waited out.
        self.assertLess(time.monotonic() - started, 5)

    def test_nothing_started_hangs(self) -> None:
        with self.assertRaisesRegex(Hung, "ran nothing"):
            self.guest([{"sleep": 10}, {"out": "STARTED\n"}])

    def test_an_answer_without_end_fails(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "ended before its command"):
            self.guest([{"out": "STARTED\n"}, {"out": "BEAT\n"}, {"exit": 1}])

    def test_a_probe_is_read_as_it_is(self) -> None:
        # A probe neither beats nor ends; its output may well span seconds.
        code, out, _ = self.guest([{
            "out": "STARTED\n"
        }, {
            "sleep": 1.5
        }, {
            "out": "200 ok\n"
        }], "probe")
        self.assertEqual(code, 0)
        with out:
            self.assertEqual(out.read(), b"200 ok\n")


class Retried(unittest.TestCase):

    def test_a_hang_starts_again(self) -> None:
        calls: list[int] = []

        async def attempt() -> None:
            calls.append(1)
            if len(calls) == 1:
                raise Hung("vm stopped beating")

        log: list[str] = []
        self.assertEqual(asyncio.run(microsandbox.retried(attempt, log)), 2)
        self.assertEqual(log, ["attempt 1: vm stopped beating"])

    def test_every_attempt_hung_fails(self) -> None:

        async def attempt() -> None:
            raise Hung("create did not return")

        log: list[str] = []
        with self.assertRaisesRegex(RuntimeError, "hung on all"):
            asyncio.run(microsandbox.retried(attempt, log))
        self.assertEqual(len(log), microsandbox.ATTEMPTS)

    def test_another_error_is_not_retried(self) -> None:
        calls: list[int] = []

        async def attempt() -> None:
            calls.append(1)
            raise RuntimeError("guest.py did not start")

        with self.assertRaisesRegex(RuntimeError, "did not start"):
            asyncio.run(microsandbox.retried(attempt, []))
        self.assertEqual(len(calls), 1)


class Heart(unittest.TestCase):

    def test_it_beats_until_stopped(self) -> None:
        out = io.BytesIO()
        with mock.patch.object(guest.sys, "stdout", mock.Mock(buffer=out)):
            heart = guest.Heart()
            heart.start()
            time.sleep(2.3)
            heart.stop()
            beats = out.getvalue()
            time.sleep(1.2)
        self.assertEqual(beats, guest.BEAT * 2)
        self.assertEqual(out.getvalue(), beats)


if __name__ == "__main__":
    unittest.main()
