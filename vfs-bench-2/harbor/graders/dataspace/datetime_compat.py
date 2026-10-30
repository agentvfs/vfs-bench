"""DataSpace ISO parsing with CPython 3.12 semantics (the reference VM).

Monty's parser omits basic/week forms and sub-second UTC offsets. Keep
naive datetimes and an integer offset, then normalize directly to UTC;
there is no need for a host callback or a custom tzinfo subclass.
"""
import re
from datetime import date, datetime, time, timedelta

# Globals are supplied by the preceding pinned evaluator in one Monty program.


def iso_separator(text):
    # CPython's week-date/digit-separator disambiguation, also used when
    # the separator is an arbitrary Unicode character.
    length = len(text)
    if length < 7:
        raise ValueError('short ISO date')
    if length == 7:
        return 7
    if text[4] == '-':
        if text[5] != 'W':
            return 10
        if length > 8 and text[8] == '-':
            if length == 9:
                raise ValueError('incomplete ISO week date')
            return 8 if length > 10 and '0' <= text[10] <= '9' else 10
        return 8
    if text[4] != 'W':
        return 8
    end = 7
    while end < length and '0' <= text[end] <= '9':
        end += 1
    return end if end < 9 else (7 if end % 2 == 0 else 8)


def iso_date(text):
    match = re.fullmatch(r'([0-9]{4})(-?)W([0-9]{2})(?:([0-9])|-([0-9]))?',
                         text)
    if match:
        year, week = int(match.group(1)), int(match.group(3))
        # Week-day punctuation must agree with the year separator.
        if (match.group(4) and match.group(2)) or (match.group(5)
                                                   and not match.group(2)):
            raise ValueError('inconsistent ISO week separators')
        day = int(match.group(4) or match.group(5) or '1')
        jan4 = date(year, 1, 4)
        jan1 = date(year, 1, 1).weekday()
        leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
        weeks = 53 if jan1 == 3 or (jan1 == 2 and leap) else 52
        if not 1 <= week <= weeks or not 1 <= day <= 7:
            raise ValueError('invalid ISO week')
        try:
            return jan4 + timedelta(days=7 *
                                    (week - 1) + day - 1 - jan4.weekday())
        except TypeError as exc:
            # Monty returns NotImplemented for out-of-range date arithmetic.
            raise ValueError('ISO week date out of range') from exc
    if re.fullmatch(r'[0-9]{8}', text):
        return date(int(text[:4]), int(text[4:6]), int(text[6:]))
    if re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', text):
        return date(int(text[:4]), int(text[5:7]), int(text[8:]))
    raise ValueError('invalid ISO date')


def iso_clock(text, offset_follows=False):
    values, position, separated = [0, 0, 0], 0, False
    for index in range(3):
        pair = text[position:position + 2]
        if not re.fullmatch(r'[0-9]{2}', pair):
            raise ValueError('invalid ISO time')
        values[index] = int(pair)
        position += 2
        if position == len(text):
            return (*values, 0)
        separator = text[position]
        if index == 0:
            separated = separator == ':'
        # CPython accepts one trailing character before an offset, but
        # rejects that spelling when the time has no timezone suffix.
        if position + 1 == len(text):
            if offset_follows:
                return (*values, 0)
            raise ValueError('trailing ISO time character')
        if separated and separator == ':':
            position += 1
        elif separator in '.,':
            position += 1
            break
        elif separated:
            raise ValueError('inconsistent ISO time separators')
    fraction = text[position:]
    if not re.fullmatch(r'[0-9]+', fraction):
        raise ValueError('invalid ISO fraction')
    micros = int((fraction[:6] + '000000')[:6])
    return (*values, micros)


def parse_iso_datetime(text):
    candidate = text.strip().replace('Z', '+00:00')
    try:
        split = iso_separator(candidate)
        parsed = iso_date(candidate[:split])
        hours, minutes, seconds, micros = 0, 0, 0, 0
        offset = None
        if len(candidate) > split:
            clock = candidate[split + 1:]
            match = re.search(r'[+-]', clock)
            if match:
                index = match.start()
                h, m, s, us = iso_clock(clock[index + 1:])
                whole = h * 3600 + m * 60 + s
                # CPython 3.12 treats an all-zero seconds offset as UTC,
                # including when the spelling contains fractional seconds.
                offset = (whole * 1000000 + us
                          if whole else 0) * (-1 if clock[index] == '-' else 1)
                if not -86400000000 < offset < 86400000000:
                    raise ValueError('UTC offset out of range')
                clock = clock[:index]
            hours, minutes, seconds, micros = iso_clock(
                clock, match is not None)
        value = datetime(parsed.year, parsed.month, parsed.day, hours, minutes,
                         seconds, micros)
        return value, offset
    except (ValueError, OverflowError) as exc:
        raise CellNormalizationError(  # noqa: F821
            f'Invalid ISO date/datetime: {text!r}') from exc


def normalize_utc(parsed, offset):
    try:
        return parsed - timedelta(microseconds=offset)
    except TypeError as exc:
        # Monty reports unsupported operands when the result leaves years
        # 1..9999; CPython's UTC conversion raises an uncaught overflow.
        raise OverflowError('date value out of range') from exc


def normalize_date(text):
    normalized = text.strip()
    if normalized.casefold() in NON_TEXT_NULL_TOKENS:  # noqa: F821
        return NULL_VALUE  # noqa: F821
    parsed, offset = parse_iso_datetime(normalized)
    if offset is not None:
        parsed = normalize_utc(parsed, offset)
    if parsed.time() != time.min:
        raise CellNormalizationError(  # noqa: F821
            f'Expected a date or midnight datetime, got: {text!r}')
    return ('date', parsed.date().isoformat())


def normalize_datetime(text):
    normalized = text.strip()
    if normalized.casefold() in NON_TEXT_NULL_TOKENS:  # noqa: F821
        return NULL_VALUE  # noqa: F821
    parsed, offset = parse_iso_datetime(normalized)
    if offset is not None:
        parsed = normalize_utc(parsed, offset)
    return ('datetime',
            parsed.isoformat() + ('Z' if offset is not None else ''))
