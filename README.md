# Platform Launchers

Platform-specific launch and setup scripts. All core application code lives in the project root.

## macOS

| File | Purpose |
|---|---|
| `macos/setup.sh` | First-time setup — installs Homebrew, Node.js, Python packages, npm deps |
| `macos/OPTFLOW.command` | Double-click launcher — frees ports, runs `launch.py` |

```zsh
# First time
chmod +x platform/macos/setup.sh && ./platform/macos/setup.sh

# Daily use — double-click platform/macos/OPTFLOW.command
# or from terminal:
python3 launch.py
```

## Windows

| File | Purpose |
|---|---|
| `windows/setup_windows.bat` | First-time setup — installs Python packages, npm deps, creates .env |
| `windows/OPTFLOW.bat` | Double-click launcher — auto-installs if needed, frees ports, runs `launch_windows.py` |

```
First time:  double-click platform\windows\setup_windows.bat
Daily use:   double-click platform\windows\OPTFLOW.bat
```

## Common launchers (project root)

| File | Purpose |
|---|---|
| `launch.py` | macOS/Linux Python launcher |
| `launch_windows.py` | Windows Python launcher |
| `stop.py` | Cross-platform clean shutdown |
| `sync.sh` | Post-session GitHub sync |
