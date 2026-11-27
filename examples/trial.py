import asyncio

from vfsbench import run


async def inspect(ws):
    path = "/wandb/mluo/deepscaler-1.5b"
    print(await ws.vfs.readdir(path))
    result = await ws.shell("ls " + path)
    print(await result.stdout_str())


async def main():
    report = await run("toolathlon", task="wandb-best-score", action=inspect)
    print(f"Reward: {report.verification.reward}")


if __name__ == "__main__":
    asyncio.run(main())
