# ◈ OPTFLOW — Personal Options Terminal

A personal options trading terminal built with FastAPI + React.
Real-time chains, Greeks, IV analysis, portfolio tracking, and an interactive
strategy builder — all running locally.

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

Opens automatically at `http://127.0.0.1:5173`

---

## Layout

```
┌─ Sidebar ─┬──── Left Pane ─────┬──── Right Pane (⊞ SPLIT) ────┐
│ Views      │ ▤ Portfolio        │ ⊕ Builder                     │
│ Watchlist  │   Positions table  │   Real + theoretical legs     │
│ Positions  │   + buttons → lab  │   Scenario sliders            │
│ Settings   │ ◫ Chain            │   Net Greeks                  │
│            │   Options chain    │   IV Scenario Table           │
│            │   IV Rank / ATM IV │   Payoff chart                │
│            │   Positions held   │                               │
│            │   for this ticker  │ StrategyPanel (collapsible)   │
└────────────┴────────────────────┴───────────────────────────────┘
```

---

## Left Pane

### Portfolio View (`▤`)
- Sortable, filterable positions table (click column headers to sort)
- **`+` button** on each row adds that position to the Builder and navigates to its chain
- **`↗` button** opens the chain for that ticker
- Click any row to expand an inline **IV Scenario Table** (price × IV heatmap)
- Summary bar: account value, total P&L, net Δ/Θ/V, cost basis
- Exit alerts and DTE warnings

### Chain View (`◫`)
- Options chain centred on ATM, filtered by calls/puts
- **IV Rank** and **ATM IV** labelled in the controls bar
- Live spot price with after-hours indicator: `AH +0.63%  close $662.29`
- **`+` button** on each chain row sends that strike to the Builder
- **Positions held** section below the chain — shows all positions in this ticker in the same table format as Portfolio, each with its own `+` button; shows "no positions held" if none

---

## Right Pane (⊞ SPLIT to open)

### Builder (`⊕`)
Always-visible workspace for multi-leg analysis.

**Adding legs:**
- Portfolio `+` → appends real position as a leg (sequential — click multiple)
- Chain `+` → opens right pane seeded with that strike
- `+ LEG` button → adds a theoretical leg

**Leg types:**
- **Real legs** (from portfolio) — non-editable, show live P&L, CLOSE? toggle models exit
- **Theoretical legs** — fully editable strike/IV/type/qty/expiry

**Scenario controls:**
- **UNDERLYING** slider (±25%) — shifts spot for chart/Greeks/IV table
- **IV SHIFT** slider (±30%) — shifts all leg IVs simultaneously
- **DATE** picker — each leg computes remaining time independently (correct for multi-expiry)
- **↺ reset** appears when any value is non-default

**Panels (top to bottom):**
1. Scenario sliders
2. Net Greeks (Δ Γ Θ V) + P&L Now + Trade Stats (max profit/loss, breakevens)
3. IV Scenario Table (price × IV heatmap, P&L or VALUE mode)
4. Payoff chart (Simple or Multi mode)

**IV Scenario Table controls:**
- Base IV derived from first leg's actual IV
- IV step: default 1% per column, click to edit
- Price step: default 1% per row, click to edit
- 9 columns × 15 rows (±4 IV steps, ±7 price steps)

### Strategy Panel (collapsible ▾)
- Ranks 6 strategies vs current IV Rank and DTE
- Click a card to view entry rules, editable exit rules, recommended strikes
- `LAB →` seeds the Builder with recommended legs

---

## Data Sources

| Source   | Chains | Spot (regular hours) | Spot (after hours) | Cost |
|----------|--------|---------------------|--------------------|------|
| Tradier  | ✓ real-time | ✓ real-time | ✗ (dev account) | Free dev |
| Polygon  | ✓ real-time | ✓ real-time | — | Starter ~$29/mo |
| yfinance | ✓ 15-min delay | ✓ | ✓ post/pre market | Free |

**Priority:** Tradier → Polygon → yfinance  
**After-hours prices:** Tradier dev accounts return bid=ask=0 outside regular hours.
The app automatically falls back to yfinance `postMarketPrice`/`preMarketPrice` for
extended-hours pricing.

**Price source selector:** Sidebar → Settings → API Keys → PRICE SOURCE  
Options: AUTO (default) / TRADIER / POLYGON / YFINANCE  
Set to YFINANCE for most accurate after-hours prices on Tradier dev accounts.

**Sandbox warning:** If `TRADIER_SANDBOX=true` in `.env`, prices are simulated.
The sidebar shows a `SANDBOX` badge next to the Tradier indicator.

---

## API Keys

Add to `user_data/.env` (or via Sidebar → Settings → API Keys):
```
TRADIER_TOKEN=your_token        # developer.tradier.com (free)
TRADIER_SANDBOX=false           # true = fake prices, false = live
POLYGON_API_KEY=your_key        # polygon.io Starter for options data
PRICE_SOURCE=auto               # auto | tradier | polygon | yfinance
```

---

## Portfolio Import

### Robinhood CSV
Sidebar → Settings → Portfolio Import → upload CSV → SAVE

### Manual JSON (`user_data/positions.json`)
```json
[
  {
    "ticker": "SPY", "type": "call", "direction": "long",
    "strike": 520, "expiry": "2025-06-20",
    "contracts": 2, "entry_price": 4.50, "entry_date": "2025-03-01"
  }
]
```

---

## Project Structure

```
OPTFLOW/
├── run.py                    ← launch / stop / cli
├── common/
│   ├── api.py                ← FastAPI, WebSocket stream, health, price-source
│   ├── data_feeds.py         ← Tradier → Polygon → yfinance + AH enrichment
│   ├── options_chain.py      ← Black-Scholes, Greeks, IV, yfinance chain
│   ├── tradier.py            ← Tradier adapter (real-time + AH via yfinance)
│   ├── portfolio.py          ← P&L, exit signals, Greeks aggregation
│   ├── config_routes.py      ← /api/config/* (env, positions)
│   └── paths.py
├── frontend/src/App.jsx      ← React dashboard (~2900 lines)
├── platform/macos/           ← OPTFLOW.command, setup.sh
├── platform/windows/         ← OPTFLOW.bat, setup_windows.bat
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

- Black-Scholes runs **client-side** — Builder updates instantly, zero API calls
- WebSocket streams enriched spot data `{price, close, ah_change, ah_pct, is_ah}` every 2s
- Chain fetch also calls `/api/spot/{ticker}` to immediately populate AH data before WS fires
- `AnalysisPane` is a **pure reader** — reads from `tabsA` (left pane), no independent fetches
- All inner components (`SortTh`, `Editable`) hoisted to top-level to satisfy React hooks rules
- `legVer` integer counter as `useMemo` dep key instead of `JSON.stringify(legs)`
- `PayoffChart` is `React.memo`; `LegRow`, `SliderRow`, `SortTh`, `Editable` are stable top-level functions
