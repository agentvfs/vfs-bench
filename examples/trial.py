"""Run the same workspace inspection as the vfsbench run example."""

import asyncio

from vfsbench import run


async def main():
    report = await run("toolathlon",
                       task="wandb-best-score",
                       command="ls /wandb/mluo/deepscaler-1.5b")
    print(report.trace.commands[0].stdout)
    print(f"Reward: {report.verification.reward}")


if __name__ == "__main__":
    asyncio.run(main())
