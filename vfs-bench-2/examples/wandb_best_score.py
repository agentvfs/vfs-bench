"""Run from the repository root after preparing wandb-best-score."""

import asyncio
import json
from pathlib import Path

from vfsbench import AgentResult, Toolathlon


async def main():
    task = Toolathlon(local_files_only=True)["wandb-best-score"]
    print(task.instruction)
    script = Path(__file__).with_name("best_experiment.py")
    async with task.open() as trial:
        await trial.workspace.vfs.write("/workspace/best_experiment.py",
                                        script.read_bytes())
        result = await trial.exec("python3 /workspace/best_experiment.py")
        if result.return_code:
            raise RuntimeError(result.stderr)
        trial.record_result(AgentResult(output=json.loads(result.stdout)))
        verdict = await trial.verify()

    print(trial.report.result.output)
    print(f"Reward: {verdict.reward}")


if __name__ == "__main__":
    asyncio.run(main())
