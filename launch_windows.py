#!/usr/bin/env python3
"""
launch_windows.py — OPTFLOW launcher for Windows
Double-click OPTFLOW.bat to run, or: python launch_windows.py

Both servers (uvicorn API + Vite dashboard) run as child processes.
Closing the terminal window or Ctrl+C kills both and frees all ports.

Stop cleanly:
  Ctrl+C in this window          — kills both, frees ports
  Close this window              — kills both, frees ports
  Stop Session in the sidebar    — browser navigates to goodbye page,
                                   then both servers stop
"""

import subprocess, sys, os, time, signal, threading, webbrowser, socket, importlib.util
from pathlib import Path

ROOT     = Path(__file__).parent.resolve()
FRONTEND = ROOT / "frontend"
API_PORT = 8000
UI_PORT  = 5173
PID_FILE = ROOT / ".optflow.pid"

# Windows flag: keep process in its own group so Ctrl+Break can target it
CREATE_NEW_PROCESS_GROUP = 0x00000200

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
    """Kill whatever is holding a port using netstat + taskkill."""
    try:
        r = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True
        )
        pids = set()
        for line in r.stdout.splitlines():
            # Match lines like:  TCP  0.0.0.0:8000  0.0.0.0:0  LISTENING  1234
            if f":{port}" in line and "LISTENING" in line:
                parts = line.strip().split()
                if parts:
                    try:
                        pid = int(parts[-1])
                        if pid > 0:
                            pids.add(pid)
                    except ValueError:
                        pass
        for pid in pids:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                           capture_output=True)
            log(f"Freed port {port} (pid {pid})", "yellow")
        if pids:
            time.sleep(0.4)
    except Exception:
        pass


def kill_all(sig=None, frame=None):
    log("Stopping all servers...", "yellow")
    for p in procs:
        try:
            # Windows: send Ctrl+Break to process group, then force kill
            p.send_signal(signal.CTRL_BREAK_EVENT)
            time.sleep(0.2)
        except Exception:
            pass
        try:
            p.terminate()
        except Exception:
            pass
    time.sleep(0.5)
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


def find_python():
    """Find a working Python 3 executable."""
    for cmd in ["python", "python3", "py"]:
        try:
            r = subprocess.run([cmd, "--version"], capture_output=True, text=True)
            if r.returncode == 0 and "3." in (r.stdout + r.stderr):
                return cmd
        except FileNotFoundError:
            continue
    return None


def find_npm():
    """Find npm (Windows may use npm.cmd)."""
    for cmd in ["npm", "npm.cmd"]:
        try:
            r = subprocess.run([cmd, "--version"], capture_output=True, text=True)
            if r.returncode == 0:
                return cmd
        except FileNotFoundError:
            continue
    return None


def check_deps(python, npm):
    missing = [p for p in ["fastapi","uvicorn","aiohttp","dotenv","httpx"]
               if not importlib.util.find_spec("dotenv" if p=="dotenv" else p)]
    if missing:
        log(f"Installing missing packages: {', '.join(missing)}", "yellow")
        subprocess.run([python, "-m", "pip", "install", "--quiet"] + missing, check=True)

    if not (FRONTEND / "node_modules").exists():
        log("Installing frontend dependencies (first run)...", "yellow")
        subprocess.run([npm, "install", "--silent"], cwd=FRONTEND, check=True)
        log("Frontend dependencies installed.", "green")


def main():
    # Enable ANSI colour codes in Windows Terminal / cmd
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

    signal.signal(signal.SIGINT,  kill_all)
    signal.signal(signal.SIGTERM, kill_all)
    # Note: SIGBREAK (window close) is not reliably trappable on Windows.
    # The CREATE_NEW_PROCESS_GROUP flag ensures child processes receive
    # CTRL_BREAK when the console window closes.

    log("OPTFLOW (Windows)", "bold")

    python = find_python()
    npm    = find_npm()

    if not python:
        log("Python 3 not found.", "red")
        log("Download from https://python.org/downloads/", "yellow")
        log("Check 'Add Python to PATH' during install.", "yellow")
        input("Press Enter to exit...")
        sys.exit(1)

    if not npm:
        log("Node.js / npm not found.", "red")
        log("Download from https://nodejs.org/ (LTS version)", "yellow")
        input("Press Enter to exit...")
        sys.exit(1)

    check_deps(python, npm)

    # Free ports before starting
    for port in [API_PORT, UI_PORT]:
        if port_in_use(port):
            log(f"Freeing port {port}...", "yellow")
            free_port(port)

    # Start API
    log("Starting API on :8000", "cyan")
    api = subprocess.Popen(
        [python, "-m", "uvicorn", "api:app",
         "--host", "127.0.0.1", "--port", str(API_PORT), "--log-level", "warning"],
        cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
        creationflags=CREATE_NEW_PROCESS_GROUP,
    )
    procs.append(api)
    threading.Thread(target=stream, args=(api,"API","cyan"), daemon=True).start()

    # Start Vite
    log("Starting dashboard on :5173", "green")
    ui = subprocess.Popen(
        [npm, "run", "dev", "--", "--host"],
        cwd=FRONTEND,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
        creationflags=CREATE_NEW_PROCESS_GROUP,
    )
    procs.append(ui)
    threading.Thread(target=stream, args=(ui,"UI ","green"), daemon=True).start()

    if not wait_for_port(API_PORT, 20):
        log("API failed to start — check output above", "red")
        kill_all()

    if not wait_for_port(UI_PORT, 40):
        log("Dashboard failed to start — check output above", "red")
        kill_all()

    # Write PID so /api/shutdown can signal this process
    PID_FILE.write_text(str(os.getpid()))

    log("Ready \u2713", "green")
    log(f"Dashboard: http://127.0.0.1:{UI_PORT}", "green")
    log("Close this window or press Ctrl+C to stop.", "yellow")

    time.sleep(0.5)
    webbrowser.open(f"http://127.0.0.1:{UI_PORT}")

    # Monitor
    while True:
        if api.poll() is not None:
            if not PID_FILE.exists():
                log("Clean shutdown complete.", "green")
            else:
                log("API exited unexpectedly.", "red")
            kill_all()
        if ui.poll() is not None:
            log("Dashboard stopped.", "yellow")
            procs.remove(ui)
            break
        time.sleep(1)

    log("Dashboard stopped. Waiting for API to exit...", "yellow")
    api.wait()
    kill_all()


if __name__ == "__main__":
    main()
