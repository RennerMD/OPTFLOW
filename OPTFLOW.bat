@echo off
title OPTFLOW
color 0A
chcp 65001 >nul 2>&1

:: ══════════════════════════════════════════════════════════════
::  OPTFLOW.bat — one-click launcher for Windows
::
::  First time?  Run setup_windows.bat first (installs Python
::  packages and Node dependencies automatically).
::
::  Daily use:   Just double-click this file.
::
::  To stop:     Close this window, or press Ctrl+C,
::               or use Stop Session in the sidebar.
:: ══════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion
set "DIR=%~dp0"
cd /d "%DIR%"

echo.
echo  ==========================================
echo    OPTFLOW  ^|  Options Terminal
echo  ==========================================
echo.

:: ── Python ────────────────────────────────────────────────────
set "PYTHON="
for %%c in (python python3 py) do (
    if not defined PYTHON (
        %%c --version >nul 2>&1
        if !errorlevel! == 0 set "PYTHON=%%c"
    )
)
if not defined PYTHON (
    echo  [ERROR] Python 3 not found.
    echo.
    echo  Install from:  https://python.org/downloads/
    echo  During setup:  check "Add Python to PATH"
    echo.
    echo  Then re-run this file.
    pause & exit /b 1
)

:: ── Node / npm ─────────────────────────────────────────────────
set "NPM="
for %%c in (npm npm.cmd) do (
    if not defined NPM (
        %%c --version >nul 2>&1
        if !errorlevel! == 0 set "NPM=%%c"
    )
)
if not defined NPM (
    echo  [ERROR] Node.js not found.
    echo.
    echo  Install from:  https://nodejs.org/  (choose LTS)
    echo  Use default options during install.
    echo.
    echo  Then re-run this file.
    pause & exit /b 1
)

:: ── Auto-install Python packages if missing ────────────────────
%PYTHON% -c "import fastapi" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [SETUP] Installing Python packages (one-time, ~2 min)...
    %PYTHON% -m pip install --upgrade pip --quiet
    %PYTHON% -m pip install ^
        "fastapi" "uvicorn[standard]" "aiohttp" "websockets" ^
        "python-dotenv" "python-multipart" "requests" "httpx" ^
        "yfinance" "pandas" "numpy" "scipy" "rich" ^
        --quiet
    if %errorlevel% neq 0 (
        echo  [ERROR] pip install failed.
        echo  Check internet connection and try again.
        pause & exit /b 1
    )
    echo  [OK] Python packages ready.
)

:: ── Auto-install Node packages if missing ─────────────────────
if not exist "%DIR%frontend\node_modules" (
    echo  [SETUP] Installing frontend packages (one-time, ~1 min)...
    cd /d "%DIR%frontend"
    %NPM% install --silent
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install failed.
        pause & exit /b 1
    )
    cd /d "%DIR%"
    echo  [OK] Frontend packages ready.
)

:: ── Create .env if missing ─────────────────────────────────────
if not exist "%DIR%.env" (
    echo POLYGON_API_KEY=>  "%DIR%.env"
    echo TRADIER_TOKEN=>>   "%DIR%.env"
    echo TRADIER_SANDBOX=false>> "%DIR%.env"
    echo  [OK] Created .env — add API keys via the sidebar after launch.
)

:: ── Free ports ─────────────────────────────────────────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr " :8000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr " :5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ── Launch ─────────────────────────────────────────────────────
echo  [INFO] Starting OPTFLOW...
echo.
%PYTHON% launch_windows.py

:: ── Landed here = Python exited ────────────────────────────────
echo.
echo  OPTFLOW has stopped.
pause
