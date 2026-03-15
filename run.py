#!/usr/bin/env python3
"""
run.py — OPTFLOW unified entry point

Usage:
    python3 run.py launch                   # start servers (macOS/Linux)
    python3 run.py launch_win               # start servers (Windows)
    python3 run.py stop                     # clean shutdown
    python3 run.py cli chain SPY            # options chain
    python3 run.py cli portfolio            # portfolio P&L

Uvicorn:
    uvicorn run:app --port 8000             # API server

Platform launchers call this automatically — no need to run directly.
"""

import sys

# ── Uvicorn app export (used by: uvicorn run:app) ──────────────
from common.api import app  # noqa: F401

# ── CLI dispatch ───────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd, rest = sys.argv[1], sys.argv[2:]

    if cmd == "launch":
        from common.launch import main
        main()

    elif cmd == "launch_win":
        from common.launch_windows import main
        main()

    elif cmd == "stop":
        import runpy
        from pathlib import Path
        runpy.run_path(
            str(Path(__file__).parent / "common" / "stop.py"),
            run_name="__main__"
        )

    elif cmd == "cli":
        sys.argv = ["cli"] + rest   # re-form argv for argparse
        from common.cli import main
        main()

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)
