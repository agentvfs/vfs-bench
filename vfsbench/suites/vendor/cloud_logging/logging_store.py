import fcntl
import json
import os
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ENV = "CLOUD_LOGGING_STORE"

# The API server scopes each request to a task's own directory through
# this, without touching the process environment; `root()` prefers it.
ROOT_OVERRIDE: ContextVar[str | None] = ContextVar("cloud_logging_root",
                                                   default=None)

# Cloud Logging's own ordering, used by `severity >= ERROR`-style filters.
SEVERITIES = {
    "DEFAULT": 0,
    "DEBUG": 100,
    "INFO": 200,
    "NOTICE": 300,
    "WARNING": 400,
    "ERROR": 500,
    "CRITICAL": 600,
    "ALERT": 700,
    "EMERGENCY": 800,
}

# The API's timestamp form. Written with microseconds and a `Z`, which is
# what `_helpers._TIME_FORMAT` produces and what every reader parses.
STAMP = "%Y-%m-%dT%H:%M:%S.%fZ"

TOKENS = re.compile(
    r"""
    \s*(?:
        (?P<lparen>\()
      | (?P<rparen>\))
      | (?P<string>"(?:[^"\\]|\\.)*")
      | (?P<op>>=|<=|!=|=|:|>|<)
      # An operator this store does not implement -- `~`, say -- must not
      # fall into `word` and be read as a field name; the error should
      # name the operator.
      | (?P<word>[^\s()="'<>:!~]+)
    )
""", re.VERBOSE)

DIRECT = {
    "logname": "logName",
    "severity": "severity",
    "timestamp": "timestamp",
    "textpayload": "textPayload",
    "insertid": "insertId",
    "trace": "trace",
    "spanid": "spanId",
    "receivetimestamp": "receiveTimestamp",
}
NESTED = {
    "jsonpayload": "jsonPayload",
    "protopayload": "protoPayload",
    "labels": "labels",
    "resource": "resource",
    "httprequest": "httpRequest",
}

MISSING = object()


class FilterError(ValueError):
    """A filter this store does not implement."""


def root() -> Path:
    """The directory the store lives in.

    Returns:
        Path: the directory, created if it does not exist.

    Raises:
        RuntimeError: the variable is unset, which means no store was
            chosen and writing anywhere would be a guess.
    """
    where = ROOT_OVERRIDE.get() or os.environ.get(ENV)
    if not where:
        raise RuntimeError(f"{ENV} is not set; point it at a directory and "
                           f"create the task's buckets with "
                           f"server/seed/seed_logging.py")
    path = Path(where)
    path.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def locked() -> Iterator[Path]:
    """Hold the store's lock for the duration of the block.

    Yields:
        Path: the store directory.
    """
    directory = root()
    handle = open(directory / "lock", "a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield directory
    finally:
        fcntl.flock(handle, fcntl.LOCK_UN)
        handle.close()


def now() -> str:
    """The current time in the API's timestamp form.

    Returns:
        str: an RFC 3339 timestamp.
    """
    return datetime.now(timezone.utc).strftime(STAMP)


def write(entries: list[dict],
          log_name: str | None = None,
          resource: Any = None,
          labels: dict | None = None) -> int:
    """Append entries, filling in what the service stamps server-side.

    Args:
        entries (list[dict]): entries in `LogEntry` API form.
        log_name (str | None): the request-level default `logName`.
        resource: the request-level default monitored resource.
        labels (dict | None): request-level labels, merged under each
            entry's own.

    Returns:
        int: how many entries were written.
    """
    stamped = []
    for entry in entries:
        row = dict(entry)
        row.setdefault("logName", log_name)
        if resource is not None:
            row.setdefault("resource", as_plain(resource))
        merged = dict(labels or {})
        merged.update(row.get("labels") or {})
        if merged:
            row["labels"] = merged
        row.setdefault("severity", "DEFAULT")
        row.setdefault("timestamp", now())
        row.setdefault("receiveTimestamp", row["timestamp"])
        row.setdefault("insertId", uuid.uuid4().hex)
        stamped.append(row)
    with locked() as directory:
        with open(directory / "entries.jsonl", "a", encoding="utf-8") as out:
            for row in stamped:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(stamped)


def as_plain(value: Any) -> Any:
    """Turn a proto-plus message into the JSON the API would return.

    Args:
        value: a message, a mapping, or anything already plain.

    Returns:
        Any: something `json.dumps` accepts.
    """
    if hasattr(value, "_pb"):
        from google.protobuf.json_format import MessageToDict
        return MessageToDict(type(value).pb(value))
    if isinstance(value, dict):
        return {key: as_plain(item) for key, item in value.items()}
    if hasattr(value, "type") and hasattr(value, "labels"):
        return {"type": value.type, "labels": dict(value.labels)}
    return value


def read() -> list[dict]:
    """Every entry in the store, in write order.

    Returns:
        list[dict]: the entries.
    """
    with locked() as directory:
        path = directory / "entries.jsonl"
        if not path.is_file():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines() if line
        ]


