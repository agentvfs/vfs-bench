import copy
import json
import re
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

import requests

ACCOUNTING_FORMAT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)'

COMPACT_FORMAT = '[<999950000]0.0,,"M";[<999950000000]0.0,,,"B";0.0,,,,"T"'


# Per-run cell formats, held in front of Mirage's GWS fake for both arms and
# the grader. Every format write also reaches the fake, which renders the
# numeric pattern language itself; `formatted` renders the fixtures' own
# patterns as Google showed them when they were captured.
class Formats:

    def __init__(self):
        self.cells = {}

    def rectangle(self, area, sheets):
        sheet_id = area.get('sheetId', 0)
        props = next(
            (s['properties']
             for s in sheets if s['properties']['sheetId'] == sheet_id), None)
        if props is None:
            raise ValueError('Invalid sheetId')
        grid = props['gridProperties']
        r0 = area.get('startRowIndex', area.get('rowIndex', 0))
        c0 = area.get('startColumnIndex', area.get('columnIndex', 0))
        r1 = area.get('endRowIndex', grid['rowCount'])
        c1 = area.get('endColumnIndex', grid['columnCount'])
        if not (0 <= r0 < r1 and 0 <= c0 < c1):
            raise ValueError('Invalid format range')
        return sheet_id, r0, c0, r1, c1

    def set_cell(self, key, cell, fields):
        masks = [p.strip() for p in fields.split(',')]
        if '*' in masks or 'userEnteredFormat' in masks:
            self.cells[key] = copy.deepcopy(cell.get('userEnteredFormat', {}))
            return
        result = self.cells.setdefault(key, {})
        for mask in masks:
            if not mask.startswith('userEnteredFormat.'):
                continue
            parts = mask.split('.')[1:]
            incoming = cell.get('userEnteredFormat', {})
            target = result
            for part in parts[:-1]:
                incoming = incoming.get(part, {})
                target = target.setdefault(part, {})
            if parts[-1] in incoming:
                target[parts[-1]] = copy.deepcopy(incoming[parts[-1]])
            else:
                target.pop(parts[-1], None)

    def update(self, request, sheets):
        area = request.get('range', request.get('start', {}))
        tab, r0, c0, r1, c1 = self.rectangle(area, sheets)
        rows = request.get('rows', [])
        fields = request.get('fields', '')
        if 'range' not in request:
            r1 = r0 + len(rows)
            c1 = c0 + max(
                (len(row.get('values', [])) for row in rows), default=0)
        for r in range(r0, r1):
            values = rows[r -
                          r0].get('values', []) if r - r0 < len(rows) else []
            for c in range(c0, c1):
                cell = values[c - c0] if c - c0 < len(values) else {}
                self.set_cell((tab, r, c), cell, fields)

    def translate(self, operations, sheets):
        translated = []
        for op in operations:
            if 'repeatCell' in op:
                item = op['repeatCell']
                tab, r0, c0, r1, c1 = self.rectangle(item['range'], sheets)
                op = {
                    'updateCells': {
                        'range':
                        item['range'],
                        'fields':
                        item['fields'],
                        'rows': [{
                            'values': [
                                copy.deepcopy(item['cell'])
                                for _ in range(c0, c1)
                            ]
                        } for _ in range(r0, r1)]
                    }
                }
            elif 'copyPaste' in op:
                item = op['copyPaste']
                if item.get('pasteType') != 'PASTE_FORMAT':
                    raise ValueError(
                        'The audit fixture supports PASTE_FORMAT only')
                src, sr, sc, er, ec = self.rectangle(item['source'], sheets)
                dst, dr, dc, end_r, end_c = self.rectangle(
                    item['destination'], sheets)
                source = copy.deepcopy(self.cells)
                transpose = item.get('pasteOrientation',
                                     'NORMAL') == 'TRANSPOSE'
                height, width = (ec - sc, er - sr) if transpose else (er - sr,
                                                                      ec - sc)
                rows = []
                for r in range(dr, end_r):
                    row = []
                    for c in range(dc, end_c):
                        y, x = (r - dr) % height, (c - dc) % width
                        sy, sx = (sr + x, sc + y) if transpose else (sr + y,
                                                                     sc + x)
                        row.append({
                            'userEnteredFormat':
                            source.get((src, sy, sx), {})
                        })
                    rows.append({'values': row})
                op = {
                    'updateCells': {
                        'range': item['destination'],
                        'fields': 'userEnteredFormat',
                        'rows': rows
                    }
                }
            if 'updateCells' in op:
                self.update(op['updateCells'], sheets)
            if 'deleteSheet' in op:
                tab = op['deleteSheet']['sheetId']
                self.cells = {
                    k: v
                    for k, v in self.cells.items() if k[0] != tab
                }
            translated.append(op)
        return translated

    def overlay(self, document, ranged=False):
        # A read of `ranges` answers each range with a block that starts at
        # its `startRow` and `startColumn` and holds the cells the fake has
        # there, format-only ones included, so a format lands in the cell it
        # was set on or nowhere. A whole read starts every tab at A1, and a
        # format past the tab's last value still reaches it.
        for tab in document.get('sheets', []):
            tab_id = tab['properties']['sheetId']
            for grid in tab.get('data', []):
                top, left = grid.get('startRow', 0), grid.get('startColumn', 0)
                rows = grid.setdefault('rowData', [])
                for (sheet, row, column), fmt in self.cells.items():
                    row, column = row - top, column - left
                    if sheet != tab_id or not fmt or row < 0 or column < 0:
                        continue
                    if ranged and (row >= len(rows) or column >= len(
                            rows[row].get('values', []))):
                        continue
                    while len(rows) <= row:
                        rows.append({})
                    cells = rows[row].setdefault('values', [])
                    while len(cells) <= column:
                        cells.append({})
                    cells[column]['userEnteredFormat'] = copy.deepcopy(fmt)
                    cells[column]['effectiveFormat'] = copy.deepcopy(fmt)
                    value = cells[column].get('effectiveValue',
                                              {}).get('numberValue')
                    text = None if value is None else formatted(value, fmt)
                    if text is not None:
                        cells[column]['formattedValue'] = text
        return document


