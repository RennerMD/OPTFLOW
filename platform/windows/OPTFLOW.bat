@echo off
title OPTFLOW
color 0A
chcp 65001 >nul 2>&1

:: ══════════════════════════════════════════════════════════════
::  platform\windows\OPTFLOW.bat — Windows one-click launcher
::
::  First time?  Run platform\windows\setup_windows.bat first.
::  Daily use:   Double-click this file.
::  To stop:     Close this window, Ctrl+C, or Stop Session
::               in the sidebar.
:: ══════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

:: Resolve OPTFLOW root (two levels up from platform\windows\)
set "SELF=%~dp0"
for %%A in ("%SELF%..\..") do set "ROOT=%%~fA"
cd /d "%ROOT%"

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
    echo  Install from https://python.org/downloads/
    echo  Check "Add Python to PATH" during install.
    pause & exit /b 1
)

:: ── npm ────────────────────────────────────────────────────────
set "NPM="
for %%c in (npm npm.cmd) do (
    if not defined NPM (
        %%c --version >nul 2>&1
        if !errorlevel! == 0 set "NPM=%%c"
    )
)
if not defined NPM (
    echo  [ERROR] Node.js not found.
    echo  Install from https://nodejs.org/ (LTS version)
    pause & exit /b 1
)

:: ── Auto-install Python packages ──────────────────────────────
%PYTHON% -c "import fastapi" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [SETUP] Installing Python packages...
    %PYTHON% -m pip install --upgrade pip --quiet
    %PYTHON% -m pip install ^
        "fastapi" "uvicorn[standard]" "aiohttp" "websockets" ^
        "python-dotenv" "python-multipart" "requests" "httpx" ^
        "yfinance" "pandas" "numpy" "scipy" "rich" --quiet
    if %errorlevel% neq 0 ( echo  [ERROR] pip install failed. & pause & exit /b 1 )
)

:: ── Auto-install Node packages ─────────────────────────────────
if not exist "%ROOT%\frontend\node_modules" (
    echo  [SETUP] Installing frontend packages...
    cd /d "%ROOT%\frontend"
    %NPM% install --silent
    if %errorlevel% neq 0 ( echo  [ERROR] npm install failed. & pause & exit /b 1 )
    cd /d "%ROOT%"
)

:: ── Create .env if missing ─────────────────────────────────────
if not exist "%ROOT%\.env" (
    copy "%ROOT%\.env.example" "%ROOT%\.env" >nul 2>&1 || (
        echo POLYGON_API_KEY=>  "%ROOT%\.env"
        echo TRADIER_TOKEN=>>   "%ROOT%\.env"
        echo TRADIER_SANDBOX=false>> "%ROOT%\.env"
    )
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
%PYTHON% "%ROOT%\run.py" launch_win

echo.
echo  OPTFLOW has stopped.
pause
