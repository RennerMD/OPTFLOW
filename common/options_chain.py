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
    """IV Rank: percentile of current ATM IV within its own 52-week range.
    Since we lack historical IV data, we use the HV(20d) series as a proxy
    for the IV range. This correctly ranks vol within its own history.
    current_iv is compared against the [min_hv, max_hv] range of the past year.
    """
    try:
        tk = yf.Ticker(ticker)
        hist = tk.history(period="1y")
        if hist.empty or len(hist) < 25:
            return None
        log_ret    = np.log(hist["Close"] / hist["Close"].shift(1)).dropna()
        rolling_hv = log_ret.rolling(20).std().dropna() * np.sqrt(252)
        lo = float(rolling_hv.min())
        hi = float(rolling_hv.max())
        if hi <= lo:
            return None
        # If current IV exceeds the historical HV max, it's extreme — return 100
        if current_iv >= hi:
            return 100.0
        if current_iv <= lo:
            return 0.0
        rank = round((current_iv - lo) / (hi - lo) * 100, 1)
        return rank
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


def fetch_iv_history(ticker: str, days: int = 90):
    """Return daily vol series for charting:
      hv20    — 20-day rolling realised vol (annualised)
      hv30    — 30-day rolling realised vol (annualised)
      ivrank  — rolling HV percentile rank vs trailing 252d (proxy IV Rank)
      close   — closing price (for secondary axis context)
      omega   — historical ATM elasticity proxy: 0.5 * (S / ATM_price_approx)
                ATM_price_approx = S * hv20 * sqrt(30/365) * 0.3989 (Black-Scholes ATM approx)
                This equals S / (2 * S * hv20 * sqrt(T)) = 1 / (2 * hv20 * sqrt(T))
                Interpretation: a 1% move in the stock → omega% move in a 30d ATM option
    """
    import pandas as pd
    T30 = np.sqrt(30 / 365)   # 30-day time factor
    try:
        tk   = yf.Ticker(ticker)
        hist = tk.history(period="18mo")
        if hist.empty:
            return pd.DataFrame()
        S     = hist["Close"]
        lr    = np.log(S / S.shift(1)).dropna()
        hv20  = lr.rolling(20).std() * np.sqrt(252)
        hv30  = lr.rolling(30).std() * np.sqrt(252)

        # Rolling HV rank
        def rolling_rank(s, window=252):
            return s.rolling(window).apply(
                lambda x: float(np.sum(x <= x[-1])) / len(x), raw=True)
        hv_rank = rolling_rank(hv20)

        # ATM elasticity proxy using 30d ATM BS approximation
        # ATM call price ≈ S * sigma * sqrt(T) * 0.3989  (normal approx)
        # Omega = delta * S / V ≈ 0.5 * S / (S * sigma * sqrt(T) * 0.3989)
        #       = 0.5 / (sigma * sqrt(T) * 0.3989)  — purely vol-dependent
        atm_approx_price = S * hv20 * T30 * 0.3989
        omega = 0.5 * S / atm_approx_price   # = 0.5 / (hv20 * T30 * 0.3989)

        df = pd.DataFrame({
            "hv20":   hv20,
            "hv30":   hv30,
            "ivrank": hv_rank,
            "close":  S,
            "omega":  omega,
        }).dropna()
        df = df.tail(days)
        df.index = df.index.strftime("%Y-%m-%d")
        df.index.name = "date"
        return df.reset_index()
    except Exception:
        return pd.DataFrame()