def delete_log(log_name: str) -> int:
    """Drop every entry of one log, as `Logger.delete` does.

    Args:
        log_name (str): the full `projects/P/logs/NAME` form.

    Returns:
        int: how many entries were removed.
    """
    with locked() as directory:
        path = directory / "entries.jsonl"
        if not path.is_file():
            return 0
        kept, dropped = [], 0
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line:
                continue
            if json.loads(line).get("logName") == log_name:
                dropped += 1
            else:
                kept.append(line)
        path.write_text("".join(f"{line}\n" for line in kept),
                        encoding="utf-8")
    return dropped


def buckets() -> dict[str, dict]:
    """The log buckets, by their full resource name.

    Returns:
        dict[str, dict]: name -> `{retention_days, description, ...}`.
    """
    with locked() as directory:
        path = directory / "buckets.json"
        if not path.is_file():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))


def put_bucket(name: str, fields: dict) -> None:
    """Create or replace one log bucket.

    Args:
        name (str): the full `projects/P/locations/L/buckets/ID` form.
        fields (dict): its settings.
    """
    with locked() as directory:
        path = directory / "buckets.json"
        current = json.loads(path.read_text(
            encoding="utf-8")) if path.is_file() else {}
        current[name] = fields
        path.write_text(json.dumps(current, indent=2), encoding="utf-8")


def drop_bucket(name: str) -> bool:
    """Delete one log bucket.

    Args:
        name (str): the full resource name.

    Returns:
        bool: whether it was there.
    """
    with locked() as directory:
        path = directory / "buckets.json"
        current = json.loads(path.read_text(
            encoding="utf-8")) if path.is_file() else {}
        gone = current.pop(name, None) is not None
        path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return gone


def clear_entries() -> None:
    """Drop every entry, keeping the buckets.

    The reset both arms need between runs: a log bucket is fixture, the
    entries in it are what an arm is graded on.
    """
    with locked() as directory:
        (directory / "entries.jsonl").write_text("", encoding="utf-8")


def select(filter_: str | None,
           order_by: str | None = None,
           max_results: int | None = None) -> list[dict]:
    """The entries one query returns.

    Args:
        filter_ (str | None): an advanced filter, or None for everything.
        order_by (str | None): `timestamp asc` or `timestamp desc`.
        max_results (int | None): cap on the number returned.

    Returns:
        list[dict]: matching entries, ordered.

    Raises:
        ValueError: max_results was negative, as the real API raises.
    """
    if max_results is not None and max_results < 0:
        raise ValueError("max_results must be positive")
    # Parse once against an empty entry before touching the rows: `matches`
    # parses as it evaluates, so on an empty store a malformed filter would
    # otherwise never be parsed at all and garbage would quietly select
    # nothing instead of being refused.
    matches({}, filter_)
    rows = [row for row in read() if matches(row, filter_)]
    rows.sort(key=lambda row:
              (row.get("timestamp") or "", row.get("insertId") or ""),
              reverse=(order_by or "").strip().lower().endswith("desc"))
    return rows if max_results is None else rows[:max_results]