@contextmanager
def serve(base, port=0, state_path=None):
    formats = {}
    saved = Path(state_path) if state_path else None

    def load():
        if saved and saved.exists():
            formats.clear()
            for sheet, rows in json.loads(saved.read_text()).items():
                entry = Formats()
                entry.cells = {tuple(key): value for key, value in rows}
                formats[sheet] = entry

    def persist():
        if saved:
            pending = saved.with_suffix('.pending')
            pending.write_text(
                json.dumps({
                    key: list(value.cells.items())
                    for key, value in formats.items()
                }))
            pending.replace(saved)

    load()
    lock = threading.RLock()

    class Handler(BaseHTTPRequestHandler):

        def log_message(self, *args):
            pass

        def forward(self, method, path, raw):
            return requests.request(
                method,
                base + path,
                data=raw,
                headers={
                    key: value
                    for key, value in self.headers.items() if key.lower()
                    not in {'host', 'content-length', 'connection'}
                },
                timeout=30)

        def handle_request(self):
            raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            path = urlsplit(self.path).path
            sheet = re.fullmatch(r'/v4/spreadsheets/([^/:]+)(:batchUpdate)?',
                                 path)
            with lock:
                try:
                    load()
                    candidate = None
                    if sheet and sheet[2] and self.command == 'POST':
                        metadata = self.forward('GET',
                                                '/v4/spreadsheets/' + sheet[1],
                                                b'')
                        if metadata.status_code >= 400:
                            self.send_reply(
                                metadata.status_code, metadata.content,
                                metadata.headers.get('Content-Type'))
                            return
                        body = json.loads(raw)
                        candidate = copy.deepcopy(
                            formats.get(sheet[1], Formats()))
                        body['requests'] = candidate.translate(
                            body.get('requests', []),
                            metadata.json()['sheets'])
                        raw = json.dumps(body).encode()
                    forwarded = (unmasked(self.path) if sheet and not sheet[2]
                                 and self.command == 'GET' else self.path)
                    response = self.forward(self.command, forwarded, raw)
                    result = response.content
                    if response.status_code < 400:
                        copied = re.fullmatch(r'/drive/v3/files/([^/]+)/copy',
                                              path)
                        if copied:
                            formats[response.json()['id']] = copy.deepcopy(
                                formats.get(copied[1], Formats()))
                        copied_tab = re.fullmatch(
                            r'/v4/spreadsheets/([^/]+)/sheets/(\d+):copyTo',
                            path)
                        if copied_tab:
                            dest = json.loads(raw)['destinationSpreadsheetId']
                            tab_id = response.json()['sheetId']
                            target = formats.setdefault(dest, Formats())
                            for (tab, row, col), fmt in list(
                                    formats.get(copied_tab[1],
                                                Formats()).cells.items()):
                                if tab == int(copied_tab[2]):
                                    target.cells[(tab_id, row,
                                                  col)] = copy.deepcopy(fmt)
                        if path == '/reset':
                            formats.clear()
                        if candidate is not None:
                            formats[sheet[1]] = candidate
                        if sheet and not sheet[2] and self.command == 'GET':
                            doc = formats.get(sheet[1], Formats()).overlay(
                                response.json(), 'ranges'
                                in parse_qs(urlsplit(self.path).query))
                            # The live API trims a read to its `fields`
                            # mask, and the overlay's formats are no exception.
                            mask = parse_qs(urlsplit(
                                self.path).query).get('fields')
                            if mask:
                                doc = masked(doc, read_mask(mask[0]))
                            result = json.dumps(doc).encode()
                        values = re.fullmatch(
                            r'/v4/spreadsheets/([^/]+)/values/(.+)', path)
                        query = parse_qs(urlsplit(self.path).query)
                        if (values and self.command == 'GET' and query.get(
                                'valueRenderOption', ['FORMATTED_VALUE'])[0]
                                == 'FORMATTED_VALUE'):
                            document = self.forward(
                                'GET', '/v4/spreadsheets/' + values[1] +
                                '?includeGridData=true', b'').json()
                            data = response.json()
                            render_values(data,
                                          formats.get(values[1], Formats()),
                                          document)
                            result = json.dumps(data).encode()
                        persist()
                    self.send_reply(response.status_code, result,
                                    response.headers.get('Content-Type'))
                except (ValueError, KeyError, TypeError) as error:
                    self.send_reply(
                        400,
                        json.dumps({
                            'error': {
                                'code': 400,
                                'message': str(error),
                                'status': 'INVALID_ARGUMENT'
                            }
                        }).encode(), 'application/json')
                except requests.RequestException as error:
                    self.send_reply(502, str(error).encode(), 'text/plain')

        def send_reply(self, code, raw, content_type):
            self.send_response(code)
            self.send_header('Content-Type', content_type
                             or 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_request

    from start_formats import background
    with background(Handler, port=port) as url:
        yield url


def formatted(value, fmt):
    number = fmt.get('numberFormat', {})
    if (number.get('type') == 'PERCENT' and number.get('pattern') == '0.00%'):
        rounded = (Decimal(str(value)) * 100).quantize(Decimal('.01'),
                                                       ROUND_HALF_UP)
        return f'{rounded:,.2f}%'
    if (number.get('type') == 'NUMBER'
            and number.get('pattern') == '#,##0.00'):
        rounded = Decimal(str(value)).quantize(Decimal('.01'), ROUND_HALF_UP)
        return f'{rounded:,.2f}'
    if number.get('pattern') == COMPACT_FORMAT:
        scale, suffix = ((10**6, 'M') if value < 999950000 else
                         (10**9, 'B') if value < 999950000000 else
                         (10**12, 'T'))
        scaled = (Decimal(str(value)) / scale).quantize(
            Decimal('.1'), ROUND_HALF_UP)
        return f'{scaled:.1f}{suffix}'
    if number.get('pattern') == 'mmmm" "d", "yyyy':
        date = datetime(1899, 12, 30) + timedelta(days=value)
        return f'{date:%B} {date.day}, {date.year}'
    if number.get('pattern') == 'yyyy-mm-dd hh:mm:ss':
        return (datetime(1899, 12, 30) +
                timedelta(days=value)).strftime('%Y-%m-%d %H:%M:%S')
    if number.get('pattern') in ('#,##0', ACCOUNTING_FORMAT):
        rounded = Decimal(str(value)).quantize(Decimal('1'), ROUND_HALF_UP)
        text = f'{rounded:,}'
        if number['pattern'] == ACCOUNTING_FORMAT:
            if not value:
                return '  -   '
            return '  ' + (f'({text[1:]})' if value < 0 else text) + ' '
        return text
    # Any other format is the fake's to render: it holds the same one.
    return None if number else str(value)


def render_values(data, formats, document):
    area = unquote(data.get('range', ''))
    if '!' in area:
        title, span = area.rsplit('!', 1)
        title = title.strip("'").replace("''", "'")
    else:
        title, span = area.strip("'").replace("''", "'"), 'A1'
    sheet = next(
        (s for s in document['sheets'] if s['properties']['title'] == title),
        None)
    if sheet is None:
        return
    # The fixture echoes unexpanded ranges, including a whole worksheet.
    start = span.split(':', 1)[0]
    match = re.fullmatch(r'([A-Z]*)([0-9]*)', start)
    if not match:
        return
    column = 0
    for char in match[1] or 'A':
        column = column * 26 + ord(char) - ord('A') + 1
    row = int(match[2] or '1') - 1
    column -= 1
    cells = {}
    for block in sheet.get('data', []):
        for y, entry in enumerate(block.get('rowData', [])):
            for x, cell in enumerate(entry.get('values', [])):
                cells[(block.get('startRow', 0) + y,
                       block.get('startColumn', 0) + x)] = cell
    transposed = data.get('majorDimension') == 'COLUMNS'
    for y, values in enumerate(data.get('values', [])):
        for x, value in enumerate(values):
            r, c = (row + x, column + y) if transposed else (row + y,
                                                             column + x)
            fmt = formats.cells.get((sheet['properties']['sheetId'], r, c), {})
            # The mock values API stringifies numbers. Grid metadata retains
            # their type, so numeric-looking text remains text here too.
            number = cells.get((r, c), {}).get('effectiveValue',
                                               {}).get('numberValue')
            if number is not None and 'numberFormat' in fmt:
                values[x] = formatted(number, fmt) or values[x]


def read_mask(text):
    # `a.b(c,d/e),f` as the live API reads a GET's `fields`: a parenthesized
    # list distributes over the path before it, and `/` separates as `.` does.
    at = 0

    def items(prefix):
        nonlocal at
        paths = []
        while True:
            path, name = list(prefix), ''
            while at < len(text) and text[at] not in ',()':
                if text[at] in './':
                    path.append(name.strip())
                    name = ''
                else:
                    name += text[at]
                at += 1
            if name.strip():
                path.append(name.strip())
            if at < len(text) and text[at] == '(':
                at += 1
                paths += items(path)
                if at < len(text) and text[at] == ')':
                    at += 1
            elif len(path) > len(prefix):
                paths.append(path)
            if at >= len(text) or text[at] != ',':
                return paths
            at += 1

    return items([])


def unmasked(path):
    # The overlay places formats by each tab's `sheetId`, and Mirage's fake
    # trims a read to its mask, so a mask that selects cell data without the
    # sheet IDs is forwarded without it; the reply is trimmed to it after.
    parts = urlsplit(path)
    query = parse_qs(parts.query, keep_blank_values=True)
    if 'fields' not in query:
        return path
    target = ['sheets', 'properties', 'sheetId']

    def covers(mask):
        for depth, part in enumerate(mask):
            if part == '*':
                return True
            if depth >= len(target) or part != target[depth]:
                return False
        return True

    paths = read_mask(query['fields'][0])
    if (any(covers(mask) for mask in paths)
            or not any(mask[:2] == ['sheets', 'data'] for mask in paths)):
        return path
    del query['fields']
    return parts._replace(query=urlencode(query, doseq=True)).geturl()


def masked(value, paths):
    if ['*'] in paths:
        return value
    if isinstance(value, list):
        return [masked(item, paths) for item in value]
    if not isinstance(value, dict):
        return value
    kept = {}
    for key, item in value.items():
        rests = [path[1:] for path in paths if path[0] == key]
        if rests:
            kept[key] = item if [] in rests else masked(item, rests)
    return kept
