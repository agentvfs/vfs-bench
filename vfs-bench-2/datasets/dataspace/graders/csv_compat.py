"""Strict Excel-dialect CSV over frozen Mirage bytes.

Monty 1.4.0 fixes csv.field_size_limit at 128 KiB and lacks utf-8-sig.
This parser preserves DataSpace's 2 Mi-character field limit, quotes,
embedded CR/LF and blank records. Accumulate spans, not individual chars.
It implements the fixed dialect used by the reference, not a generic CSV API.
"""
import re

# Globals are supplied by the preceding pinned evaluator in one Monty program.


def append_record(records, row, path, error_type):
    max_rows = MAX_CSV_ROWS  # noqa: F821
    number = len(records) + 1
    if number > max_rows + 1:
        raise error_type(f'CSV exceeds the {max_rows}-data-row limit: {path}')
    if any('\x00' in cell for cell in row):
        raise error_type(f'NUL byte in CSV cell at row {number}: {path}')
    records.append(tuple(row))


def csv_records(text, path, error_type):
    # Scan once in the native regex engine. Indexing a large Unicode string
    # at every character can make a guest-language parser quadratic.
    max_chars = MAX_CELL_CHARACTERS  # noqa: F821
    records, row, spans = [], [], []
    state, field_length = 0, 0
    for match in re.finditer(r'[^,"\r\n]+|\r\n|[,"\r\n]', text):
        token = match.group(0)
        newline = token in ('\r', '\n', '\r\n')
        if state == 0:
            if newline:
                append_record(records, [], path, error_type)
                continue
            state = 1
        part, save, end = None, False, False
        if state == 1:  # start of field
            if token == '"':
                state = 3
            elif token == ',':
                save = True
            elif newline:
                save, end = True, True
            else:
                part, state = token, 2
        elif state == 2:  # unquoted field, quotes are ordinary characters
            if token == ',':
                save, state = True, 1
            elif newline:
                save, end = True, True
            else:
                part = token
        elif state == 3:  # quoted field, newlines and delimiters are content
            if token == '"':
                state = 4
            else:
                part = token
        else:  # quote inside a quoted field
            if token == '"':
                part, state = '"', 3
            elif token == ',':
                save, state = True, 1
            elif newline:
                save, end = True, True
            else:
                raise SyntaxError("',' expected after '\"'")
        if part is not None:
            field_length += len(part)
            if field_length > max_chars:
                raise SyntaxError(
                    f'field larger than field limit ({max_chars})')
            spans.append(part)
        if save:
            row.append(''.join(spans))
            spans, field_length = [], 0
        if end:
            append_record(records, row, path, error_type)
            row, state = [], 0
    if state == 3:
        raise SyntaxError('unexpected end of data')
    if state:
        row.append(''.join(spans))
        append_record(records, row, path, error_type)
    return records


def prediction_exists(path):
    return input_status['kind'] != 'missing'  # noqa: F821


def read_strict_csv(path, *, participant_output):
    error_type = (
        PredictionFormatError if participant_output  # noqa: F821
        else EvaluationFatalError)  # noqa: F821
    if participant_output:
        exists = prediction_exists(path)
        regular = input_status['kind'] in ('file', 'symlink')  # noqa: F821
        symlink = input_status['kind'] == 'symlink'  # noqa: F821
        size = input_status['size']  # noqa: F821
    else:
        exists, regular, symlink = path.exists(), path.is_file(), False
        size = path.stat().st_size if regular else 0
    if not exists:
        raise error_type(f'Missing CSV file: {path}')
    if not regular:
        raise error_type(f'CSV path is not a regular file: {path}')
    if symlink:
        raise error_type(f'Symbolic links are not allowed: {path}')
    max_bytes = MAX_CSV_BYTES  # noqa: F821
    if size > max_bytes:
        raise error_type(
            f'CSV exceeds the {max_bytes}-byte limit: {path} ({size} bytes)')
    try:
        data = path.read_bytes()
        if data.startswith(b'\xef\xbb\xbf'):
            data = data[3:]
        text = data.decode('utf-8')
        parsed_rows = csv_records(text, path, error_type)
    except (OSError, UnicodeDecodeError, SyntaxError) as exc:
        raise error_type(f'Cannot parse CSV {path}: {exc}') from exc
    if not parsed_rows:
        raise error_type(f'CSV is empty and has no header row: {path}')
    headers = parsed_rows[0]
    if not headers:
        raise error_type(f'CSV header has zero columns: {path}')
    max_columns = MAX_CSV_COLUMNS  # noqa: F821
    if len(headers) > max_columns:
        raise error_type(f'CSV exceeds the {max_columns}-column limit: {path}')
    for row_number, row in enumerate(parsed_rows[1:], start=2):
        if len(row) != len(headers):
            raise error_type(
                f'Non-rectangular CSV {path}: row {row_number} has '
                f'{len(row)} cells; expected {len(headers)}')
    return CsvTable(headers=headers, rows=tuple(parsed_rows[1:]))  # noqa: F821