# --------------------------------------------------------------------------
# the filter language


def tokenise(text: str) -> list[tuple[str, str]]:
    """Split a filter into `(kind, text)` pairs.

    Args:
        text (str): the filter expression.

    Returns:
        list[tuple[str, str]]: the tokens.

    Raises:
        FilterError: a character that cannot start a token.
    """
    out: list[tuple[str, str]] = []
    at = 0
    while at < len(text):
        if text[at].isspace():
            at += 1
            continue
        match = TOKENS.match(text, at)
        if match is None or match.end() == at:
            raise FilterError(f"cannot parse filter at {text[at:at + 30]!r}")
        kind = match.lastgroup
        out.append((kind, match.group(kind)))
        at = match.end()
    return out


def unquote(word: str) -> str:
    """The value a quoted or bare token carries.

    Args:
        word (str): the token text.

    Returns:
        str: its value, with escapes resolved.
    """
    if word.startswith('"') and word.endswith('"') and len(word) >= 2:
        return re.sub(r"\\(.)", r"\1", word[1:-1])
    return word


def path_of(word: str) -> list[str]:
    """Split a field reference on its unescaped dots.

    `jsonPayload.logging\\.googleapis\\.com/diagnostic` is two components,
    not four: the escaped dots belong to the key.

    Args:
        word (str): the field reference.

    Returns:
        list[str]: the components, unescaped.
    """
    parts, current, at = [], "", 0
    while at < len(word):
        char = word[at]
        if char == "\\" and at + 1 < len(word):
            current += word[at + 1]
            at += 2
            continue
        if char == ".":
            parts.append(current)
            current = ""
            at += 1
            continue
        current += char
        at += 1
    parts.append(current)
    return parts


def resolve(entry: dict, word: str) -> Any:
    """The value a field reference names in one entry.

    Args:
        entry (dict): the entry, in API form.
        word (str): the field reference.

    Returns:
        Any: the value, or the MISSING sentinel.

    Raises:
        FilterError: a field family this store does not model.
    """
    parts = path_of(word)
    head = parts[0].lower()
    if head in DIRECT and len(parts) == 1:
        return entry.get(DIRECT[head], MISSING)
    if head not in NESTED:
        raise FilterError(f"unsupported filter field {word!r}")
    value: Any = entry.get(NESTED[head], MISSING)
    for part in parts[1:]:
        if not isinstance(value, dict) or part not in value:
            return MISSING
        value = value[part]
    return value


