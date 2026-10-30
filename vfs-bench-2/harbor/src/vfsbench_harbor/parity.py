"""Preserve the original grade while checking a native port on the same state.

Use --verifier vfsbench_harbor:MirageParityVerifier with any of the six
Mirage-agent job configs. Unported tasks still run their original grader;
they are explicitly reported as unported, never as parity successes.
"""
import json
import math

from harbor.models.verifier.result import VerifierResult
from harbor.verifier.verifier import Verifier
from vfsbench_harbor.microsandbox import MicrosandboxVerifier
from vfsbench_harbor.mirage_verifier import MANIFEST, MirageVerifier

REFERENCE_BACKENDS = {
    "liveclawbench": "workspace",
    "dataspace": "microsandbox",
    "claweval": "microsandbox",
    "complexmcp": "microsandbox",
    "automationbench": "microsandbox",
    "gaia2": "microsandbox",
}


class GradeMismatchError(RuntimeError):
    pass


def differences(reference: dict, native: dict) -> dict:
    """Compare all rewards; missing keys and non-finite values fail."""
    changed = {}
    for key in sorted(reference.keys() | native.keys()):
        a, b = reference.get(key), native.get(key)
        valid = (type(a) in (float, int) and type(b) in (float, int)
                 and math.isfinite(a) and math.isfinite(b))
        if not valid or a != b:
            changed[key] = {"reference": a, "native": b}
    return changed


class MirageParityVerifier(Verifier):
    """Reference-first migration gate; it never replaces reference rewards.

    reference: auto selects each dataset's existing backend; workspace or
        microsandbox overrides it explicitly.
    reference_kwargs: options for the reference, e.g. msb or image.
    fail_on_mismatch: fail the trial on a mismatch/native execution error
        (default True), retaining reference rewards and the parity report.
    require_native: also fail unported tasks (default False).

    All 70 configured LiveClawBench graders have native ports. Future
    ports must define their frozen input contract, including recorded API
    replies/model judgments where needed, before being registered here.
    Calling a live judge twice is not a differential test.
    """

    def __init__(self,
                 *args,
                 reference: str = "auto",
                 reference_kwargs: dict | None = None,
                 fail_on_mismatch: bool = True,
                 require_native: bool = False,
                 **kwargs):
        super().__init__(*args, **kwargs)
        self._reference_kind = reference
        self._reference_kwargs = reference_kwargs or {}
        self._fail_on_mismatch = fail_on_mismatch
        self._require_native = require_native

    def _common(self) -> dict:
        return dict(task=self.task,
                    trial_paths=self.trial_paths,
                    environment=self.environment,
                    override_env=self.override_env,
                    logger=self.logger,
                    skip_tests_upload=self._skip_tests_upload,
                    verifier_env=self.verifier_env,
                    step_name=self.step_name,
                    include_logs=self.include_logs,
                    exclude_logs=self.exclude_logs)

    def _backend(self, dataset: str) -> str:
        kind = REFERENCE_BACKENDS.get(
            dataset
        ) if self._reference_kind == "auto" else self._reference_kind
        if kind not in ("workspace", "microsandbox"):
            raise ValueError(f"No reference backend for {dataset!r}: {kind!r}")
        return kind

    def _reference(self, kind: str) -> Verifier:
        cls = Verifier if kind == "workspace" else MicrosandboxVerifier
        return cls(**self._common(), **self._reference_kwargs)

    def _report(self, value: dict) -> None:
        path = self.trial_paths.verifier_dir / "mirage_parity.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.unlink(missing_ok=True)
        path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")

    async def verify(self) -> VerifierResult:
        dataset = self.task.paths.task_dir.parent.name
        task = self.task.paths.task_dir.name
        kind = self._backend(dataset)
        manifest = json.loads(MANIFEST.read_text())
        supported = dataset == "liveclawbench" and task in manifest
        report = {
            "dataset": dataset,
            "task": task,
            "reference_backend": kind,
            "status": "reference_running",
            "native_available": supported
        }
        self._report(report)
        try:
            original = await self._reference(kind).verify()
            if differences(original.rewards, original.rewards):
                raise ValueError("Reference rewards must be finite numbers")
        except BaseException as exc:
            report.update(status="reference_error",
                          error=f"{type(exc).__name__}: {exc}")
            self._report(report)
            raise
        report["reference_rewards"] = original.rewards
        if not supported:
            report["status"] = "unported"
            self._report(report)
            if self._require_native:
                raise GradeMismatchError(
                    f"No native grader for {dataset}/{task}")
            return original
        native = MirageVerifier(**self._common())
        try:
            # The reference refreshed the completed agent's file views.
            # Native grading reads those files and JSON from the same idle
            # fake runs. Keep the authoritative reward/log files intact.
            report["reference_source_sha256"] = manifest[task]["files"]
            result = await native.evaluate(refresh=False)
            report["input_sha256"] = result.get("input_sha256", {})
            rewards = result["rewards"] if "rewards" in result else {
                "reward": result["score"]
            }
            if differences(rewards, rewards):
                raise ValueError("Native rewards must be finite numbers")
            delta = differences(original.rewards, rewards)
            report.update(status="mismatch" if delta else "matched",
                          native_rewards=rewards,
                          differences=delta,
                          native_checks=result["checks"],
                          native_timings=result["timings"])
        except Exception as exc:
            report.update(status="native_error",
                          error=f"{type(exc).__name__}: {exc}")
        except BaseException as exc:
            report.update(status="native_canceled", error=type(exc).__name__)
            self._report(report)
            raise
        self._report(report)
        if report["status"] != "matched" and self._fail_on_mismatch:
            raise GradeMismatchError(
                f"{dataset}/{task}: {report['status']}; see mirage_parity.json"
            )
        return original
