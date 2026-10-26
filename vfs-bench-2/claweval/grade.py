"""Grade one Claw-Eval run with the task's own grader.

Reads ``{"src", "task", "messages", "dispatches", "audit"}`` on stdin:
upstream's checkout, the task's directory, the run as upstream's trace
records it (its messages and tool dispatches) and each service's audit
log. Calls the task's ``grader.py`` unchanged, as upstream's ``cli.py``
does, with upstream's LLM judge, and prints the dimension scores, the task
score and whether it passes, the judge's calls and what the grader printed.

The judge's model is ``JUDGE_MODEL``, upstream's general-split judge by
default, reached at ``OPENAI_BASE_URL`` with ``OPENAI_API_KEY``.
"""
import contextlib
import inspect
import io
import json
import os
import sys

JUDGE_MODEL = "google/gemini-3-flash-preview"


class Unanswered(BaseException):
    """The judge never answered: a BaseException, so that it passes the
    ``except Exception`` each grader puts around its judge calls."""


def main() -> int:
    data = json.load(sys.stdin)
    sys.path.insert(0, os.path.join(data["src"], "src"))
    from claw_eval.graders.llm_judge import LLMJudge
    from claw_eval.graders.registry import get_grader
    from claw_eval.models.scoring import compute_task_score, is_pass
    from claw_eval.models.task import TaskDefinition
    from claw_eval.models.trace import ToolDispatch, TraceMessage

    class Judge(LLMJudge):
        """Upstream's judge over the chat completions API, which a gateway
        serves for any model, where upstream calls Gemini natively. When
        it gives up retrying, the grade stops: upstream would score that
        part 0, failing the agent for the judge's outage."""

        def __init__(self) -> None:
            super().__init__(model_id=os.environ.get("JUDGE_MODEL",
                                                     JUDGE_MODEL),
                             api_key=os.environ["OPENAI_API_KEY"],
                             base_url=os.environ.get(
                                 "OPENAI_BASE_URL",
                                 "https://api.openai.com/v1"))
            self._use_gemini = False

        def evaluate(self, *args, **kwargs):
            return answered(super().evaluate(*args, **kwargs))

        def evaluate_actions(self, *args, **kwargs):
            return answered(super().evaluate_actions(*args, **kwargs))

        def evaluate_visual(self, *args, **kwargs):
            return answered(super().evaluate_visual(*args, **kwargs))

    def answered(result):
        if result is None:
            raise Unanswered("the judge did not answer")
        return result

    tasks = os.path.join(data["src"], "tasks")
    task_dir = os.path.join(tasks, data["task"])
    task = TaskDefinition.from_yaml(os.path.join(task_dir, "task.yaml"))
    trace = dict(trace_id=data["task"])
    messages = [TraceMessage(**trace, message=m) for m in data["messages"]]
    dispatches = [ToolDispatch(**trace, **d) for d in data["dispatches"]]
    # Upstream's constructor prints the Gemini route this judge leaves.
    with contextlib.redirect_stdout(io.StringIO()):
        judge = Judge()
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        grader = get_grader(task.task_id, tasks, task_dir)
        kwargs = dict(audit_data=data["audit"], judge=judge)
        if "media_events" in inspect.signature(grader.grade).parameters:
            kwargs["media_events"] = []
        scores = grader.grade(messages, dispatches, task, **kwargs)
    score = compute_task_score(scores)
    print(
        json.dumps(
            dict(scores=scores.model_dump(),
                 score=score,
                 passed=is_pass(score),
                 judge=judge.get_call_log(),
                 output=printed.getvalue())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
