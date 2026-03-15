@echo off
title OPTFLOW — Setup
color 0B
chcp 65001 >nul 2>&1

:: ══════════════════════════════════════════════════════════════
::  platform\windows\setup_windows.bat — First-time setup
::  Run this ONCE before using OPTFLOW.bat.
:: ══════════════════════════════════════════════════════════════

echo.
echo  ==========================================
echo    OPTFLOW  ^|  Windows Setup
echo  ==========================================
echo.
echo  Installs all dependencies (~5 min, internet required).
echo.
pause

setlocal enabledelayedexpansion
set "SELF=%~dp0"
for %%A in ("%SELF%..\..") do set "ROOT=%%~fA"
cd /d "%ROOT%"

:: ── Step 1: Python ─────────────────────────────────────────────
echo.
echo  [1/4] Checking Python...
set "PYTHON="
for %%c in (python python3 py) do (
    if not defined PYTHON (
        %%c --version >nul 2>&1
        if !errorlevel! == 0 set "PYTHON=%%c"
    )
)
if not defined PYTHON (
    echo.
    echo  [!] Python 3 not found.
    echo  1. Open https://python.org/downloads/
    echo  2. Download Python 3.11 or newer
    echo  3. CHECK "Add Python to PATH" during install
    echo  4. Re-run this script
    echo.
    start https://python.org/downloads/
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('%PYTHON% --version 2^>^&1') do set "PY_VER=%%v"
echo  [OK] %PY_VER%

:: ── Step 2: Node.js ────────────────────────────────────────────
echo.
echo  [2/4] Checking Node.js...
set "NPM="
for %%c in (npm npm.cmd) do (
    if not defined NPM (
        %%c --version >nul 2>&1
        if !errorlevel! == 0 set "NPM=%%c"
    )
)
if not defined NPM (
    echo.
    echo  [!] Node.js not found.
    echo  1. Open https://nodejs.org/
    echo  2. Download the LTS version
    echo  3. Install with default options
    echo  4. Re-run this script
    echo.
    start https://nodejs.org/
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('%NPM% --version 2^>^&1') do set "NPM_VER=%%v"
echo  [OK] npm %NPM_VER%

:: ── Step 3: Python packages ────────────────────────────────────
echo.
echo  [3/4] Installing Python packages...
%PYTHON% -m pip install --upgrade pip --quiet
%PYTHON% -m pip install ^
    "fastapi" "uvicorn[standard]" "aiohttp" "websockets" ^
    "python-dotenv" "python-multipart" "requests" "httpx" ^
    "yfinance" "pandas" "numpy" "scipy" "rich" --quiet
if %errorlevel% neq 0 (
    echo  [ERROR] pip install failed. Check internet connection.
    pause & exit /b 1
)
echo  [OK] Python packages installed.

:: ── Step 4: Frontend packages ──────────────────────────────────
echo.
echo  [4/4] Installing frontend packages...
cd /d "%ROOT%\frontend"
%NPM% install --silent
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed. Check internet connection.
    cd /d "%ROOT%"
    pause & exit /b 1
)
cd /d "%ROOT%"
echo  [OK] Frontend packages installed.

:: ── Create .env ────────────────────────────────────────────────
if not exist "%ROOT%\.env" (
    copy "%ROOT%\.env.example" "%ROOT%\.env" >nul 2>&1 || (
        echo POLYGON_API_KEY=>  "%ROOT%\.env"
        echo TRADIER_TOKEN=>>   "%ROOT%\.env"
        echo TRADIER_SANDBOX=false>> "%ROOT%\.env"
    )
    echo  [OK] Created .env
) else (
    echo  [OK] .env already exists
)

:: ── Done ───────────────────────────────────────────────────────
echo.
echo  ==========================================
echo    Setup complete!
echo  ==========================================
echo.
echo  To launch: double-click platform\windows\OPTFLOW.bat
echo.
echo  Add API keys via the sidebar after launching.
echo.
pause
