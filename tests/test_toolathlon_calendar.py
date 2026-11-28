import json
import os
import shlex
import unittest

from vfsbench.dataset import Toolathlon
from vfsbench.runtime import TrialConfig


@unittest.skipUnless(
    os.getenv("VFSBENCH_TEST_CALENDAR"),
    "requires the cached mail and Calendar services and verifier snapshot")
class CalendarTrials(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.suite = Toolathlon(cache_dir=os.getenv("VFSBENCH_TEST_CACHE"),
                                local_files_only=True)
        self.config = TrialConfig(
            snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])

    async def create_event(self, trial, summary, start, end):
        args = {
            "summary": summary,
            "start": {
                "dateTime": start
            },
            "end": {
                "dateTime": end
            }
        }
        result = await trial.exec("google-calendar create-event " +
                                  shlex.quote(json.dumps(args)))
        self.assertEqual(result.return_code, 0, result.stderr or result.stdout)
        self.assertIn(summary, result.stdout)
        return result.stdout.splitlines()[0].removeprefix(
            "Event created with ID: ")

    async def test_conference_deadline(self):
        task = self.suite["set-conf-cr-ddl"]
        async with task.start(config=self.config) as trial:
            state = await trial.service_state("mail")
            self.assertEqual(len(state["swright"]["INBOX"]), 18)
            self.assertIn("INBOX", (await trial.exec("ls /mail")).stdout)
            self.assertEqual((await trial.exec("date +%F")).stdout.strip(),
                             "2025-09-15")
            date = await trial.exec(
                """python3 -c "from datetime import date; """
                """print(date.today())" """)
            self.assertEqual(date.stdout.strip(), "2025-09-15")
            self.assertEqual((await trial.service_state("calendar"))["events"],
                             [])
            event = await self.create_event(trial, "Draft reminder",
                                            "2025-09-26T12:00:00Z",
                                            "2025-09-26T12:15:00Z")
            for verb, args in (("update-event", {
                    "eventId": event,
                    "summary": "Updated draft"
            }), ("get-event", {
                    "eventId": event
            }), ("list-events", {
                    "timeMin": "2025-09-26T00:00:00Z",
                    "timeMax": "2025-09-27T00:00:00Z"
            }), ("delete-event", {
                    "eventId": event
            })):
                result = await trial.exec("google-calendar " + verb + " " +
                                          shlex.quote(json.dumps(args)))
                self.assertEqual(result.return_code, 0, result.stderr
                                 or result.stdout)
                self.assertIn(
                    event if verb == "delete-event" else "Updated draft",
                    result.stdout)
            self.assertEqual((await trial.verify()).reward, 0)
        async with task.start(config=self.config) as trial:
            await self.create_event(trial, "COML camera-ready reminder",
                                    "2025-09-26T20:59:00-12:00",
                                    "2025-09-26T21:15:00-12:00")
            self.assertEqual((await trial.verify()).reward, 1)

    async def test_interviews(self):
        task = self.suite["student-interview"]
        async with task.start(config=self.config) as trial:
            self.assertEqual(
                len((await
                     trial.service_state("mail"))["susan_reyes"]["INBOX"]), 99)
            self.assertEqual((await trial.exec("date +%F")).stdout.strip(),
                             "2025-10-02")
            self.assertNotEqual(
                (await trial.exec("python3 --version")).return_code, 0)
            before = await trial.service_state("calendar")
            self.assertEqual(
                {e["summary"]
                 for e in before["events"]},
                {"Academic Committee Meeting", "PhD Dissertation Defense"})
            self.assertEqual((await trial.verify()).reward, 0)
        async with task.start(config=self.config) as trial:
            for student, start, end in (("Nicholas Martinez", "08:00",
                                         "09:30"), ("Stephanie Rogers",
                                                    "10:00", "11:30"),
                                        ("Ryan Gonzalez", "12:00", "13:30")):
                await self.create_event(trial, "Interview with " + student,
                                        "2025-10-03T" + start + ":00+08:00",
                                        "2025-10-03T" + end + ":00+08:00")
            self.assertEqual((await trial.verify()).reward, 1)
