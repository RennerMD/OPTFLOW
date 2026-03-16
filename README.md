# ◈ OPTFLOW — Personal Options Terminal

A personal options trading terminal built with FastAPI + React.
Real-time chains, Greeks, IV analysis, portfolio tracking, and an interactive
strategy builder — all running locally on your machine.

---

## Features

### Data & Pricing
- **Real-time options chains** — bid/ask, Greeks (Δ Γ Θ V), IV, volume, OI
- **Data priority** — Tradier (real-time) → Polygon.io → yfinance (15-min delayed fallback)
- **After-hours pricing** — Tradier bid/ask mid used when market is closed
- **Live spot streaming** — WebSocket updates every 2 seconds per ticker
- **IV Rank** — percentile of current ATM IV vs 52-week historical range

### Portfolio
- **Portfolio tracker** — mark-to-model P&L, cost basis, net Greeks exposure
- **Exit alerts** — 50% profit target, 50% stop, 21 DTE warning, expiration countdown
- **Sortable + filterable positions table** — click any column header to sort; type to filter by ticker/type/direction
- **Inline IV scenario table** — expand any position row to see a price × IV heatmap
- **Robinhood CSV import** — activity export loaded directly via sidebar

### Strategy Analysis (right pane)
- **Strategy ranking** — ranks Long Call/Put, CSP, Covered Call, Iron Condor, Debit Spread vs current IV Rank and DTE
- **Collapsible strategy grid** — click header to collapse when you need more space
- **Recommended strikes** — specific strikes with role labels (ATM, SHORT PUT, LONG CALL etc.), IV, Greeks, and annualised return for credit strategies
- **Editable exit rules** — click any rule to customise; ↺ resets to defaults
- **LAB → button** on each strategy card pre-populates the Builder with all recommended legs

### Options Lab (Builder)
- **POSITIONS view** — all portfolio positions with live scenario P&L; click any row to add to Builder
- **BUILDER view** — unified workspace for real + theoretical legs on one payoff chart
  - Real legs: non-editable, CLOSE? toggle models the exit P&L
  - EXIT ALL / RESTORE ALL bulk controls; CLEAR resets workspace
- **Date slider** — calendar date; each leg computes remaining time independently (correct for multi-expiry positions)
- **Underlying price slider** — ±25%, reference line on chart shows current price
- **IV scenario table** — price × IV heatmap across the full position; base IV from actual leg; step size manually editable
- **Payoff diagram** — Simple (combined P&L) or Multi (per-leg + combined); real = solid, theoretical = dashed
- **Net Greeks** — Δ Γ Θ V and unrealised P&L at current scenario

### Navigation
- **Split pane** — ⊞ SPLIT opens right analysis pane; draggable divider
- **Follow / Pin** — right pane follows left pane's active ticker by default; PIN locks it
- **Back button** — appears in pane header when navigation history exists
- **Persistent sidebar** — views, watchlist, positions, settings (API keys, import, brokers)

### Sidebar
- **Portfolio P&L** — total shown next to Portfolio nav button
- **Live watchlist prices** — WebSocket-updated spot per ticker
- **Settings sub-sections** — API Keys, Portfolio Import, Brokers collapsed under Settings

---

## Data Sources

| Source   | Coverage         | Latency    | Cost               |
|----------|-----------------|------------|--------------------|
| Tradier  | Chains + quotes | Real-time  | Free dev account   |
| Polygon  | Chains + quotes | Real-time  | Starter ~$29/mo    |
| yfinance | Chains + quotes | ~15 min    | Free (fallback)    |

The app tries Tradier first, falls back to Polygon if configured, then yfinance.
Both pane footers show which source the loaded chain used.

---

## Setup

### macOS / Linux
```bash
chmod +x platform/macos/setup.sh
./platform/macos/setup.sh
```
Then double-click `platform/macos/OPTFLOW.command` to launch.

### Windows
Double-click `platform/windows/setup_windows.bat`, then `OPTFLOW.bat`.

### Manual
```bash
pip install -r requirements.txt
cd frontend && npm install && cd ..
python3 run.py launch
```

---

## API Keys

Add to `user_data/.env`:
```
TRADIER_TOKEN=your_token_here      # developer.tradier.com (free)
POLYGON_API_KEY=your_key_here      # polygon.io (Starter for options data)
```

Or enter via sidebar → Settings → API Keys. Takes effect on next chain fetch.

---

## Project Structure

```
OPTFLOW/
├── run.py                  ← single entry point (launch / stop / cli)
├── common/
│   ├── api.py              ← FastAPI app, WebSocket stream, health
│   ├── data_feeds.py       ← Tradier → Polygon → yfinance priority chain
│   ├── options_chain.py    ← Black-Scholes, Greeks, IV solver, yfinance chain
│   ├── tradier.py          ← Tradier adapter (real-time + after-hours)
│   ├── portfolio.py        ← position P&L, exit signals, Greeks aggregation
│   ├── config_routes.py    ← /api/config/* (env + positions read/write)
│   ├── paths.py            ← ROOT, USER_DATA, ENV_FILE, POSITIONS_FILE
│   ├── launch.py           ← macOS/Linux launcher
│   └── launch_windows.py   ← Windows launcher
├── frontend/
│   └── src/App.jsx         ← React dashboard
├── platform/
│   ├── macos/              ← OPTFLOW.command, setup.sh
│   └── windows/            ← OPTFLOW.bat, setup_windows.bat
├── user_data/              ← gitignored
│   ├── .env                ← API keys
│   └── positions.json      ← portfolio positions
├── .env.example
└── verify.sh               ← structure checker (gitignored)
```

---

## Portfolio Import

### Robinhood
1. Account → Statements & History → Export
2. Sidebar → Settings → Portfolio Import → upload CSV → SAVE TO PORTFOLIO

### Manual JSON (`user_data/positions.json`)
```json
[
  {
    "ticker": "SPY",
    "type": "call",
    "direction": "long",
    "strike": 520,
    "expiry": "2025-06-20",
    "contracts": 2,
    "entry_price": 4.50,
    "entry_date": "2025-03-01"
  }
]
```

---

## CLI

```bash
python3 run.py cli chain SPY
python3 run.py cli portfolio
python3 run.py stop
```

---

## Architecture Notes

- All Black-Scholes math runs **client-side in JavaScript** — Builder and IV tables update instantly, zero API calls
- WebSocket stream polls live spots every 2 seconds, reconnects automatically
- `pollStatus` only updates state when values change — no cascade re-renders every 5 seconds
- `PayoffChart` is `React.memo`; `LegRow` and `SliderRow` are stable top-level functions
- `legVer` integer counter replaces `JSON.stringify` as `useMemo` dependency key
