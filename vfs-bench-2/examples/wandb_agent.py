"""A deterministic Harbor agent for the Toolathlon W&B example."""

from pathlib import Path

from harbor.agents.base import BaseAgent


class WandbAgent(BaseAgent):

    @staticmethod
    def name():
        return "wandb-example"

    def version(self):
        return "1.0"

    async def setup(self, environment):
        script = Path(__file__).with_name("best_experiment.py")
        await environment.upload_file(script, "/workspace/best_experiment.py")

    async def run(self, instruction, environment, context):
        result = await environment.exec("python3 /workspace/best_experiment.py"
                                        )
        if result.return_code:
            raise RuntimeError(result.stderr)
