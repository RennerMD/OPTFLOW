"""
options_chain.py — Black-Scholes pricing, Greeks, IV solver, IV Rank
"""
import numpy as np
from scipy.stats import norm
from scipy.optimize import brentq
from datetime import date, datetime
from typing import Optional
import yfinance as yf

def _int(v):
    """Convert to int safely — returns 0 for None, NaN, or non-numeric."""
    try:
        f = float(v)
        return 0 if (f != f) else int(f)  # f != f is True only for NaN
    except (TypeError, ValueError):
        return 0



def bs_price(S, K, T, r, sigma, opt_type="call") -> float:
    if T <= 0 or sigma <= 0:
        return max(0.0, (S - K) if opt_type == "call" else (K - S))
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    if opt_type == "call":
        return float(S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2))
    return float(K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1))


def greeks(S, K, T, r, sigma, opt_type="call") -> dict:
    if T <= 0 or sigma <= 0:
        return {"delta": 1.0 if (opt_type=="call" and S>K) else 0.0,
                "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    pdf_d1 = norm.pdf(d1)
    sqrt_T = np.sqrt(T)
    gamma = float(pdf_d1 / (S * sigma * sqrt_T))
    vega  = float(S * pdf_d1 * sqrt_T / 100)
    if opt_type == "call":
        delta = float(norm.cdf(d1))
        theta = float((-S * pdf_d1 * sigma / (2 * sqrt_T) - r * K * np.exp(-r * T) * norm.cdf(d2)) / 365)
        rho   = float(K * T * np.exp(-r * T) * norm.cdf(d2) / 100)
    else:
        delta = float(norm.cdf(d1) - 1)
        theta = float((-S * pdf_d1 * sigma / (2 * sqrt_T) + r * K * np.exp(-r * T) * norm.cdf(-d2)) / 365)
        rho   = float(-K * T * np.exp(-r * T) * norm.cdf(-d2) / 100)
    return {"delta": delta, "gamma": gamma, "theta": theta, "vega": vega, "rho": rho}


def implied_vol(price, S, K, T, r, opt_type="call") -> Optional[float]:
    if T <= 0 or price <= 0:
        return None
    intrinsic = max(0.0, (S - K) if opt_type == "call" else (K - S))
    if price <= intrinsic:
        return None
    try:
        return float(brentq(lambda s: bs_price(S, K, T, r, s, opt_type) - price,
                            1e-6, 20.0, xtol=1e-5))
    except Exception:
        return None


def iv_rank(ticker: str, current_iv: float, window: int = 252) -> Optional[float]:
    try:
        tk = yf.Ticker(ticker)
        hist = tk.history(period="1y")
        if hist.empty or len(hist) < 20:
            return None
        log_ret = np.log(hist["Close"] / hist["Close"].shift(1)).dropna()
        rolling_hv = log_ret.rolling(20).std().dropna() * np.sqrt(252)
        lo, hi = float(rolling_hv.min()), float(rolling_hv.max())
        if hi <= lo:
            return None
        return round((current_iv - lo) / (hi - lo) * 100, 1)
    except Exception:
        return None


def generate_signals(result: dict) -> dict:
    iv_rank_val = result.get("iv_rank")
    dte         = result.get("dte", 999)
    signals     = {}
    if iv_rank_val is not None:
        if iv_rank_val < 30:
            signals["vol_entry"] = ("BUY", f"IV Rank {iv_rank_val:.0f} — cheap vol, favor long options")
        elif iv_rank_val > 70:
            signals["vol_entry"] = ("SELL/SHORT", f"IV Rank {iv_rank_val:.0f} — expensive vol, favor short premium")
        else:
            signals["vol_entry"] = ("NEUTRAL", f"IV Rank {iv_rank_val:.0f}")
    if dte <= 21:
        signals["dte_exit"] = ("EXIT", f"{dte} DTE — theta acceleration, close or roll")
    elif dte <= 45:
        signals["dte_exit"] = ("WATCH", f"{dte} DTE — monitor for exit")
    return signals


def fetch_chain(ticker: str, expiry: Optional[str] = None, r: float = 0.053) -> dict:
    """yfinance chain fetch — fallback only."""
    import pandas as pd
    tk = yf.Ticker(ticker)

    # Spot price — fast_info is most current including after-hours
    spot = None
    try:
        spot = tk.fast_info.get("last_price")
        if not spot:
            h = tk.history(period="1d", interval="1m", prepost=True)
            spot = float(h["Close"].iloc[-1]) if not h.empty else None
    except Exception:
        pass
    if not spot:
        raise ValueError(f"Cannot fetch price for {ticker}")
    spot = float(spot)

    expirations = list(tk.options)
    if not expirations:
        raise ValueError(f"No options for {ticker}")
    if expiry is None:
        expiry = expirations[0]

    exp_date = datetime.strptime(expiry, "%Y-%m-%d").date()
    T = max((exp_date - date.today()).days, 0) / 365.0
    dte = _int(T * 365)

    ch    = tk.option_chain(expiry)
    rows  = []
    for opt_type, df in [("call", ch.calls), ("put", ch.puts)]:
        for _, row in df.iterrows():
            bid = float(row.get("bid") or 0)
            ask = float(row.get("ask") or 0)
            mid = round((bid + ask) / 2, 4) if bid + ask > 0 else float(row.get("lastPrice") or 0)
            iv  = implied_vol(mid, spot, float(row["strike"]), T, r, opt_type) if mid > 0 else None
            g   = greeks(spot, float(row["strike"]), T, r, iv or 0.25, opt_type)
            rows.append({
                "type": opt_type, "strike": float(row["strike"]),
                "bid": bid, "ask": ask, "mid": mid,
                "volume": _int(row.get("volume")),
                "OI": _int(row.get("openInterest")),
                "iv": iv, "ITM": bool(row.get("inTheMoney", False)),
                **g,
            })

    chain = pd.DataFrame(rows).sort_values(["type", "strike"]).reset_index(drop=True)
    atm   = chain[chain["type"] == "call"].iloc[
        (chain[chain["type"] == "call"]["strike"] - spot).abs().argsort()[:1]
    ]
    atm_iv = float(atm["iv"].values[0]) if not atm.empty and atm["iv"].values[0] else 0.25
    result = {
        "ticker": ticker.upper(), "spot": spot, "expiry": expiry,
        "dte": dte, "expiries": expirations, "chain": chain,
        "atm_iv": atm_iv, "iv_rank": iv_rank(ticker, atm_iv),
        "risk_free": r, "source": "yfinance",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }
    result["signals"] = generate_signals(result)
    return result


def fetch_iv_history(ticker: str, days: int = 60):
    """60-day rolling historical volatility for the IV chart."""
    import pandas as pd
    try:
        tk   = yf.Ticker(ticker)
        hist = tk.history(period="3mo")
        if hist.empty:
            return pd.DataFrame()
        lr = np.log(hist["Close"] / hist["Close"].shift(1)).dropna()
        hv = lr.rolling(20).std().dropna() * np.sqrt(252)
        return hv.tail(days).rename("hv").to_frame()
    except Exception:
        return pd.DataFrame()
