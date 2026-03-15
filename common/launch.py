#!/usr/bin/env python3
"""
launch.py — OPTFLOW launcher

Starts uvicorn (port 8000) and Vite (port 5173) as normal child processes.
Both are killed cleanly on exit — ports are always freed.

Stop cleanly:
  Ctrl+C in this terminal      — kills both, frees ports
  Close terminal window        — kills both, frees ports
  Stop Session in panel        — browser navigates away first, then both killed
"""

import subprocess, sys, os, time, signal, threading, webbrowser, socket
from pathlib import Path

API_PORT = 8000
UI_PORT  = 5173
from common.paths import ROOT, PID_FILE
FRONTEND = ROOT / "frontend"

procs = []


def log(msg, color=""):
    codes = {"green":"\033[92m","yellow":"\033[93m","red":"\033[91m",
             "cyan":"\033[96m","bold":"\033[1m"}
    print(f"{codes.get(color,'')}\033[1m[OPTFLOW]\033[0m {msg}\033[0m", flush=True)


def port_in_use(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def free_port(port):
    try:
        r = subprocess.run(["lsof", "-ti", f":{port}"],
                           capture_output=True, text=True)
        for pid in r.stdout.strip().split():
            try:
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass
        if r.stdout.strip():
            time.sleep(0.4)
    except Exception:
        pass


def kill_all(sig=None, frame=None):
    log("Stopping all servers...", "yellow")
    for p in procs:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
        except Exception:
            try: p.terminate()
            except Exception: pass
    # Give processes a moment to exit cleanly
    time.sleep(0.5)
    # Force-free ports regardless
    free_port(API_PORT)
    free_port(UI_PORT)
    PID_FILE.unlink(missing_ok=True)
    log("Stopped. Ports 8000 and 5173 are free.", "green")
    sys.exit(0)


def stream(proc, label, color):
    codes = {"green":"92","cyan":"96","yellow":"93"}
    c = codes.get(color, "0")
    try:
        for line in proc.stdout:
            s = line.rstrip()
            if s:
                print(f"\033[{c}m[{label}]\033[0m {s}", flush=True)
    except Exception:
        pass


def wait_for_port(port, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_in_use(port):
            return True
        time.sleep(0.3)
    return False


def check_deps():
    import importlib.util
    missing = [p for p in ["fastapi","uvicorn","aiohttp","dotenv","httpx"]
               if not importlib.util.find_spec(
                   "dotenv" if p=="dotenv" else p)]
    if missing:
        log(f"Missing packages: {', '.join(missing)}", "red")
        log("Run: pip3 install " + " ".join(missing) + " --break-system-packages", "yellow")
        sys.exit(1)
    if not (FRONTEND / "node_modules").exists():
        log("Installing frontend dependencies...", "yellow")
        subprocess.run(["npm", "install", "--silent"], cwd=FRONTEND, check=True)


def start_api():
    log("Starting API on :8000", "cyan")
    p = subprocess.Popen(
        ["python3", "-m", "uvicorn", "run:app",
         "--host", "127.0.0.1", "--port", str(API_PORT), "--log-level", "warning"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, preexec_fn=os.setsid,
    )
    procs.append(p)
    threading.Thread(target=stream, args=(p,"API","cyan"), daemon=True).start()
    return p


def start_ui():
    log("Starting dashboard on :5173", "green")
    p = subprocess.Popen(
        ["npm", "run", "dev", "--", "--host"],
        cwd=FRONTEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, preexec_fn=os.setsid,
    )
    procs.append(p)
    threading.Thread(target=stream, args=(p,"UI ","green"), daemon=True).start()
    return p


def main():
    signal.signal(signal.SIGINT,  kill_all)
    signal.signal(signal.SIGTERM, kill_all)
    signal.signal(signal.SIGHUP,  kill_all)  # terminal close → clean shutdown

    log("OPTFLOW", "bold")
    check_deps()

    # Free ports before starting
    if port_in_use(API_PORT):
        log(f"Freeing port {API_PORT}...", "yellow")
        free_port(API_PORT)
    if port_in_use(UI_PORT):
        log(f"Freeing port {UI_PORT}...", "yellow")
        free_port(UI_PORT)

    api = start_api()
    ui  = start_ui()

    if not wait_for_port(API_PORT, 15):
        log("API failed to start", "red"); kill_all()
    if not wait_for_port(UI_PORT, 30):
        log("Dashboard failed to start", "red"); kill_all()

    # Write PID so shutdown endpoint can signal this process
    PID_FILE.write_text(str(os.getpid()))

    log("Ready ✓", "green")
    log(f"Panel:     http://127.0.0.1:{API_PORT}", "cyan")
    log(f"Dashboard: http://127.0.0.1:{UI_PORT}", "green")
    log("Ctrl+C or close terminal to stop.", "yellow")

    time.sleep(0.5)
    webbrowser.open(f"http://127.0.0.1:{UI_PORT}")

    # Monitor — if either process dies, clean up
    while True:
        if api.poll() is not None:
            if not PID_FILE.exists():
                log("Clean shutdown complete", "green")
            else:
                log("API exited unexpectedly", "red")
            kill_all()
        if ui.poll() is not None:
            log("Dashboard exited", "yellow")
            procs.remove(ui)
            break
        time.sleep(1)

    log("Dashboard stopped. Panel still at http://127.0.0.1:8000", "yellow")
    # Keep API alive, just wait
    api.wait()
    kill_all()


if __name__ == "__main__":
    main()
