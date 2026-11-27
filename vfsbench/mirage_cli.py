"""Bind Mirage's CLI commands to the open trial's workspace."""

import asyncio
import sys
from contextlib import aclosing
from functools import partial

import typer
from mirage.cli import shell, vfs
from mirage.cli.output import emit
from mirage.cli.stream import _stdin_chunks
from mirage.io.stream import close_quietly
from mirage.server.io_serde import (answered, explanation_to_dict,
                                    io_result_to_dict)
from mirage.server.vfs_calls import BYTES, OWNER, VFS_CALLS
from mirage.shell.constants import SIGPIPE_STATUS
from mirage.workspace.tools.io_text import decision_line
from mirage.workspace.workspace import Session
from typer.main import get_command

from .api import run


async def _shell(session, command, cwd, machine, no_record, json_output,
                 explain):
    if explain:
        result = explanation_to_dict(await session.explain.shell(command))
        emit(result, human=None if json_output else shell._format_explanation)
        return 0
    piped = not sys.stdin.isatty() and shell._has_input(sys.stdin.fileno())
    async with aclosing(_stdin_chunks()) as chunks:
        opts = dict(cwd=cwd,
                    machine=machine,
                    record=not no_record,
                    stdin=chunks if piped else None)
        if json_output:
            result = await session.shell(command, **opts)
            emit(await io_result_to_dict(result))
            return result.exit_code
        async with await session.shell(command, stream=True, **opts) as line:
            async for event in line.events:
                out = sys.stdout if event.stream == "stdout" else sys.stderr
                out.buffer.write(event.data)
                out.buffer.flush()
            result = await line.wait()
            if message := decision_line(result.decision):
                sys.stderr.write(message)
            return result.exit_code


async def _vfs(call, session, explain, json_output=False, **values):
    args = {}
    for name, schema in call.params.items():
        value = values[name]
        if schema is BYTES:
            value = (await asyncio.to_thread(sys.stdin.buffer.read)
                     if value is None else value.encode())
        elif schema is OWNER and isinstance(value, str) and value.isdigit():
            value = int(value)
        if value is not None:
            args[name] = value
    if call.name == "read" and not (json_output or explain):
        source = await session.vfs.read(**args, stream=True)
        try:
            async for chunk in source:
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
        finally:
            await close_quietly(source)
    else:
        result = await answered(session, call, args, explain)
        if result is not None:
            emit(result,
                 human=vfs._explained if explain else vfs.HUMAN.get(call.name))
    return 0


def invoke(surface, arguments, options):
    """Use the upstream parsers and run their operations within one trial."""
    workspace = typer.Typer(add_completion=False, no_args_is_help=True)
    workspace.add_typer(shell.app, name="shell")
    workspace.add_typer(vfs.app, name="vfs")
    group = get_command(workspace)

    def bind(cmd, operation):
        # The trial supplies the workspace that the daemon CLI selects with -w.
        cmd.params = [
            param for param in cmd.params if param.name != "workspace_id"
        ]

        def execute(session_id=None, **values):
            code = 0

            async def action(ws):
                nonlocal code
                if session_id is not None:
                    await ws.ensure_sessions_loaded()
                    ws.get_session(session_id)
                try:
                    code = await operation(Session(ws, session_id), **values)
                except BrokenPipeError:
                    code = SIGPIPE_STATUS
                except OSError as exc:
                    typer.echo(str(exc), err=True)
                    code = 1

            asyncio.run(run(**options, action=action))
            if code:
                raise typer.Exit(code)

        cmd.callback = execute

    bind(group.commands["shell"], _shell)
    for call in VFS_CALLS:
        cmd = group.commands["vfs"].commands[call.name.replace("_", "-")]
        bind(cmd, partial(_vfs, call))
    cli = group if surface == "workspace" else group.commands["shell"]
    try:
        cli.main(args=arguments, prog_name=f"vfsbench run … {surface}")
    except SystemExit as exc:
        return exc.code
