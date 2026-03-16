# ◈ OPTFLOW — Personal Options Terminal

A personal options trading terminal built with FastAPI + React. Real-time chains, Greeks, IV analysis, portfolio tracking, and an interactive strategy builder — running entirely on your local machine.

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
┌─ Sidebar ────────┬──── Left Pane ─────────────┬── Right Pane (⊞ SPLIT) ──┐
│ ▤ Portfolio      │ ▤ Portfolio                 │ ⊕ Builder                │
│ ◫ Chain          │   Sortable positions table  │   Real + theoretical legs│
│ ◆ Strategy / Lab │   + button → Builder        │   ● LIVE spot tracking   │
│                  │   Inline IV Scenario (▸)    │   IV Shift slider        │
│ Watchlist        │                             │   DATE picker            │
│ Positions        │ ◫ Chain                     │   Net Greeks + Ω Elast   │
│ Settings         │   Options chain             │   IV Scenario Table      │
│                  │   IV Rank · ATM IV          │   Payoff chart + Ω line  │
│                  │   Positions for ticker (▸)  │                          │
│                  │   Vol chart (toggleable)    │ ◆ Strategy panel         │
│                  │   Option Analysis panel     │   Collapsible ranking    │
└──────────────────┴─────────────────────────────┴──────────────────────────┘
```

---

## Left Pane

### Portfolio View (`▤`)

- **Sortable columns** — click TICKER, SIDE, STRIKE, EXPIRY, DTE, P&L, P&L%, Δ, Θ, IV
- **Filter bar** — live filter by ticker, type, or direction
- **`+` button** (leftmost column) — adds position to the Builder and navigates to that ticker's chain. Multiple `+` clicks accumulate legs sequentially; duplicates are deduped
- **`↗` button** — opens the chain without adding to Builder
- **▸ expand** (click ticker name) — inline IV Scenario Table for that position (price × IV heatmap)
- **Summary bar** — account value, total P&L, net Δ/Θ/V, cost basis
- DTE warning badges at 45d (amber) and 21d (red)

### Chain View (`◫`)

- Ticker tabs — multiple tickers open simultaneously; tabs show live price and `AH` badge outside market hours
- **IV RANK** gauge + numeric value; **ATM IV** labelled
- Live spot price with after-hours context: `$663.08  AH +0.12%  close $662.29`
  - AH display suppressed automatically during regular session (9:30–16:00 ET Mon–Fri) at both backend and frontend layers
- **`+` button** on each chain row — seeds the Builder in the right pane with that strike
- Clicking any row also selects it for the **Option Analysis** panel below
- **CALLS / PUTS** toggle; expiry selector with DTE badge
- **Positions — TICKER** section below the chain table — shows all held positions for this ticker in the same row format, with their own `+` and expand (▸) buttons; shows "no positions held" when empty
- **Vol chart** — below positions (see below)
- **Option Analysis** panel — below vol chart; appears when any chain row or position row is clicked; clears when ticker changes

### Vol Chart

Fetches 365 days of data once; filtered client-side by date range.

**Duration controls:**
- **1M / 3M / 6M / 1Y** preset buttons
- **from / to** date inputs with min/max constraints
- **Brush drag-zoom** — drag handles or click-drag a window on the brush bar; updates the date inputs

**Toggleable series** (toggle buttons in chart header):

| Button | Default | Axis | Description |
|--------|---------|------|-------------|
| HV 20d | ✓ on | Left (%) | 20-day rolling realised vol (annualised) |
| HV 30d | off | Left | 30-day rolling realised vol |
| HV Rank | off | Right | Rolling HV percentile vs 252-day range |
| Price | off | Right | Closing price |
| Vol Prem | ✓ on | Left | ATM IV − HV 20d (vol premium) |
| Elasticity | off | Right (×) | Historical ATM option elasticity Ω |

**ATM IV reference line** (amber dashed, always shown) — today's ATM IV as a horizontal reference against historical HV. Deliberately flat: it answers "where is current implied vol relative to realised vol history?" Updates every 5 minutes. Label shows freshness: `(chain)` when from loaded chain data, `(2m ago)` when from background refresh, `(snapshot)` otherwise.

**Header signal** — `▲ IV rich +3.2%` or `▼ IV cheap −2.1%`, calculated as `ATM IV − HV(20d)`. This is a point-in-time comparison; use HV Rank for historical context.

**Elasticity series** — `Ω(t) = 0.5 × S(t) / ATM_price_approx(t)` where ATM price is approximated via BS ATM formula using HV20. Shows how much leverage a 30-day ATM option provided historically. Inversely proportional to vol — high during calm periods (cheap options, high leverage), low during volatile ones.

### Option Analysis Panel

Appears below the vol chart when any chain row or position row is selected. Selection is highlighted with a green left border, background tint, and outline. Clears when switching tickers.

Four signal categories with colour-coded labels:

| Category | What it evaluates |
|----------|-------------------|
| **VOL** | IV Rank vs 30/70 thresholds; buy vs sell premium recommendation |
| **LIQUIDITY** | Bid/ask spread as % of mid; OI depth warning below 100 contracts |
| **STRUCTURE** | Delta/moneyness with elasticity context (`1% underlying → Ω% option move`) |
| **TIMING** | DTE with theta decay rate as %/day; flags <21d acceleration and 30–45d sweet spot |

Verdict labels: `FAVOURABLE TO BUY`, `FAVOURABLE TO SELL`, `NEUTRAL`, `CAUTION`.

Key metrics footer: **Ω ELAST**, **Δ**, **Θ/day**, **IV**, **SPREAD%**, **OI**.

---

## Right Pane (⊞ SPLIT)

Open via ⊞ in the top bar or **◆ STRATEGY / LAB** in the sidebar.

### Header

`TICKER  $price  AH ±pct%  close $X  |  IV Rank N  ·  Nd  ·  ATM IV N%`

All fields labelled. AH data populated immediately on chain load (before first WebSocket tick).

### Strategy Panel (collapsible ▾)

Ranks 6 strategies (Long Call, Long Put, CSP, Covered Call, Iron Condor, Debit Spread) against current IV Rank and DTE. Each card shows a signal (BUY / SELL / NEUTRAL / AVOID / WATCH), score bar, and **LAB →** button. Clicking a card shows description, entry rule, editable exit rules (click to edit, ↺ reset), and recommended strikes with Greeks. `LAB →` seeds the Builder with those legs.

### Builder (`⊕`)

**Adding legs:**
- Portfolio `+` → appends real position as a leg (sequential, deduped by ticker+strike+type)
- Chain `+` → seeds Builder with that strike (replaces current legs)
- `+ LEG` button → adds a blank theoretical leg
- `LAB →` on strategy cards → seeds with all recommended legs

**Ticker isolation:** switching tickers completely clears the Builder — legs, scenario sliders, IV shift, date, and spot offset all reset. This prevents stale Greeks and IV tables from a previous ticker persisting after a switch.

**Leg types:**
- **Real legs** (green/red border) — from portfolio; CLOSE? toggle models exit P&L
- **Theoretical legs** — fully editable strike, IV, type, qty, expiry

**Scenario controls:**

| Control | Description |
|---------|-------------|
| **● LIVE / ○ LIVE** | Toggle live spot tracking. When on: spot auto-syncs from WebSocket every 2s, slider hidden. When off: slider frozen at current live offset, then manually adjustable. All calculations update immediately. |
| **IV SHIFT** | ±30% slider — shifts all leg IVs simultaneously |
| **DATE** | Calendar picker — each leg computes remaining time independently (correct for multi-expiry positions) |
| **↺ reset** | Appears when manual mode is active; returns to LIVE tracking with cleared offsets |

**Panels:**
1. Scenario controls
2. NET GREEKS (Δ Γ Θ V) + **Ω ELAST** + P&L NOW / TRADE STATS (max profit, max loss, breakevens)
3. IV Scenario Table
4. Payoff chart with elasticity overlay

### Market Elasticity (Ω)

**Formula:** `Ω = Δ × (S / V)` — percentage change in option price per 1% change in the underlying.

- **NET GREEKS panel** — shows exposure-weighted average Ω across all legs (e.g. `+8.3×`). Turns amber when |Ω| > 5
- **Payoff chart** — amber dashed Ω line on the right axis shows how leverage varies across the price range. Peaks near ATM, falls as options go deep ITM or far OTM
- **Vol chart Elasticity series** — historical Ω(t) using HV20 as a vol proxy
- **Option Analysis footer** — shows current Ω for the selected chain row

### IV Scenario Table

Price × IV shift heatmap showing P&L or VALUE for the full position.

- Base IV from first leg's actual IV
- **IV step** — default 1%, 9 columns (±4 steps). Click value to edit
- **Price step** — default 1%, 15 rows (±7 steps). Click value to edit
- Toggle **P&L** / **VALUE** mode
- Current spot row marked ◀; current IV column labelled `now`

---

## Data Sources

| Source | Chains | Regular hours | After hours | Cost |
|--------|--------|--------------|-------------|------|
| Tradier | ✓ real-time | ✓ real-time | ✗ dev account | Free dev |
| Polygon | ✓ real-time | ✓ real-time | — | Starter ~$29/mo |
| yfinance | ✓ 15-min delay | ✓ | ✓ post/pre market | Free |

**Priority:** Tradier → Polygon → yfinance

**After-hours pricing:** Tradier dev accounts return bid=ask=0 outside regular hours. The app automatically supplements with yfinance `postMarketPrice` / `preMarketPrice`. Set `PRICE_SOURCE=yfinance` for most accurate AH prices with a Tradier dev account.

**AH suppression:** `is_ah` is suppressed at both layers during 9:30–16:00 ET Mon–Fri. Backend uses `_is_market_hours()` (zoneinfo with pytz and UTC-4 fallbacks). Frontend `spotIsAH()` independently checks `isMarketHoursNow()` via the browser's locale API. Stale flags from before market open are cleared immediately on the next render.

**Price source selector:** Sidebar → Settings → API Keys → PRICE SOURCE: `AUTO` / `TRADIER` / `POLYGON` / `YFINANCE`

**Sandbox warning:** If `TRADIER_SANDBOX=true`, prices are simulated. A `SANDBOX` badge appears in the sidebar.

---

## API Keys

`user_data/.env` (or Sidebar → Settings → API Keys):

```
TRADIER_TOKEN=your_token        # developer.tradier.com (free)
TRADIER_SANDBOX=false           # true = simulated prices
POLYGON_API_KEY=your_key        # polygon.io Starter
PRICE_SOURCE=auto               # auto | tradier | polygon | yfinance
```

---

## Portfolio Import

### Robinhood CSV
Sidebar → Settings → Portfolio Import → upload → SAVE

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
├── run.py                     ← launch / stop / cli
├── common/
│   ├── api.py                 ← FastAPI, WebSocket, /api/price-source, /api/iv-history
│   ├── data_feeds.py          ← Tradier → Polygon → yfinance, AH enrichment, market hours
│   ├── options_chain.py       ← BS pricing, Greeks, IV rank, vol/elasticity history
│   ├── tradier.py             ← Tradier adapter, market hours guard
│   ├── portfolio.py           ← P&L, exit signals, Greeks aggregation
│   ├── config_routes.py       ← /api/config/* (env, positions)
│   └── paths.py
├── frontend/src/App.jsx       ← React dashboard (~3640 lines, 43 top-level definitions)
├── platform/macos/            ← OPTFLOW.command, setup.sh
├── platform/windows/          ← OPTFLOW.bat, setup_windows.bat
└── user_data/                 ← gitignored: .env, positions.json
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
- Chain fetch also calls `/api/spot/{ticker}` to populate AH data immediately — no waiting for WebSocket
- WebSocket streams `{price, close, ah_change, ah_pct, is_ah}` per ticker every 2s
- ATM IV reference line refreshes every 5 minutes via a minimal `?days=1` background call
- `AnalysisPane` is a pure reader — reads `tabsA` from the left pane, no independent chain fetches

**Builder isolation (ticker switching):**
- Chain-row legs carry `.ticker` field so the filter can identify them
- `prevTicker` effect in `LabPanel` runs `setLegs([])` unconditionally on ticker change, plus resets all scenario state
- App clears `labLegsB` when `leftActiveTabId` changes
- `openInRight` passes `[...labLegs]` (new array) so `seedKey` string comparison always detects fresh legs
- `seedKey` = `"ticker_strike_type|..."` string, compared by value not reference

**React component rules:**
- `SortTh`, `Editable`, `ChainPositions`, `OptionAnalysis` all hoisted to top-level — no component definitions inside render
- `PayoffChart` is `React.memo`; `LegRow`, `SliderRow` are stable top-level functions
- `legVer` integer counter as `useMemo` dep key
- `ErrorBoundary` class wraps `AnalysisPane` — render errors show a diagnostic panel with component stack

**Vol / elasticity computation:**
- HV series: `numpy` rolling std × √252 on log returns, 18-month fetch for 252-day rank window
- HV Rank: rolling percentile of HV(20d) vs trailing 252 trading days
- Historical Ω(t): `0.5 / (HV20 × √(30/365) × 0.3989)` — ATM BS approximation, inversely proportional to vol
- Net Ω in Builder: exposure-weighted sum `Σ(Δᵢ × Sᵢ/Vᵢ × wᵢ) / Σwᵢ` where wᵢ = |qty × V × 100|
