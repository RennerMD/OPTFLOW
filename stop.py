#!/usr/bin/env python3
"""
stop.py — stop all OPTFLOW processes and free ports.

Cross-platform: works on macOS, Linux, and Windows.
Run from the OPTFLOW folder:  python stop.py
"""
import os, sys, signal, subprocess, time, socket
from pathlib import Path

ROOT     = Path(__file__).parent.resolve()
PID_FILE = ROOT / ".optflow.pid"
IS_WIN   = sys.platform == "win32"


def log(msg):
    print(f"[OPTFLOW] {msg}", flush=True)


def port_in_use(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def kill_pid(pid, label):
    try:
        os.kill(pid, signal.SIGTERM)
        log(f"Sent SIGTERM to {label} (pid {pid})")
        time.sleep(0.6)
        try:
            os.kill(pid, 0)   # check still alive
            os.kill(pid, signal.SIGKILL if not IS_WIN else signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass  # already gone
    except (ProcessLookupError, OSError):
        log(f"{label} (pid {pid}) already stopped")


def free_port_posix(port):
    try:
        r = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        for pid in r.stdout.strip().split():
            try:
                os.kill(int(pid), signal.SIGKILL)
                log(f"Killed pid {pid} on :{port}")
            except Exception:
                pass
    except Exception:
        pass


def free_port_windows(port):
    try:
        r = subprocess.run(["netstat", "-aon"], capture_output=True, text=True)
        for line in r.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                if parts:
                    try:
                        subprocess.run(["taskkill", "/F", "/PID", parts[-1]], capture_output=True)
                        log(f"Killed pid {parts[-1]} on :{port}")
                    except Exception:
                        pass
    except Exception:
        pass


def free_port(port):
    if IS_WIN:
        free_port_windows(port)
    else:
        free_port_posix(port)


# Kill via PID file if present
if PID_FILE.exists():
    try:
        pid = int(PID_FILE.read_text().strip())
        kill_pid(pid, "launcher")
        PID_FILE.unlink(missing_ok=True)
    except Exception as e:
        log(f"PID file error: {e}")

# Force-free ports regardless
for port in [8000, 5173]:
    if port_in_use(port):
        log(f"Freeing port {port}...")
        free_port(port)
    else:
        log(f"Port {port} already free")

log("Done. Ports 8000 and 5173 are free.")
