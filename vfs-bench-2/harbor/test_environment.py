"""MirageEnvironment's refresh of the services' state copies.

    uv run --project harbor python -I harbor/test_environment.py

A refresh whose caller is canceled while it copies (a host agent's
refresh loop as its CLI exits, an exec's timeout) still holds the
refresh until its copy is done: the next refresh, the verifier's, starts
its copy only then, since the two would share each state file's
temporary copy.
"""
import asyncio
import threading
import unittest

from vfsbench_harbor import environment
from vfsbench_harbor.environment import MirageEnvironment


class CanceledRefresh(unittest.TestCase):

    def setUp(self) -> None:
        self.started = threading.Semaphore(0)
        self.release = threading.Event()
        self.copies = 0
        self.active = 0
        self.peak = 0
        self.snapshot = environment._snapshot
        environment._snapshot = self._copy
        # The refresh's own state, without a trial to start.
        self.env = object.__new__(MirageEnvironment)
        self.env._state = [("view", "live")]
        self.env._refreshing = threading.Lock()

    def tearDown(self) -> None:
        self.release.set()
        environment._snapshot = self.snapshot

    def _copy(self, view, live) -> None:
        self.copies += 1
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.started.release()
        self.release.wait(5)
        self.active -= 1

    async def _scenario(self) -> None:
        first = asyncio.create_task(self.env.refresh_state())
        await asyncio.to_thread(self.started.acquire, timeout=5)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        second = asyncio.create_task(self.env.refresh_state())
        # The first copy is still running: the second must not start.
        self.assertFalse(await asyncio.to_thread(self.started.acquire,
                                                 timeout=0.3))
        self.assertEqual(self.copies, 1)
        self.release.set()
        await second
        self.assertEqual(self.copies, 2)
        self.assertEqual(self.peak, 1)

    def test_next_refresh_waits_for_a_canceled_copy(self) -> None:
        asyncio.run(self._scenario())


if __name__ == "__main__":
    unittest.main()
