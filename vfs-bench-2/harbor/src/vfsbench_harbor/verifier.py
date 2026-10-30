"""Harbor's verifier in the trial's own workspace, with the state files only
it may read.

A task's ``mirage.yaml`` can name, for a fake, where the verifier reads its
run's SQLite (``verifier_state``) apart from where the agent may
(``state``). Those files are not in the workspace while the agent works:
an EnterpriseOps-Gym agent, say, reaches its services through their tools
alone, as upstream's does, never through their database. This verifier
reveals them, then verifies as Harbor's own does, ``test.sh`` in the
workspace, whose first command copies them in.
"""
from harbor.models.verifier.result import VerifierResult
from harbor.verifier.verifier import Verifier

from vfsbench_harbor.environment import MirageEnvironment


class WorkspaceVerifier(Verifier):
    """Harbor's verifier, in the trial's workspace, the verifier's state
    files revealed first. It verifies a trial of
    ``vfsbench_harbor:MirageEnvironment``."""

    async def verify(self) -> VerifierResult:
        if not isinstance(self.environment, MirageEnvironment):
            raise TypeError("WorkspaceVerifier verifies a trial of "
                            "vfsbench_harbor:MirageEnvironment, not "
                            f"{type(self.environment).__name__}")
        self.environment.reveal_verifier_state()
        return await super().verify()
