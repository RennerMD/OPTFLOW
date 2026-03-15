"""
paths.py — canonical directory paths for OPTFLOW.
Import this everywhere instead of computing Path(__file__).parent manually.

    from common.paths import ROOT, USER_DATA, ENV_FILE, POSITIONS_FILE
"""
from pathlib import Path

# Project root — always the directory containing this package
ROOT = Path(__file__).parent.parent.resolve()

# User data — gitignored, contains .env, positions.json, any personal files
USER_DATA = ROOT / "user_data"
USER_DATA.mkdir(exist_ok=True)   # create on first import if missing

# Convenience aliases for the two most-referenced user files
ENV_FILE       = USER_DATA / ".env"
POSITIONS_FILE = USER_DATA / "positions.json"
PID_FILE       = ROOT / ".optflow.pid"
