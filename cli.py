"""
data_feeds.py — Polygon.io adapter with yfinance fallback
Maintains the same interface as options_chain.py so the rest of the
codebase is feed-agnostic.

Polygon tiers:
  Free:    15-min delayed, REST only
  Starter: Real-time REST ($29/mo)
  Developer+: WebSocket streaming

Set POLYGON_API_KEY in env or .env file.
Fallback to yfinance if key absent (delayed, no WebSocket).
"""

import os
import asyncio
import aiohttp
import requests
import numpy as np
import pandas as pd
from datetime import date, datetime
from typing import Optional
from dotenv import load_dotenv

from options_chain import bs_price, greeks, implied_vol, generate_signals

BASE = "https://api.polygon.io"


def _get_key() -> str:
    """Read key fresh each call so restarts aren't needed after .env edits."""
    load_dotenv(override=True)
    return os.getenv("POLYGON_API_KEY", "").strip()


# Keep module-level name for backward compat (used by api.py health check)
POLYGON_KEY = _get_key()


def _headers():
    return {"Authorization": f"Bearer {_get_key()}"}


def _get(url: str, params: dict = None) -> dict:
    r = requests.get(url, headers=_headers(), params=params or {}, timeout=10)
    r.raise_for_status()
    return r.json()


async def _aget(session: aiohttp.ClientSession, url: str, params: dict = None) -> dict:
    async with session.get(url, headers=_headers(), params=params or {}) as r:
        r.raise_for_status()
        return await r.json()


# ── Spot price ─────────────────────────────────────────────────────────────────

def get_spot_polygon(ticker: str) -> float:
    """Last trade price via Polygon /v2/last/trade."""
    data = _get(f"{BASE}/v2/last/trade/{ticker.upper()}")
    return float(data["results"]["p"])


def get_spot_yfinance(ticker: str) -> float:
    import yfinance as yf
    fi = yf.Ticker(ticker).fast_info
    return fi.get("last_price") or fi.get("previousClose", 0.0)


def get_spot(ticker: str) -> float:
    if _get_key():
        try:
            return get_spot_polygon(ticker)
        except Exception:
            pass
    return get_spot_yfinance(ticker)


# ── Options chain ──────────────────────────────────────────────────────────────

def fetch_chain_polygon(ticker: str, expiry: Optional[str] = None, r: float = 0.053) -> dict:
    """
    Fetch full options chain via Polygon v3/snapshot/options.
    Returns same schema as options_chain.fetch_chain().
    """
    S = get_spot_polygon(ticker)
    params = {"limit": 250, "contract_type": "call"}
    if expiry:
        params["expiration_date"] = expiry

    def fetch_side(contract_type):
        p = dict(params)
        p["contract_type"] = contract_type
        rows = []
        url = f"{BASE}/v3/snapshot/options/{ticker.upper()}"
        while url:
            data = _get(url, p)
            for result in data.get("results", []):
                d = result.get("details", {})
                g = result.get("greeks", {})
                q = result.get("day", {})
                rows.append({
                    "type":        contract_type,
                    "strike":      float(d.get("strike_price", 0)),
                    "expiry":      d.get("expiration_date", ""),
                    "bid":         float(result.get("last_quote", {}).get("bid", 0) or 0),
                    "ask":         float(result.get("last_quote", {}).get("ask", 0) or 0),
                    "last":        float(result.get("last_trade", {}).get("price", 0) or 0),
                    "volume":      int(q.get("volume", 0) or 0),
                    "OI":          int(result.get("open_interest", 0) or 0),
                    "iv":          float(result.get("implied_volatility", 0) or 0),
                    "delta":       float(g.get("delta", 0) or 0),
                    "gamma":       float(g.get("gamma", 0) or 0),
                    "theta":       float(g.get("theta", 0) or 0),
                    "vega":        float(g.get("vega", 0) or 0),
                    "ITM":         result.get("in_the_money", False),
                })
            next_url = data.get("next_url")
            url = next_url if next_url else None
            p = {}  # next_url already contains params
        return rows

    calls = fetch_side("call")
    puts  = fetch_side("put")
    chain = pd.DataFrame(calls + puts)
    chain["mid"] = (chain["bid"] + chain["ask"]) / 2

    # Filter to requested expiry if given
    if expiry:
        chain = chain[chain["expiry"] == expiry]

    # Use first available expiry if none specified
    available_expiries = sorted(chain["expiry"].unique().tolist())
    if not expiry and available_expiries:
        expiry = available_expiries[0]
        chain  = chain[chain["expiry"] == expiry]

    exp_date = datetime.strptime(expiry, "%Y-%m-%d").date()
    T = max((exp_date - date.today()).days, 0) / 365.0
    dte = int(T * 365)

    chain = chain.sort_values(["type", "strike"]).reset_index(drop=True)

    atm = chain[chain["type"] == "call"].iloc[
        (chain[chain["type"] == "call"]["strike"] - S).abs().argsort()[:1]
    ]
    atm_iv = float(atm["iv"].values[0]) if not atm.empty else 0.25

    # IV rank proxy (HV-based, same as before)
    from options_chain import iv_rank
    ivr = iv_rank(ticker, atm_iv)

    return {
        "ticker":    ticker,
        "spot":      S,
        "expiry":    expiry,
        "dte":       dte,
        "expiries":  available_expiries,
        "chain":     chain,
        "atm_iv":    atm_iv,
        "iv_rank":   ivr,
        "risk_free": r,
        "source":    "polygon",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }


