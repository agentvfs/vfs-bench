"""A shared fake's run ports, when a trial's open is canceled.

    uv run --project harbor python -I harbor/test_fakes.py

The launcher answers an open after the trial that sent it stopped
waiting: the port goes to no one and is closed, and the fake's reader
still hands later runs theirs.
"""
import asyncio
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from vfsbench_harbor import fakes

# A launcher that answers each open half a second late, and logs every line
# it is sent.
LAUNCHER = """
import json, sys, time
log = open(sys.argv[1], "a", buffering=1)
for line in sys.stdin:
    log.write(line)
    sent = json.loads(line)
    if "open" in sent:
        time.sleep(0.5)
        url = "http://127.0.0.1:1/" + sent["open"]
        print("RUN=" + json.dumps({"run": sent["open"], "url": url}),
              flush=True)
"""


class CanceledOpen(unittest.TestCase):

    def test_a_late_port_is_closed_and_the_next_still_opens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp, "sent.log")
            process = subprocess.Popen(
                [sys.executable, "-I", "-c", LAUNCHER,
                 str(log)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE)
            fake = fakes.Fake("chat", "http://127.0.0.1:1", Path(tmp), process,
                              "token")
            reader = threading.Thread(target=fakes._ports, args=(fake, ))
            reader.start()
            try:

                async def scenario() -> str:
                    with self.assertRaises(asyncio.TimeoutError):
                        await asyncio.wait_for(
                            asyncio.wrap_future(
                                fakes._send(fake, {"open": "a"}, "a")), 0.1)
                    return await asyncio.wait_for(
                        asyncio.wrap_future(
                            fakes._send(fake, {"open": "b"}, "b")), 5)

                self.assertEqual(asyncio.run(scenario()),
                                 "http://127.0.0.1:1/b")
                self.assertTrue(reader.is_alive())
            finally:
                assert process.stdin is not None
                process.stdin.close()
                process.wait(5)
                reader.join(5)
            # B's open is sent before A's late port arrives, and so before
            # A's close.
            self.assertEqual(
                log.read_text().splitlines(),
                ['{"open": "a"}', '{"open": "b"}', '{"close": "a"}'])


if __name__ == "__main__":
    unittest.main()
