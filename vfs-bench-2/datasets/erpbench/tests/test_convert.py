"""convert.py's witnesses, CLIs and oracle for the mounts.

    uv run --project datasets/erpbench \
        python -I datasets/erpbench/tests/test_convert.py

A Drive file's or a Gmail message's witness is the text a grader looks for
in the agent's output to count a mount read as seen: it must be on one
line, long enough, and in no other resource of the task's world nor its
prompt, or seeing one resource would count as seeing another (the current
and superseded versions of a file share their header line). The CLIs keep
no tool a mount reads; the oracle reads through the mounts, one timed step
each. Needs datasets/erpbench/download.py.
"""
import json
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import convert  # noqa: E402

TASKS = sorted(convert.UPSTREAM.glob("erpbench-*"))


class WitnessTests(unittest.TestCase):

    def test_every_witness_is_one_line_and_names_its_resource_only(self):
        self.assertEqual(len(TASKS), 100)
        for src in TASKS:
            task = json.loads((src / "tests" / "task.json").read_text())
            kit = convert.kit(task, [])
            with convert.loaded(kit["sql"]) as conn:
                files, mails = convert.resources(conn, task["tenant_code"])
            texts = {**files, **mails}
            self.assertEqual(set(kit["witnesses"]), set(texts), src.name)
            prompt = convert.flat(task["prompt"])
            # Alternatives of one investigation may share text: seeing
            # either passes the same check.
            together = [{
                str(
                    r.get("arguments", {}).get("fileId")
                    or r.get("arguments", {}).get("id"))
                for r in inv["any_of"]
            } for inv in task["required_investigations"]]
            for rid, witness in kit["witnesses"].items():
                fragments = witness["all"]
                self.assertTrue(fragments, rid)
                for fragment in fragments:
                    self.assertNotIn("\n", fragment, rid)
                    self.assertNotIn("\r", fragment, rid)
                    self.assertGreaterEqual(len(convert.flat(fragment)), 10,
                                            rid)
                    self.assertNotIn(convert.flat(fragment), prompt,
                                     f"{src.name} {rid}")
                    for other, text in texts.items():
                        if other == rid or convert.flat(
                                fragment) not in convert.flat(text):
                            continue
                        self.assertTrue(
                            any({rid, other} <= ids for ids in together),
                            f"{src.name}: {rid}'s witness is in {other}")
            request = f"MSG-{task['task_id']}-REQUEST"
            self.assertTrue(
                kit["witnesses"][request]["all"][0].startswith(
                    '"body_text":"'), src.name)

    def test_flat_drops_escapes_space_and_case(self):
        self.assertEqual(convert.flat('A "b"\\n\tC \\u00b7 D\r\n'), 'a"b"c·d')
        self.assertIn(convert.flat('x "y" ·'),
                      convert.flat(json.dumps(json.dumps('x "y" ·'))))


class CliTests(unittest.TestCase):

    def setUp(self):
        src = convert.UPSTREAM / "erpbench-001"
        self.task = json.loads((src / "tests" / "task.json").read_text())
        self.tools = convert.tool_definitions(self.task["answer_schema"])
        self.upstream = (src / "instruction.md").read_text()

    def test_the_clis_keep_no_tool_a_mount_reads(self):
        exposed = {
            tool["call"]
            for cli in convert.tools_json(self.tools)
            for tool in cli["tools"]
        }
        self.assertTrue(exposed)
        self.assertFalse(exposed & set(convert.MOUNTED))
        text = convert.instruction(self.upstream, self.tools)
        for tool in convert.MOUNTED:
            self.assertNotIn(f"`{convert.command(tool)}`", text)
        for mount in ("/gmail", "/drive", "/sheets", "/slack"):
            self.assertIn(mount, text)


class OracleTests(unittest.TestCase):

    def test_steps_are_timed_quoted_and_printed(self):
        src = convert.UPSTREAM / "erpbench-028"
        task = json.loads((src / "tests" / "task.json").read_text())
        tools = convert.tool_definitions(task["answer_schema"])
        names = convert.drive_names(task, convert.seeded(task))
        script = convert.solve_sh(task, tools, names)
        name = "/drive/Agency portal-export-2026-02-02.json"
        self.assertIn(f"cat {shlex.quote(name)}", script)
        self.assertNotIn("/dev/null", script)
        body = script[script.index("step() {"):]
        body = body[:body.index("\n}\n")]
        # The wait must outlast the workspace clock's lag behind the host's.
        self.assertIn("\n  sleep 1\n", body)
        self.assertLess(body.index("sleep 1"), body.index("date +%s%3N"))
        self.assertLess(body.index("date +%s%3N"),
                        body.index('sh "$S/$n.cmd"'))
        self.assertEqual(script.count("step <<'STEP'"),
                         len(task["oracle_steps"]))

    def test_trajectory_orders_steps_by_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            steps = Path(tmp) / "steps"
            steps.mkdir()
            for n in range(1, 13):
                (steps / f"{n}.cmd").write_text(f"echo {n}")
                (steps / f"{n}.out").write_text(f"{n}\n")
                (steps / f"{n}.at").write_text(str(1_770_627_600_000 + n))
            out = Path(tmp) / "trajectory.json"
            subprocess.run([
                sys.executable, "-I",
                str(convert.TRAJECTORY),
                str(steps),
                str(out)
            ],
                           check=True)
            got = json.loads(out.read_text())
            self.assertEqual(got["agent"]["name"], "oracle")
            self.assertEqual([
                s["observation"]["results"][0]["content"].strip()
                for s in got["steps"]
            ], [str(n) for n in range(1, 13)])
            self.assertEqual(got["steps"][0]["timestamp"],
                             "2026-02-09T09:00:00.001Z")


if __name__ == "__main__":
    unittest.main()
