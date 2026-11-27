"""CSV conversions from the digest-pinned VFS-Bench 1 BigQuery seeder."""

from typing import Any

BOOLEANS = {"true", "false"}


def is_integer(value: str) -> bool:
    """Whether a cell is an integer with nothing else in it.

    Args:
        value (str): the cell.
    """
    try:
        int(value)
    except ValueError:
        return False
    return True


def is_float(value: str) -> bool:
    """Whether a cell is a number.

    `float` also accepts `nan` and `inf`, which are words a text column may
    legitimately hold, so they are excluded.

    Args:
        value (str): the cell.
    """
    if value.strip().lower().lstrip("+-") in {"nan", "inf", "infinity"}:
        return False
    try:
        float(value)
    except ValueError:
        return False
    return True


def column_type(values: list[str]) -> str:
    """The BigQuery type for one column's worth of cells.

    Args:
        values (list[str]): every non-empty cell in the column.

    Returns:
        str: an emulator column type.
    """
    if not values:
        return "STRING"
    if all(is_integer(value) for value in values):
        return "INT64"
    if all(is_float(value) for value in values):
        return "FLOAT64"
    if all(value.strip().lower() in BOOLEANS for value in values):
        return "BOOL"
    return "STRING"


def typed(value: str, kind: str) -> Any:
    """One cell, as the type its column was given.

    An empty cell is NULL whatever the column is: a CSV cannot distinguish
    the empty string from a missing value, and BigQuery's loader reads it as
    the latter.

    Args:
        value (str): the cell.
        kind (str): the column's type.

    Returns:
        Any: the value for the seed file.
    """
    if value == "":
        return None
    if kind == "INT64":
        return int(value)
    if kind == "FLOAT64":
        return float(value)
    if kind == "BOOL":
        return value.strip().lower() == "true"
    return value
