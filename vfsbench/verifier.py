from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from .dataset import Task


@dataclass(frozen=True)
class AgentResult:
    """Runner-observed output of the attempt. Any of these fields may be
    absent."""

    final_answer: str | None = None
    metadata: dict = field(default_factory=dict)
    output: dict | list | str | int | float | bool | None = None


@dataclass(frozen=True)
class CommandEvent:
    command: str
    cwd: str | None
    started_at: str
    finished_at: str
    return_code: int | None
    stdout: str
    stderr: str


@dataclass(frozen=True)
class TrialTrace:
    commands: tuple[CommandEvent, ...] = ()
    agent: dict | None = None
    workspace_events: tuple[dict, ...] = ()


@dataclass(frozen=True)
class VerificationResult:
    reward: float
    details: dict = field(default_factory=dict)

    def __post_init__(self):
        if not isinstance(self.reward,
                          (float, int)) or not math.isfinite(self.reward):
            raise ValueError("Verifier reward must be finite")

    @classmethod
    def from_metrics(cls, metrics: dict) -> VerificationResult:
        return cls(metrics["reward"], {
            k: v
            for k, v in metrics.items() if k != "reward"
        })


@dataclass(frozen=True)
class TrialReport:
    trial_id: str
    task_id: str
    dataset: str | None
    repo_id: str | None
    revision: str | None
    snapshot: str
    started_at: str | None
    closed_at: str | None
    trace: TrialTrace
    result: AgentResult | None
    verification: VerificationResult | None
    verification_error: str | None
    startup_error: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class TrialView:
    """Controller-only evidence. File and service reads use the live trial
    during verify()."""

    def __init__(self, task: Task, trial_id: str, trace: TrialTrace,
                 result: AgentResult | None, files,
                 state_readers: dict[str, Callable[[], Awaitable]],
                 active: Callable[[], bool]):
        self.task = task
        self.trial_id = trial_id
        self.trace = trace
        self.result = result
        self.services = tuple(state_readers)
        self._files = files
        self._readers = state_readers
        self._active = active
        self._states: dict = {}

    def _check(self):
        if not self._active():
            raise RuntimeError(
                "Live verification evidence is no longer available")

    async def read_file(self, path: str) -> bytes:
        self._check()
        return await self._files.read(path, raw=True)

    async def is_file(self, path: str) -> bool:
        self._check()
        return await self._files.is_file(path)

    async def list_dir(self, path: str) -> list[str]:
        self._check()
        return await self._files.readdir(path)

    async def service_state(self, name: str):
        self._check()
        if name not in self._readers:
            raise KeyError(f"No service state named {name!r}. Available: "
                           f"{', '.join(self.services)}")
        if name not in self._states:
            self._states[name] = await self._readers[name]()
        return deepcopy(self._states[name])


class Verifier(Protocol):

    async def verify(self, trial: TrialView) -> VerificationResult:
        ...


@dataclass(frozen=True)
class SuiteVerifier:
    """Use a suite evaluator that returns a reward and benchmark-specific
    metrics."""

    evaluate: Callable[[TrialView], Awaitable[dict]]

    async def verify(self, trial: TrialView) -> VerificationResult:
        return VerificationResult.from_metrics(await self.evaluate(trial))


@dataclass(frozen=True)
class VerifierConfig:
    """An installed vfsbench.verifiers entry point, or the suite's original
    evaluator."""

    name: str = "suite"
    options: dict = field(default_factory=dict)

    def __post_init__(self):
        if not isinstance(self.name, str) or not self.name or not isinstance(
                self.options, dict):
            raise ValueError("A verifier requires a name and an options table")
        if self.name == "suite" and self.options:
            raise ValueError(
                "The suite verifier takes its settings from suite_options")

    def load(self) -> Verifier | None:
        if self.name == "suite":
            return None
        from importlib.metadata import entry_points

        found = tuple(entry_points(group="vfsbench.verifiers", name=self.name))
        if len(found) != 1:
            raise ValueError(
                f"Expected one installed vfsbench.verifiers entry point "
                f"named {self.name!r}")
        verifier = found[0].load()(**self.options)
        if not callable(getattr(verifier, "verify", None)):
            raise TypeError(
                f"Verifier {self.name!r} must implement async verify(trial)")
        return verifier
