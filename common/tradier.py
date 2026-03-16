"""
tradier.py — Tradier API adapter (free developer account)
Real-time quotes, options chains with live bid/ask, after-hours prices.
Sign up: https://developer.tradier.com

Add to .env:
    TRADIER_TOKEN=your_token
    TRADIER_SANDBOX=false   # true = sandbox, false = live brokerage
"""
import os
import requests
import pandas as pd
from datetime import date, datetime
from typing import Optional
from dotenv import load_dotenv
from common.paths import ENV_FILE
from common.options_chain import greeks, implied_vol, generate_signals, iv_rank, _int

BASE_LIVE    = "https://api.tradier.com"
BASE_SANDBOX = "https://sandbox.tradier.com"


def _token() -> str:
    load_dotenv(str(ENV_FILE), override=True)
    return os.getenv("TRADIER_TOKEN", "").strip()

def _base() -> str:
    load_dotenv(str(ENV_FILE), override=True)
    return BASE_SANDBOX if os.getenv("TRADIER_SANDBOX","false").lower()=="true" else BASE_LIVE

def _headers() -> dict:
    return {"Authorization": f"Bearer {_token()}", "Accept": "application/json"}

def _get(endpoint: str, params: dict = None) -> dict:
    r = requests.get(f"{_base()}{endpoint}", headers=_headers(),
                     params=params or {}, timeout=10)
    r.raise_for_status()
    return r.json()

def is_configured() -> bool:
    return bool(_token())

def verify_connection() -> dict:
    try:
        data = _get("/v1/markets/clock")
        return {"ok": True, "error": None,
                "market_state": data.get("clock", {}).get("state")}
    except requests.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.response.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def get_quote(ticker: str) -> dict:
    data = _get("/v1/markets/quotes", {"symbols": ticker.upper(), "greeks": "false"})
    q = data.get("quotes", {}).get("quote", {})
    return q[0] if isinstance(q, list) else q

def get_spot(ticker: str) -> float:
    q = get_quote(ticker)
    # Use last trade price; fall back to bid/ask mid for after-hours,
    # then previous close as final fallback
    last  = float(q.get("last")      or 0)
    bid   = float(q.get("bid")       or 0)
    ask   = float(q.get("ask")       or 0)
    close = float(q.get("prevclose") or 0)
    mid   = round((bid + ask) / 2, 4) if bid > 0 and ask > 0 else 0
    return last or mid or close or 0

def get_expirations(ticker: str) -> list:
    data = _get("/v1/markets/options/expirations",
                {"symbol": ticker.upper(), "includeAllRoots": "false", "strikes": "false"})
    exps = data.get("expirations", {}).get("date", [])
    return sorted([exps] if isinstance(exps, str) else (exps or []))

def fetch_chain_tradier(ticker: str, expiry: Optional[str] = None, r: float = 0.053) -> dict:
    expirations = get_expirations(ticker)
    if not expirations:
        raise ValueError(f"No expirations for {ticker}")
    if expiry is None:
        expiry = expirations[0]
    elif expiry not in expirations:
        raise ValueError(f"Expiry {expiry} not available")

    S   = get_spot(ticker)
    T   = max((datetime.strptime(expiry, "%Y-%m-%d").date() - date.today()).days, 0) / 365.0
    dte = _int(T * 365)

    data    = _get("/v1/markets/options/chains",
                   {"symbol": ticker.upper(), "expiration": expiry, "greeks": "true"})
    options = data.get("options", {}).get("option", [])
    if not options:
        raise ValueError(f"Empty chain for {ticker} {expiry}")
    if isinstance(options, dict):
        options = [options]

    rows = []
    for opt in options:
        otype  = opt.get("option_type", "").lower()
        strike = float(opt.get("strike") or 0)
        bid    = float(opt.get("bid") or 0)
        ask    = float(opt.get("ask") or 0)
        last   = float(opt.get("last") or 0)
        mid    = round((bid + ask) / 2, 4) if bid + ask > 0 else last
        g      = opt.get("greeks") or {}

        iv    = float(g.get("smv_vol") or 0) or None
        delta = float(g.get("delta") or 0) or None
        gamma = float(g.get("gamma") or 0) or None
        theta = float(g.get("theta") or 0) or None
        vega  = float(g.get("vega")  or 0) or None

        if iv is None and mid > 0 and T > 0:
            iv = implied_vol(mid, S, strike, T, r, otype)
        if iv and T > 0:
            bs = greeks(S, strike, T, r, iv, otype)
            delta = delta or bs["delta"]
            gamma = gamma or bs["gamma"]
            theta = theta or bs["theta"]
            vega  = vega  or bs["vega"]

        rows.append({
            "type": otype, "strike": strike, "bid": bid, "ask": ask,
            "mid": mid, "last": last,
            "volume": _int(opt.get("volume")),
            "OI": _int(opt.get("open_interest")),
            "iv": iv, "delta": delta, "gamma": gamma, "theta": theta, "vega": vega,
            "ITM": (otype=="call" and strike<S) or (otype=="put" and strike>S),
        })

    chain  = pd.DataFrame(rows).sort_values(["type","strike"]).reset_index(drop=True)
    calls  = chain[chain["type"]=="call"]
    atm    = calls.iloc[(calls["strike"]-S).abs().argsort()[:1]]
    atm_iv = float(atm["iv"].values[0]) if not atm.empty and atm["iv"].values[0] else 0.25

    result = {
        "ticker": ticker.upper(), "spot": S, "expiry": expiry,
        "dte": dte, "expiries": expirations, "chain": chain,
        "atm_iv": atm_iv, "iv_rank": iv_rank(ticker, atm_iv),
        "risk_free": r, "source": "tradier",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }
    result["signals"] = generate_signals(result)
    return result
