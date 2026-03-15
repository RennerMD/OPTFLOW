@echo off
title OPTFLOW — Setup
color 0B
chcp 65001 >nul 2>&1

:: ══════════════════════════════════════════════════════════════
::  setup_windows.bat — First-time setup for OPTFLOW on Windows
::
::  Run this ONCE before using OPTFLOW.bat.
::  Installs all Python and Node.js dependencies.
::  Requires internet connection.
:: ══════════════════════════════════════════════════════════════

echo.
echo  ==========================================
echo    OPTFLOW  ^|  Windows Setup
echo  ==========================================
echo.
echo  This will install all required dependencies.
echo  Internet connection required (~5 min first run).
echo.
pause

setlocal enabledelayedexpansion
set "DIR=%~dp0"
cd /d "%DIR%"

:: ══════════════════════════════════════════════════════════════
::  STEP 1 — Python
:: ══════════════════════════════════════════════════════════════
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
    echo.
    echo  Please install Python 3.11 or newer:
    echo    1. Open https://python.org/downloads/
    echo    2. Download and run the installer
    echo    3. CHECK the box "Add Python to PATH"
    echo    4. Re-run this setup script
    echo.
    start https://python.org/downloads/
    pause & exit /b 1
)

for /f "tokens=*" %%v in ('%PYTHON% --version 2^>^&1') do set "PY_VER=%%v"
echo  [OK] %PY_VER%

:: Verify it's Python 3
%PYTHON% -c "import sys; sys.exit(0 if sys.version_info.major==3 else 1)" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Found Python 2 — OPTFLOW requires Python 3.
    echo  Install Python 3.11+ from https://python.org/downloads/
    pause & exit /b 1
)

:: ══════════════════════════════════════════════════════════════
::  STEP 2 — Node.js / npm
:: ══════════════════════════════════════════════════════════════
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
    echo.
    echo  Please install Node.js LTS:
    echo    1. Open https://nodejs.org/
    echo    2. Click the LTS download button
    echo    3. Run the installer with default options
    echo    4. Re-run this setup script
    echo.
    start https://nodejs.org/
    pause & exit /b 1
)

for /f "tokens=*" %%v in ('%NPM% --version 2^>^&1') do set "NPM_VER=%%v"
echo  [OK] npm %NPM_VER%

:: ══════════════════════════════════════════════════════════════
::  STEP 3 — Python packages
:: ══════════════════════════════════════════════════════════════
echo.
echo  [3/4] Installing Python packages...

%PYTHON% -m pip install --upgrade pip --quiet

%PYTHON% -m pip install ^
    "fastapi" ^
    "uvicorn[standard]" ^
    "aiohttp" ^
    "websockets" ^
    "python-dotenv" ^
    "python-multipart" ^
    "requests" ^
    "httpx" ^
    "yfinance" ^
    "pandas" ^
    "numpy" ^
    "scipy" ^
    "rich" ^
    --quiet

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Package install failed.
    echo  Check your internet connection and try again.
    pause & exit /b 1
)
echo  [OK] Python packages installed.

:: ══════════════════════════════════════════════════════════════
::  STEP 4 — Frontend (Node) packages
:: ══════════════════════════════════════════════════════════════
echo.
echo  [4/4] Installing frontend packages...

cd /d "%DIR%frontend"
%NPM% install --silent
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed.
    echo  Check your internet connection and try again.
    cd /d "%DIR%"
    pause & exit /b 1
)
cd /d "%DIR%"
echo  [OK] Frontend packages installed.

:: ══════════════════════════════════════════════════════════════
::  Create .env if missing
:: ══════════════════════════════════════════════════════════════
if not exist "%DIR%.env" (
    echo POLYGON_API_KEY=>  "%DIR%.env"
    echo TRADIER_TOKEN=>>   "%DIR%.env"
    echo TRADIER_SANDBOX=false>> "%DIR%.env"
    echo  [OK] Created .env — add API keys via the OPTFLOW sidebar after launch.
) else (
    echo  [OK] .env already exists.
)

:: ══════════════════════════════════════════════════════════════
::  Done
:: ══════════════════════════════════════════════════════════════
echo.
echo  ==========================================
echo    Setup complete!
echo  ==========================================
echo.
echo  To launch OPTFLOW:
echo    Double-click  OPTFLOW.bat
echo.
echo  Or open a terminal in this folder and run:
echo    python launch_windows.py
echo.
echo  Add Tradier / Polygon API keys via the sidebar
echo  after launching (no restart needed for Tradier).
echo.
pause
