# ◈ OPTFLOW — Personal Options Terminal

A personal options trading terminal built with FastAPI + React.
Real-time chains, Greeks, IV analysis, portfolio tracking, and an interactive
strategy builder — all running locally on your machine.

---

## Quick Start

### macOS / Linux
```bash
chmod +x platform/macos/setup.sh && ./platform/macos/setup.sh
```
Then double-click `platform/macos/OPTFLOW.command`.

### Windows
Double-click `platform/windows/setup_windows.bat`, then `OPTFLOW.bat`.

### Manual
```bash
pip install -r requirements.txt
cd frontend && npm install && cd ..
python3 run.py launch
```

Opens at `http://127.0.0.1:5173`

---

## Layout

```
┌─ Sidebar ──────┬──── Left Pane ───────────┬── Right Pane (⊞ SPLIT) ──┐
│ ▤ Portfolio    │ ▤ Portfolio view          │ ⊕ Builder                │
│ ◫ Chain        │   + buttons → Builder     │   Real + theoretical legs │
│ ◆ Strategy/Lab │   Sortable table          │   Scenario sliders        │
│                │   Inline IV table (▸)     │   Net Greeks              │
│ Watchlist      │                           │   IV Scenario Table       │
│ Positions      │ ◫ Chain view              │   Payoff chart            │
│ Settings       │   Chain table + LAB col   │                           │
│                │   Positions for ticker    │ ◆ Strategy panel          │
│                │   Vol chart (HV vs IV)    │   Collapsible ranking     │
└────────────────┴───────────────────────────┴──────────────────────────┘
```

---

## Left Pane

### Portfolio View (`▤`)
Displays all imported positions.

- **Sortable columns** — click any header (TICKER, SIDE, STRIKE, EXPIRY, DTE, P&L, P&L%, Δ, Θ, IV) to sort ascending/descending
- **Filter bar** — type to filter by ticker, type, or direction
- **`+` button** (first column) — adds that position to the right-pane Builder and navigates to that ticker's chain view. Multiple `+` clicks accumulate legs sequentially; duplicates are filtered
- **`↗` button** — opens the chain for that ticker without adding to Builder
- **▸ expand** (click ticker name) — expands an inline IV Scenario Table showing P&L across price × IV shift for that single position
- **Summary bar** — account value, total P&L, net Δ/Θ/V, cost basis
- **Exit alerts and DTE warnings** — flagged at 45d and 21d

### Chain View (`◫`)
Options chain for the active ticker tab.

- **Ticker tabs** — multiple tickers open simultaneously; tabs show live price and an `AH` badge after hours
- **IV RANK** gauge + numeric value; **ATM IV** labelled alongside
- **Live spot** with after-hours context: `$663.08  AH +0.12%  close $662.29`
- **`+` button** on each chain row — opens the right-pane Builder with that strike; click multiple rows to build multi-leg positions
- **CALLS / PUTS** toggle; expiry selector with DTE badge
- **Positions section** — below the chain, all positions held in this ticker appear in the same table format with their own `+` buttons. Shows "no positions held" if none.
- **Vol chart** — below positions (see below)

### Vol Chart
Toggleable series showing volatility context for the active ticker.

| Series | Default | Description |
|--------|---------|-------------|
| HV 20d | ✓ on | 20-day rolling realised vol (annualised) |
| HV 30d | off | 30-day rolling realised vol — smoother |
| HV Rank | off | Rolling percentile of HV vs 252-day range |
| Price | off | Closing price on secondary axis |
| Vol Prem | ✓ on | ATM IV − HV 20d (the vol premium) |

The amber dashed **ATM IV** reference line is always visible. The header shows:
- `ATM IV 23.9%` — current implied vol
- `▲ IV rich +3.2%` (red) or `▼ IV cheap −2.1%` (green) — vol premium signal, calculated as `ATM IV − HV(20d)`, labelled clearly

---

## Right Pane (⊞ SPLIT to open)

Open via the ⊞ button in the top bar, or click **◆ STRATEGY / LAB** in the sidebar.

### Header
Shows: `TICKER  $price  AH ±pct%  close $X  |  IV Rank N  ·  Nd  ·  ATM IV N%`

All fields labelled. AH data appears immediately on chain load (not waiting for WebSocket).

### Strategy Panel (collapsible ▾)
Ranks 6 strategies against current IV Rank and DTE:
- Long Call, Long Put, Cash-Secured Put, Covered Call, Iron Condor, Debit Spread
- Each card shows signal (BUY / SELL / NEUTRAL / AVOID / WATCH), a score bar, and a **LAB →** button
- Clicking a card shows: description, entry rule, editable exit rules (click any rule to edit, ↺ to reset), recommended strikes table with ROLE labels, IV, Greeks, and annualised return for credit strategies
- The grid is collapsible; strategy detail and strikes collapse with it

### Builder (`⊕`)
Always-visible multi-leg workspace.

**Adding legs:**
- Portfolio `+` → appends the real position (sequential, deduped)
- Chain `+` → replaces with that single strike
- `+ LEG` → adds a blank theoretical leg
- `LAB →` on strategy cards → seeds with all recommended legs

**Leg types:**
- **Real legs** (green/red border) — from your portfolio; non-editable; CLOSE? toggle models exit P&L
- **Theoretical legs** (coloured by index) — fully editable strike, IV, type, qty, expiry

