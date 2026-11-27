class Text:
    """One `types.TextContent`, as much of it as callers read."""

    def __init__(self, text: str):
        """
        Args:
            text (str): the tool's answer.
        """
        self.text = text


class Result:
    """What `call_tool_with_retry` returns: something with `.content`."""

    def __init__(self, text: str):
        """
        Args:
            text (str): the tool's answer.
        """
        self.content = [Text(text)]


class Server:
    """The connection upstream opens with `async with`, opening nothing."""

    async def __aenter__(self):
        """Hand back the sentinel every tool call is passed."""
        return self

    async def __aexit__(self, *exception) -> bool:
        """Never suppress."""
        return False


class Manager:
    """`MCPServerManager`, minus the servers."""

    def __init__(self, *_, **__):
        """Accept upstream's keyword arguments and ignore them."""
        self.servers = {"snowflake": Server()}


def databases(snowflake_pg) -> set[str]:
    """The databases the account has, as the MCP server lists them.

    Args:
        snowflake_pg: the shim module.

    Returns:
        set[str]: database names, upper-cased the way Snowflake reports
            them.
    """
    rows = snowflake_pg.execute(
        "SELECT DATABASE_NAME FROM INFORMATION_SCHEMA.DATABASES")
    return {row["DATABASE_NAME"].upper() for row in rows}


def tool_call(snowflake_pg):
    """Build the replacement for `call_tool_with_retry`.

    Each branch is the body of the matching handler in
    `vendor/snowflake-mcp/src/src/mcp_snowflake_server/server.py`, with the
    allow-write and allowed-database guards left out: this is the fixture
    being built, not an agent being watched.

    Args:
        snowflake_pg: the shim module.

    Returns:
        The coroutine function to patch in.
    """

    async def call_tool_with_retry(server,
                                   tool_name=None,
                                   arguments=None,
                                   **_) -> Result:
        """Run one MCP tool call against the fixture Postgres.

        Args:
            server: the sentinel, unused.
            tool_name (str): which tool.
            arguments (dict): its arguments.

        Returns:
            Result: the tool's answer, shaped like the server's.

        Raises:
            ValueError: the preprocess reached a tool with no stand-in.
        """
        arguments = arguments or {}
        if tool_name in ("read_query", "write_query", "create_table"):
            return Result(str(snowflake_pg.execute(arguments["query"])))
        if tool_name in ("create_databases", "drop_databases"):
            create = tool_name == "create_databases"
            existing = databases(snowflake_pg)
            said = []
            for name in arguments["databases"]:
                there = name.upper() in existing
                if there == create:
                    was = "already exists" if there else "does not exist"
                    said.append(f"Warning: Database '{name}' {was}, skipping")
                    continue
                verb = "CREATE" if create else "DROP"
                snowflake_pg.execute(f"{verb} DATABASE {name}")
                said.append(f"Successfully {verb.lower()}d database '{name}'")
            return Result("\n".join(said))
        raise ValueError(f"snowflake_mcp: no stand-in for MCP tool "
                         f"{tool_name!r}")

    return call_tool_with_retry