def moment(value: Any) -> datetime:
    """One timestamp, however it was spelled.

    Args:
        value: an RFC 3339 string.

    Returns:
        datetime: timezone-aware, in UTC.

    Raises:
        FilterError: it is not a timestamp.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as failure:
        raise FilterError(f"not a timestamp: {value!r}") from failure
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def compare(field: str, left: Any, op: str, right: str) -> bool:
    """One comparison, with the field's own semantics.

    Args:
        field (str): the field reference, which decides how to compare.
        left: the entry's value, or MISSING.
        op (str): the operator.
        right (str): the literal from the filter.

    Returns:
        bool: whether the entry satisfies it.

    Raises:
        FilterError: an operator this store does not implement.
    """
    if left is MISSING:
        return op == "!="
    head = path_of(field)[0].lower()
    if head == "timestamp" or head == "receivetimestamp":
        here, there = moment(left), moment(right)
    elif head == "severity":
        here = SEVERITIES.get(str(left).upper(), -1)
        there = SEVERITIES.get(str(right).upper(), -1)
    elif isinstance(left, bool) or isinstance(left, (int, float)):
        try:
            here, there = left, type(left)(right)
        except ValueError:
            here, there = str(left), right
    else:
        here, there = left, right
    if op == "=":
        return here == there
    if op == "!=":
        return here != there
    if op == ":":
        # Cloud Logging's "has": substring for strings, membership
        # otherwise. Only ever written against textPayload here.
        if isinstance(left, str):
            return right in left
        if isinstance(left, (list, tuple)):
            return right in [str(item) for item in left]
        if isinstance(left, dict):
            return right in left
        return str(left) == right
    if op == ">=":
        return here >= there
    if op == "<=":
        return here <= there
    if op == ">":
        return here > there
    if op == "<":
        return here < there
    raise FilterError(f"unsupported filter operator {op!r}")


class Parser:
    """A recursive-descent reader for the filter slice this store models.

    Attributes:
        tokens (list): the token stream.
        at (int): the cursor.
    """

    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.at = 0

    def peek(self) -> tuple[str, str] | None:
        """The next token without consuming it.

        Returns:
            tuple[str, str] | None: the token, or None at the end.
        """
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self) -> tuple[str, str]:
        """Consume and return the next token.

        Returns:
            tuple[str, str]: the token.
        """
        token = self.tokens[self.at]
        self.at += 1
        return token

    def expression(self, entry: dict) -> bool:
        """`a OR b OR c`.

        Args:
            entry (dict): the entry being tested.

        Returns:
            bool: whether it matches.
        """
        value = self.conjunction(entry)
        while True:
            token = self.peek()
            if token is None or token[0] != "word" or token[1].upper() != "OR":
                return value
            self.take()
            value = self.conjunction(entry) or value

    def conjunction(self, entry: dict) -> bool:
        """`a AND b`, and the juxtaposition the API also reads as AND.

        Args:
            entry (dict): the entry being tested.

        Returns:
            bool: whether it matches.
        """
        value = self.factor(entry)
        while True:
            token = self.peek()
            if token is None or token[0] == "rparen":
                return value
            if token[0] == "word" and token[1].upper() == "OR":
                return value
            if token[0] == "word" and token[1].upper() == "AND":
                self.take()
            value = self.factor(entry) and value

    def factor(self, entry: dict) -> bool:
        """`NOT x`, `( ... )`, or one comparison.

        Args:
            entry (dict): the entry being tested.

        Returns:
            bool: whether it matches.

        Raises:
            FilterError: the expression ended early or is unbalanced.
        """
        token = self.peek()
        if token is None:
            raise FilterError("filter ends early")
        if token[0] == "word" and token[1].upper() in ("NOT", "-"):
            self.take()
            return not self.factor(entry)
        if token[0] == "lparen":
            self.take()
            value = self.expression(entry)
            closing = self.peek()
            if closing is None or closing[0] != "rparen":
                raise FilterError("unbalanced parentheses in filter")
            self.take()
            return value
        if token[0] != "word":
            raise FilterError(f"unexpected {token[1]!r} in filter")
        field = self.take()[1]
        following = self.peek()
        if following is None or following[0] != "op":
            # A bare field is an existence test, which is how the graders
            # spell "and not the library's own diagnostic entry".
            return resolve(entry, field) is not MISSING
        op = self.take()[1]
        literal = self.peek()
        if literal is None or literal[0] not in ("word", "string"):
            raise FilterError(f"{field} {op} what?")
        return compare(field, resolve(entry, field), op,
                       unquote(self.take()[1]))


def matches(entry: dict, filter_: str | None) -> bool:
    """Whether one entry satisfies a filter.

    Args:
        entry (dict): the entry, in API form.
        filter_ (str | None): the expression, or None for everything.

    Returns:
        bool: whether it matches.

    Raises:
        FilterError: the filter is malformed or outside the slice modelled.
    """
    if not filter_ or not filter_.strip():
        return True
    parser = Parser(tokenise(filter_))
    value = parser.expression(entry)
    if parser.peek() is not None:
        raise FilterError(f"trailing {parser.peek()[1]!r} in filter")
    return value
