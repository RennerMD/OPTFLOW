# ◈ OPTFLOW — Options Terminal

A personal options trading terminal built with FastAPI + React.
Real-time options chains, Greeks, IV rank, portfolio tracking, and strategy analysis.

---

## Features

- **Real-time options chains** — bid/ask, Greeks (Δ Γ Θ V ρ), IV, volume, OI
- **IV Rank** — percentile of current IV vs 52-week historical volatility
- **Strategy optimizer** — ranks Long Call/Put, CSP, Covered Call, Iron Condor, Debit Spread against current conditions
- **Portfolio tracker** — mark-to-model P&L, exit targets (50% profit / 50% stop), Greeks exposure, DTE alerts
- **Split pane** — two independent workspaces side by side with draggable divider
- **Persistent sidebar** — navigation, watchlist, positions, API keys, portfolio import, settings — all in one place
- **Robinhood CSV import** — drag-and-drop activity export directly into the sidebar
- **Cross-platform** — macOS and Windows launchers included
- **Clean shutdown** — browser navigates to goodbye page before servers stop; Firefox stays open

---

## Quick Start

### macOS

```zsh
# One-time setup
chmod +x setup.sh && ./setup.sh

# Daily launch — double-click OPTFLOW.command in Finder, or:
python3 launch.py
```

### Windows

```
# One-time setup — double-click:
setup_windows.bat

# Daily launch — double-click:
OPTFLOW.bat
```

The dashboard opens at `http://127.0.0.1:5173`.
The API runs at `http://127.0.0.1:8000`.

---

## Requirements

| Dependency | Version |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ LTS |
| npm | 9+ (bundled with Node.js) |

Python packages installed automatically by setup scripts:
```
fastapi  uvicorn[standard]  aiohttp  websockets
python-dotenv  python-multipart  requests  httpx
yfinance  pandas  numpy  scipy  rich
```

---

## Data Sources

| Source | Options chain | Real-time | Setup |
|---|---|---|---|
| **Tradier** (recommended) | Full bid/ask | Yes | Free at [developer.tradier.com](https://developer.tradier.com) |
| **Polygon.io** | Requires Starter ($29/mo) | Yes | [polygon.io](https://polygon.io) |
| **yfinance** | Poor quality | No (15-min delay) | No key needed (automatic fallback) |

Add keys via the sidebar → **API KEYS** section after launching.

---

## Project Structure

```
OPTFLOW/
├── api.py                # FastAPI backend — all endpoints
├── config_routes.py      # /api/config/* — .env, portfolio file, README
├── data_feeds.py         # Source priority routing: Tradier > Polygon > yfinance
├── options_chain.py      # Black-Scholes, Greeks, IV solver, IV Rank, yfinance chain
├── tradier.py            # Tradier API adapter
├── portfolio.py          # Position mark-to-model, P&L, exit signals
├── launch.py             # macOS/Linux launcher
├── launch_windows.py     # Windows launcher
├── stop.py               # Cross-platform clean shutdown script
├── OPTFLOW.command       # macOS double-click launcher
├── OPTFLOW.bat           # Windows double-click launcher
├── setup.sh              # macOS first-time setup
├── setup_windows.bat     # Windows first-time setup
├── .env                  # API keys — NOT committed
├── positions.json        # Portfolio positions — NOT committed
└── frontend/
    ├── src/App.jsx        # Full React dashboard
    ├── vite.config.js     # Dev server + API proxy
    └── package.json
```

---

## API Reference

```
GET   /api/chain/{ticker}          Options chain (expiry, Greeks, signals)
GET   /api/chain/{ticker}/expiries Available expiry dates
GET   /api/spot/{ticker}           Current spot price
GET   /api/portfolio               Portfolio P&L, Greeks, alerts
GET   /api/iv-history/{ticker}     60-day historical volatility
GET   /api/health                  Server + data source status
POST  /api/shutdown                Clean shutdown (serves goodbye page first)
WS    /ws/stream?tickers=SPY,QQQ   Live spot price stream

GET   /api/config/env              Read .env keys
POST  /api/config/env              Write .env keys
GET   /api/config/portfolio        Read positions.json
POST  /api/config/portfolio        Write positions.json
GET   /api/config/readme           Read README.md
POST  /api/config/readme           Write README.md
```

---

## Portfolio Import

**From Robinhood:**
1. Account → Statements & History → Download CSV
2. Drag the file into the sidebar → PORTFOLIO IMPORT

**Supported formats:**
- Robinhood activity CSV (detected automatically via `Trans Code` column)
- Generic CSV: `ticker, type, strike, expiry, contracts, entry_price, entry_date, direction`
- JSON array of position objects

---

## Stopping

| Method | Effect |
|---|---|
| Sidebar → **■ STOP SESSION** | Browser redirects to goodbye page, then both servers stop |
| **Ctrl+C** in terminal | Both servers stop immediately, ports freed |
| Close terminal window | Both servers stop, ports freed |
| `python stop.py` | Force-stop from any terminal |

---

## Syncing Changes

This project is developed with Claude (Anthropic). After each session, changes are committed here.

```zsh
# Pull latest
git pull origin main

# Push local changes
git add -A
git commit -m "brief description of change"
git push
```

---

## Disclaimer

OPTFLOW is a personal research tool, not financial advice.
Options trading involves significant risk. Verify all data independently before trading.
Data provider terms of service apply (Tradier, Polygon.io, Yahoo Finance).