**Ticker isolation:** switching tickers clears the Builder of legs from the previous ticker. Real legs for the new ticker are preserved.

**Controls (EXIT ALL / RESTORE / CLEAR)** appear contextually based on leg state.

**Scenario panel:**
| Control | Range | Effect |
|---------|-------|--------|
| UNDERLYING slider | ±25% | Shifts spot for all calculations |
| IV SHIFT slider | ±30% | Shifts all leg IVs simultaneously |
| DATE picker | today → furthest expiry | Each leg computes remaining time independently |
| ↺ reset | — | Appears when any value is non-default; resets all three |

**Panels (top to bottom):**
1. Scenario sliders
2. Net Greeks (Δ Γ Θ V) + P&L Now + Trade Stats (max profit/loss, breakevens)
3. IV Scenario Table
4. Payoff chart (Simple or Multi mode)

### IV Scenario Table
Price × IV shift heatmap showing P&L or VALUE across the full position.

- **Base IV** derived from the first leg's actual IV
- **IV step** — default 1% per column, 9 columns (±4 steps). Click `1%` to edit
- **Price step** — default 1% per row, 15 rows (±7 steps). Click `1%` to edit
- Toggle **P&L** / **VALUE** mode
- Current spot row highlighted with ◀; current IV column labelled `now`
- Colour intensity scales with magnitude (green = profit, red = loss)

---

## Data Sources

| Source | Chains | Regular hours | After hours | Cost |
|--------|--------|---------------|-------------|------|
| Tradier | ✓ real-time | ✓ real-time | ✗ dev account | Free dev |
| Polygon | ✓ real-time | ✓ real-time | — | Starter ~$29/mo |
| yfinance | ✓ 15-min delay | ✓ | ✓ post/pre market | Free |

**Priority:** Tradier → Polygon → yfinance

**After-hours:** Tradier dev accounts return `bid=ask=0` outside regular hours. The app automatically calls yfinance `postMarketPrice` / `preMarketPrice` as a supplement. For most accurate AH prices set `PRICE_SOURCE=yfinance` in the sidebar.

**Price source selector:** Sidebar → Settings → API Keys → PRICE SOURCE buttons:
`AUTO` (default) / `TRADIER` / `POLYGON` / `YFINANCE`

**Sandbox warning:** If `TRADIER_SANDBOX=true` in `.env`, prices are simulated. The sidebar shows a `SANDBOX` badge.

---

## API Keys

Add to `user_data/.env`, or enter via Sidebar → Settings → API Keys:

```
TRADIER_TOKEN=your_token        # developer.tradier.com (free)
TRADIER_SANDBOX=false           # true = simulated prices, false = live
POLYGON_API_KEY=your_key        # polygon.io Starter for options
PRICE_SOURCE=auto               # auto | tradier | polygon | yfinance
```

Keys take effect on next chain fetch (no restart needed for price source).

---

## Portfolio Import

### Robinhood CSV
Sidebar → Settings → Portfolio Import → upload CSV → SAVE

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

## Project Structure

```
OPTFLOW/
├── run.py                    ← launch / stop / cli
├── common/
│   ├── api.py                ← FastAPI, WebSocket, health, price-source endpoints
│   ├── data_feeds.py         ← Tradier → Polygon → yfinance + AH enrichment
│   ├── options_chain.py      ← Black-Scholes, Greeks, IV rank, vol history
│   ├── tradier.py            ← Tradier adapter (real-time + AH via yfinance)
│   ├── portfolio.py          ← P&L, exit signals, Greeks aggregation
│   ├── config_routes.py      ← /api/config/* (env, positions read/write)
│   └── paths.py              ← ROOT, USER_DATA, ENV_FILE, POSITIONS_FILE
├── frontend/src/App.jsx      ← React dashboard (~3100 lines)
├── platform/
│   ├── macos/                ← OPTFLOW.command, setup.sh
│   └── windows/              ← OPTFLOW.bat, setup_windows.bat
└── user_data/                ← gitignored: .env, positions.json
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

**Data flow:**
- Chain fetch (`/api/chain/{ticker}`) also calls `/api/spot/{ticker}` to populate enriched AH data immediately — no waiting for the WebSocket first tick
- WebSocket streams `{price, close, ah_change, ah_pct, is_ah}` per ticker every 2s
- `AnalysisPane` is a pure reader — reads `tabsA` populated by the left pane, no independent fetches, eliminating yfinance race condition

**Builder isolation:**
- Switching tickers clears `labLegsB` (App) before it reaches `LabPanel`
- `LabPanel` also independently clears legs whose ticker doesn't match the new `chainData.ticker`
- Real legs for the new ticker are preserved across the switch

**React:**
- `SortTh`, `Editable` hoisted to top-level (React rules of hooks — no component definitions inside render functions)
- `PayoffChart` is `React.memo`; `LegRow`, `SliderRow` are stable top-level functions
- `legVer` integer counter as `useMemo` dep key instead of `JSON.stringify(legs)`
- `ErrorBoundary` class wraps `AnalysisPane` — render errors show a diagnostic panel instead of a black screen

**Vol chart:**
- HV series computed via `numpy` rolling std × √252 on log returns from yfinance 18-month history
- HV Rank = rolling percentile of HV(20d) vs trailing 252 trading days
- Vol premium = `ATM IV − HV(20d)` — point-in-time comparison; use HV Rank for historical context