def fetch_chain(ticker: str, expiry: Optional[str] = None, r: float = 0.053) -> dict:
    """Auto-selects Polygon or yfinance based on API key presence."""
    if _get_key():
        try:
            result = fetch_chain_polygon(ticker, expiry, r)
            result["signals"] = generate_signals(result)
            return result
        except Exception as e:
            print(f"[warn] Polygon fetch failed ({e}), falling back to yfinance")
    from options_chain import fetch_chain as yf_fetch
    result = yf_fetch(ticker, expiry, r)
    result["source"] = "yfinance"
    result["signals"] = generate_signals(result)
    return result


# ── Async batch fetch (for portfolio with multiple tickers) ────────────────────

async def fetch_spots_async(tickers: list[str]) -> dict[str, float]:
    """Fetch multiple spots concurrently via Polygon."""
    if not _get_key():
        return {t: get_spot_yfinance(t) for t in tickers}

    async with aiohttp.ClientSession() as session:
        tasks = {
            t: _aget(session, f"{BASE}/v2/last/trade/{t.upper()}")
            for t in tickers
        }
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        out = {}
        for ticker, result in zip(tasks.keys(), results):
            if isinstance(result, Exception):
                out[ticker] = get_spot_yfinance(ticker)
            else:
                out[ticker] = float(result["results"]["p"])
        return out


# ── WebSocket stream (Polygon Starter+ only) ───────────────────────────────────

async def stream_quotes(tickers: list[str], on_quote):
    """
    Stream real-time option quotes via Polygon WebSocket.
    on_quote(ticker, bid, ask, last) called on each update.
    Requires Polygon Starter+ subscription.
    """
    if not _get_key():
        raise RuntimeError("POLYGON_API_KEY required for streaming")

    import websockets, json

    uri = "wss://socket.polygon.io/options"
    sub_msg = json.dumps({"action": "subscribe",
                          "params": ",".join(f"Q.{t.upper()}" for t in tickers)})
    auth_msg = json.dumps({"action": "auth", "params": _get_key()})

    async with websockets.connect(uri) as ws:
        await ws.send(auth_msg)
        await ws.send(sub_msg)
        async for raw in ws:
            msgs = json.loads(raw)
            for msg in msgs:
                if msg.get("ev") == "Q":
                    await on_quote(msg.get("sym"), msg.get("bp"), msg.get("ap"), msg.get("lp"))


# ── Historical IV for charting ─────────────────────────────────────────────────

def fetch_iv_history(ticker: str, days: int = 60) -> pd.DataFrame:
    """
    Returns DataFrame of date, hv_21, hv_63 for IV rank charting.
    Uses price history (no Polygon subscription needed for this).
    """
    import yfinance as yf
    hist = yf.Ticker(ticker).history(period=f"{max(days+100, 200)}d")
    if hist.empty:
        return pd.DataFrame()
    log_ret = np.log(hist["Close"] / hist["Close"].shift(1)).dropna()
    df = pd.DataFrame(index=hist.index[1:])
    df["close"]  = hist["Close"].iloc[1:].values
    df["hv_21"]  = log_ret.rolling(21).std() * np.sqrt(252)
    df["hv_63"]  = log_ret.rolling(63).std() * np.sqrt(252)
    return df.dropna().tail(days)
