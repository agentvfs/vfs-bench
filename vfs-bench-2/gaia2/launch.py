"""Run one gaia2-cli app command on the scenario's clock.

    python -I gaia2/launch.py <module:attr> <prog> [args...]

Upstream runs each command under libfaketime at the scenario's simulated
time; here ``time.time``, which the apps read for "now", is fixed at
``GAIA2_SIM_TIME`` before the app is imported.
"""
import importlib
import os
import sys
import time

now = float(os.environ["GAIA2_SIM_TIME"])
time.time = lambda: now

module, _, attr = sys.argv[1].partition(":")
cli = getattr(importlib.import_module(module), attr)
cli.main(args=sys.argv[3:], prog_name=sys.argv[2])
