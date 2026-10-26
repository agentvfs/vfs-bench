"""Freeze python3's clock in the workspace at a Gaia2 scenario's start.

Upstream runs its container under libfaketime, so every program in it
reads the scenario's time. Here the apps get it from ``launch.py`` and the
shell's ``date`` from a function (``index.ts``); this does the same for
python3. Pyodide runs it before each python3 command, as the runtime's
``bootstrap_code``, followed by ``freeze(<start>)``. Durations
(``time.monotonic``, ``time.perf_counter``) still run.
"""


def freeze(instant: float) -> None:
    """Make ``time`` and ``datetime`` read ``instant``, a POSIX timestamp.

    Args:
        instant (float): the scenario's start.
    """
    import datetime
    import time

    real_date, real_datetime = datetime.date, datetime.datetime
    localtime, gmtime, strftime = time.localtime, time.gmtime, time.strftime

    # A real date or datetime still passes isinstance against the stand-ins.
    class DateMeta(type):

        def __instancecheck__(cls, obj):
            return isinstance(obj, real_date)

    class DateTimeMeta(type):

        def __instancecheck__(cls, obj):
            return isinstance(obj, real_datetime)

    class Date(real_date, metaclass=DateMeta):

        @classmethod
        def today(cls):
            return cls.fromtimestamp(instant)

    class DateTime(real_datetime, metaclass=DateTimeMeta):

        @classmethod
        def now(cls, tz=None):
            return cls.fromtimestamp(instant, tz)

        @classmethod
        def today(cls):
            return cls.fromtimestamp(instant)

        @classmethod
        def utcnow(cls):
            utc = cls.fromtimestamp(instant, datetime.UTC)
            return utc.replace(tzinfo=None)

    def at(secs):
        return instant if secs is None else secs

    datetime.date, datetime.datetime = Date, DateTime
    time.time = lambda: instant
    time.time_ns = lambda: int(instant * 1_000_000_000)
    time.localtime = lambda secs=None: localtime(at(secs))
    time.gmtime = lambda secs=None: gmtime(at(secs))
    time.ctime = lambda secs=None: time.asctime(localtime(at(secs)))
    time.strftime = lambda format, t=None: strftime(
        format,
        localtime(instant) if t is None else t)
