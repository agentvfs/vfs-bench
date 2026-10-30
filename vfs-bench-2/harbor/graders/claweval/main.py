"""Run unchanged Claw-Eval grading in Mirage's verifier-only Python VFS.

The only model interface is a replay tape. A missing response suspends the
grade by writing its exact request; the host transports it and resumes by
replaying the same frozen inputs. No network or credentials enter Python.
"""
import contextlib
import inspect
import io
import json
import random
import sys
import time
import types
from pathlib import Path


class JudgeRequest(BaseException):

    def __init__(self, request, delay):
        self.request = request
        self.delay = delay


class ReplayMismatch(BaseException):
    pass


class Unanswered(BaseException):
    pass


def objects(value):
    if isinstance(value, dict):
        return types.SimpleNamespace(**{
            k: objects(v)
            for k, v in value.items()
        })
    if isinstance(value, list):
        return [objects(v) for v in value]
    return value


def run():
    state = json.loads(Path("/input/state.json").read_text())
    tape = json.loads(Path("/input/tape.json").read_text())
    settings = json.loads(Path("/input/settings.json").read_text())
    cursor = 0
    delay = 0

    # Only wall-clock backoff is moved to the transport. Scoring, prompts,
    # response parsing and the upstream retry count stay in upstream Python.
    def backoff(seconds):
        nonlocal delay
        # Previously recorded attempts already waited. A new attempt waits
        # once outside WASM, including retries after invalid JSON replies.
        if cursor == len(tape):
            delay += seconds

    time.sleep = backoff
    random.seed(0)

    class Client:

        def __init__(self, **kwargs):
            self.chat = self
            self.completions = self

        def create(self, **request):
            nonlocal cursor
            if cursor == len(tape):
                raise JudgeRequest(request, delay)
            entry = tape[cursor]
            cursor += 1
            if entry["request"] != request:
                raise ReplayMismatch(
                    f"Judge request {cursor} differs from recording")
            if "error" in entry:
                error = RuntimeError(entry["error"]["message"])
                error.status_code = entry["error"].get("status")
                raise error
            response = entry["response"]
            for choice in response.get("choices", []):
                if isinstance(choice.get("message"), dict):
                    choice["message"].setdefault("content", None)
            return objects(response)

    openai = types.ModuleType("openai")
    openai.OpenAI = Client
    sys.modules["openai"] = openai
    # The original judge imports httpx for the unused Gemini-native route.
    # The existing reference forces its OpenAI-compatible route too.
    sys.modules["httpx"] = types.ModuleType("httpx")
    sys.path[:0] = ["/reference/src", "/reference", "/grader"]
    import assembly
    import claw_eval.models.trace as trace_module
    import gws
    from claw_eval.graders.llm_judge import LLMJudge
    from claw_eval.graders.registry import get_grader
    from claw_eval.models.scoring import compute_task_score, is_pass
    from claw_eval.models.task import TaskDefinition
    from claw_eval.models.trace import ToolDispatch, TraceMessage

    trace_module._now = lambda: state["epoch"]
    assembly.now = lambda: state["epoch"]
    assembly.TRAJECTORY = Path("/input/trajectory.json")
    assembly.DISPATCHES = Path("/input/dispatches.jsonl")
    assembly.GWS_SEED = Path("/input/gws_seed.json")
    assembly.writes = lambda trace, seed: gws.writes(trace, seed, state["gws"])

    class Judge(LLMJudge):

        def __init__(self):
            super().__init__(model_id=settings["model"],
                             api_key="unused",
                             base_url="https://judge.invalid/v1")
            self._use_gemini = False

        def answered(self, value):
            if value is None:
                raise Unanswered("the judge did not answer")
            return value

        def evaluate(self, *args, **kwargs):
            return self.answered(super().evaluate(*args, **kwargs))

        def evaluate_actions(self, *args, **kwargs):
            return self.answered(super().evaluate_actions(*args, **kwargs))

    task_id = state["task"]
    tasks = Path("/reference/tasks")
    task = TaskDefinition.from_yaml(str(tasks / task_id / "task.yaml"))
    trace = dict(trace_id=task_id)
    messages = [
        TraceMessage(**trace, message=m)
        for m in assembly.messages(task.prompt.text)
    ]
    audit_data = state["audit"]
    built = assembly.gws_trace(task, audit_data)
    dispatches = [
        ToolDispatch(**trace, **d) for d in assembly.dispatches() + built
    ]
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        judge = Judge()
        grader = get_grader(task_id, str(tasks), str(tasks / task_id))
        kwargs = dict(audit_data=audit_data, judge=judge)
        if "media_events" in inspect.signature(grader.grade).parameters:
            kwargs["media_events"] = []
        scores = grader.grade(messages, dispatches, task, **kwargs)
    if cursor != len(tape):
        raise ReplayMismatch(
            f"Unused recorded judge responses: {len(tape) - cursor}")
    score = compute_task_score(scores)
    parts = scores.model_dump()
    rewards = {
        "reward": score,
        "completion": parts["completion"],
        "robustness": parts["robustness"],
        "safety": parts["safety"],
        "passed": 1 if is_pass(score) else 0
    }
    return {
        "score": score,
        "rewards": rewards,
        "checks": rewards,
        "stdout": printed.getvalue(),
        "artifacts": {
            "reward_details.json": {
                "scores": parts,
                "judge": judge.get_call_log(),
                "gws_dispatches": built,
                "output": printed.getvalue()
            }
        }
    }


try:
    result = run()
except JudgeRequest as request:
    result = {"judge_request": request.request, "judge_delay": request.delay}
Path("/output/result.json").write_text(json.dumps(result, allow_nan=False))
