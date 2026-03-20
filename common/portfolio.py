"""
portfolio.py — load and evaluate options positions
Position schema (JSON or CSV):
  ticker, type, strike, expiry, contracts, entry_price, entry_date, direction
"""
import json, csv
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import date, datetime
from typing import Optional
from common.options_chain import bs_price, greeks, implied_vol

from common.paths import POSITIONS_FILE

SAMPLE = [
    {"ticker":"SPY","type":"call","strike":580.0,"expiry":"2025-06-20",
     "contracts":1,"entry_price":3.50,"entry_date":"2025-03-01","direction":"long"},
    {"ticker":"QQQ","type":"put","strike":450.0,"expiry":"2025-05-16",
     "contracts":2,"entry_price":4.20,"entry_date":"2025-03-05","direction":"long"},
]

# Fields we keep from imported rows; extras (e.g. Robinhood metadata) are stripped
REQUIRED = {"ticker","type","strike","expiry","contracts","entry_price","entry_date","direction"}


def _clean(pos: dict) -> dict:
    """Normalise position fields. Preserves iv if provided (decimal, e.g. 1.289)."""
    base = {
        "ticker":      str(pos.get("ticker","")).upper(),
        "type":        str(pos.get("type","call")).lower(),
        "strike":      float(pos.get("strike") or 0),
        "expiry":      str(pos.get("expiry","") or ""),
        "contracts":   max(1, int(float(pos.get("contracts") or 1))),
        "entry_price": abs(float(pos.get("entry_price") or 0)),
        "entry_date":  str(pos.get("entry_date","") or ""),
        "direction":   str(pos.get("direction","long")).lower(),
    }
    # Preserve iv if stored (allows per-position accuracy over ATM IV proxy)
    raw_iv = pos.get("iv")
    if raw_iv is not None:
        try:
            fv = float(raw_iv)
            # Normalise: values >5 are almost certainly percent form (e.g. 128.9)
            base["iv"] = fv / 100.0 if fv > 5 else fv
        except (ValueError, TypeError):
            pass
    return base


def load_portfolio(path: Optional[str] = None) -> list:
    f = Path(path) if path else POSITIONS_FILE
    if not f.exists():
        return SAMPLE
    text = f.read_text().strip()
    if not text:
        return []
    if f.suffix == ".json":
        data = json.loads(text)
    else:
        reader = csv.DictReader(text.splitlines())
        data = list(reader)
    return [_clean(p) for p in data if p.get("ticker")]


def evaluate_position(pos: dict, spot: float, iv: float = 0.25, r: float = 0.053) -> dict:
    exp_date  = datetime.strptime(pos["expiry"], "%Y-%m-%d").date()
    T         = max((exp_date - date.today()).days, 0) / 365.0
    dte       = int(T * 365)
    direction = 1 if pos["direction"] == "long" else -1
    n         = pos["contracts"]

    # Use the position's own IV if stored (more accurate than ATM IV for that ticker)
    pos_iv = pos.get("iv")
    if pos_iv and float(pos_iv) > 0.01:
        iv = float(pos_iv)   # already decimal (e.g. 1.289 for 128.9%)

    # For very short DTE, use a minimum T to avoid BS numerical instability
    T_calc = max(T, 1/365/24)   # minimum ~1 hour to prevent theta blow-up

    # Use actual market mid when available (injected from chain row by api.py)
    # Fall back to BS theoretical price
    market_mid = pos.get("market_mid")
    if market_mid and float(market_mid) > 0:
        current_price = float(market_mid)
    else:
        current_price = bs_price(spot, pos["strike"], T_calc, r, iv, pos["type"])
    entry_cost    = pos["entry_price"] * 100 * n
    current_value = current_price * 100 * n
    pnl           = (current_value - entry_cost) * direction
    pnl_pct       = pnl / (entry_cost or 1) * 100
    g             = greeks(spot, pos["strike"], T_calc, r, iv, pos["type"])

    signals = []
    if pos["direction"] == "short" and pnl_pct >= 50:
        signals.append("TARGET: 50% max profit reached — consider closing")
    if pos["direction"] == "long" and pnl_pct <= -50:
        signals.append("STOP: position down 50% — review")
    if dte <= 21:
        signals.append(f"DTE ALERT: {dte} days — theta acceleration")
    elif dte <= 45:
        signals.append(f"DTE WATCH: {dte} days — plan exit")

    pos_delta = g["delta"] * direction
    return {
        **pos,
        "spot":          spot,
        "iv":            round(iv, 4),
        "dte":           dte,
        "mid":           round(current_price, 4),
        "current_price": round(current_price, 4),
        "entry_cost":    round(entry_cost, 2),
        "current_value": round(current_value, 2),
        "market_value":  round(current_value, 2),
        "pnl":           round(pnl, 2),
        "pnl_pct":       round(pnl_pct, 2),
        "delta":         round(pos_delta, 4),
        "net_delta":     round(pos_delta * 100 * n, 4),
        "gamma":         round(g["gamma"], 6),
        "theta":         round(g["theta"] * direction, 4),   # per share/day (consistent with chain display)
        "vega":          round(g["vega"]  * direction, 4),    # per share
        "target_price":  round(pos["entry_price"] * 1.5, 4) if direction == 1 else None,
        "stop_price":    round(pos["entry_price"] * 0.5, 4) if direction == 1 else None,
        "signals":       signals,
    }


def portfolio_summary(positions: list, spot_map: dict, iv_map: dict) -> pd.DataFrame:
    rows = []
    for pos in positions:
        spot = spot_map.get(pos["ticker"])
        if spot is None:
            continue
        rows.append(evaluate_position(pos, spot, iv_map.get(pos["ticker"], 0.25)))
    return pd.DataFrame(rows)
