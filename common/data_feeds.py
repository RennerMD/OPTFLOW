"""
data_feeds.py — unified data source layer
Priority: Tradier (free, real-time) > Polygon (Starter+) > yfinance (fallback)
"""
import os
import asyncio
import aiohttp
import requests
from typing import Optional
from dotenv import load_dotenv
from common.paths import ENV_FILE
from common.options_chain import fetch_chain as _yf_chain, fetch_iv_history, generate_signals, _int

POLYGON_BASE = "https://api.polygon.io"


def _polygon_key() -> str:
    load_dotenv(str(ENV_FILE), override=True)
    return os.getenv("POLYGON_API_KEY", "").strip()

def _polygon_headers() -> dict:
    return {"Authorization": f"Bearer {_polygon_key()}"}


# ── Spot prices ────────────────────────────────────────────────────────────────

def _spot_yfinance(ticker: str) -> float:
    """Get current price including pre/post market via yfinance."""
    import yfinance as yf
    tk = yf.Ticker(ticker)
    try:
        # fast_info.last_price reflects pre/post market on supported tickers
        price = tk.fast_info.get("last_price")
        if price:
            return float(price)
    except Exception:
        pass
    try:
        # history with prepost=True captures extended hours candles
        h = tk.history(period="1d", interval="1m", prepost=True)
        if not h.empty:
            return float(h["Close"].iloc[-1])
    except Exception:
        pass
    return 0.0

def _spot_yfinance_enriched(ticker: str) -> dict:
    """Get enriched spot dict including pre/post market prices via yfinance.
    Priority: postMarketPrice > preMarketPrice > regularMarketPrice > history.
    """
    import yfinance as yf
    tk = yf.Ticker(ticker)
    price, close = 0.0, 0.0
    is_extended  = False

    # tk.info is the most reliable source for extended-hours prices
    try:
        info  = tk.info
        close = float(info.get("regularMarketPreviousClose") or
                      info.get("previousClose") or 0)
        reg   = float(info.get("regularMarketPrice") or 0)
        post  = float(info.get("postMarketPrice")    or 0)
        pre   = float(info.get("preMarketPrice")     or 0)
        # Use extended-hours price if available and meaningfully different
        if post and abs(post - reg) > 0.01:
            price      = post
            is_extended = True
        elif pre and abs(pre - reg) > 0.01:
            price      = pre
            is_extended = True
        else:
            price = reg or close
    except Exception:
        pass

    # Fallback: fast_info then history
    if not price:
        try:
            fi    = tk.fast_info
            price = float(fi.last_price or 0)
            if not close:
                close = float(fi.previous_close or 0)
        except Exception:
            pass
    if not price:
        try:
            h = tk.history(period="1d", interval="1m", prepost=True)
            if not h.empty:
                price = float(h["Close"].iloc[-1])
        except Exception:
            pass

    if not close and price:
        close = price  # last resort

    ah_chg = round(price - close, 4) if close and price else 0
    ah_pct = round((ah_chg / close) * 100, 3) if close else 0
    return {
        "price":     price,
        "close":     close,
        "ah_change": ah_chg,
        "ah_pct":    ah_pct,
        "is_ah":     is_extended or (close > 0 and abs(price - close) > 0.01),
    }


async def fetch_spots_async(tickers: list) -> dict:
    """Fetch spot prices. Respects PRICE_SOURCE env var override.
    PRICE_SOURCE=tradier  → Tradier only (falls back if unavailable)
    PRICE_SOURCE=polygon  → Polygon only
    PRICE_SOURCE=yfinance → yfinance only (best for AH prices on dev Tradier)
    PRICE_SOURCE=auto     → Tradier > Polygon > yfinance (default)
    """
    load_dotenv(str(ENV_FILE), override=True)
    forced = os.getenv("PRICE_SOURCE", "auto").strip().lower()

    # ── yfinance forced ───────────────────────────────────────────────────────
    if forced == "yfinance":
        return {t: _spot_yfinance_enriched(t) for t in tickers}

    # ── Tradier (default or forced) ───────────────────────────────────────────
    if forced in ("auto", "tradier"):
        try:
            from common.tradier import is_configured, _base, _headers
            if is_configured():
                def _bulk():
                    r = requests.get(
                        f"{_base()}/v1/markets/quotes",
                        headers=_headers(),
                        params={"symbols": ",".join(t.upper() for t in tickers),
                                "greeks": "false"},
                        timeout=10)
                    r.raise_for_status()
                    return r.json()
                loop   = asyncio.get_event_loop()
                data   = await loop.run_in_executor(None, _bulk)
                quotes = data.get("quotes", {}).get("quote", [])
                if isinstance(quotes, dict):
                    quotes = [quotes]
                def _enrich(q):
                    last  = float(q.get("last")      or 0)
                    bid   = float(q.get("bid")       or 0)
                    ask   = float(q.get("ask")       or 0)
                    close = float(q.get("close") or q.get("prevclose") or 0)
                    mid   = round((bid+ask)/2,4) if bid>0 and ask>0 else 0

                    # Tradier dev: bid/ask=0 outside regular hours.
                    # Supplement with yfinance for accurate pre/post market price.
                    if bid == 0 and ask == 0:
                        try:
                            yf_data = _spot_yfinance_enriched(q["symbol"])
                            if yf_data["price"] > 0:
                                return yf_data
                        except Exception:
                            pass
                        return {"price": last or close, "close": close,
                                "ah_change": 0, "ah_pct": 0, "is_ah": False}

                    # Regular hours: prefer mid if it diverges from last
                    price = mid if (mid>0 and last>0 and abs(mid-last)/last > 0.0005)                             else (last or mid or close or 0)
                    ah_chg = round(price-close, 4) if close else 0
                    ah_pct = round((ah_chg/close)*100, 3) if close else 0
                    return {"price": price, "close": close,
                            "ah_change": ah_chg, "ah_pct": ah_pct,
                            "is_ah": close>0 and abs(price-close)>0.01}

                out = {q["symbol"]: _enrich(q) for q in quotes}
                if all(out.get(t.upper(), {}).get("price", 0) > 0 for t in tickers):
                    return {t: out[t.upper()] for t in tickers}
        except Exception as e:
            print(f"[warn] Tradier spots failed: {e}")

    # ── Polygon ───────────────────────────────────────────────────────────────
    if forced in ("auto", "polygon"):
        key = _polygon_key()
        if key:
            try:
                async def _pg(session, t):
                    async with session.get(
                        f"{POLYGON_BASE}/v2/last/trade/{t.upper()}",
                        headers=_polygon_headers()
                    ) as r:
                        d = await r.json()
                        return t, float(d["results"]["p"])
                async with aiohttp.ClientSession() as session:
                    results = await asyncio.gather(
                        *[_pg(session, t) for t in tickers], return_exceptions=True)
                    out = {}
                    for item in results:
                        if isinstance(item, Exception): continue
                        t, price = item
                        out[t] = price
                    if len(out) == len(tickers):
                        return {t: {"price": p, "close": 0,
                                    "ah_change": 0, "ah_pct": 0, "is_ah": False}
                                for t, p in out.items()}
            except Exception as e:
                print(f"[warn] Polygon spots failed: {e}")

    # ── yfinance fallback ─────────────────────────────────────────────────────
    return {t: _spot_yfinance_enriched(t) for t in tickers}




# ── Options chain ──────────────────────────────────────────────────────────────

def fetch_chain(ticker: str, expiry: Optional[str] = None, r: float = 0.053) -> dict:
    """Priority: Tradier > Polygon > yfinance."""
    # 1. Tradier
    try:
        from common.tradier import is_configured, fetch_chain_tradier
        if is_configured():
            return fetch_chain_tradier(ticker, expiry, r)
    except Exception as e:
        print(f"[warn] Tradier chain failed: {e}")

    # 2. Polygon (requires Starter plan)
    if _polygon_key():
        try:
            return _fetch_chain_polygon(ticker, expiry, r)
        except Exception as e:
            print(f"[warn] Polygon chain failed: {e}")

    # 3. yfinance
    result = _yf_chain(ticker, expiry, r)
    result["source"] = "yfinance"
    return result


def _fetch_chain_polygon(ticker: str, expiry: Optional[str] = None, r: float = 0.053) -> dict:
    from datetime import date, datetime
    import pandas as pd
    from options_chain import greeks, implied_vol, iv_rank

    # Spot
    resp = requests.get(f"{POLYGON_BASE}/v2/last/trade/{ticker.upper()}",
                        headers=_polygon_headers(), timeout=10)
    resp.raise_for_status()
    S = float(resp.json()["results"]["p"])

    # Expirations
    resp = requests.get(f"{POLYGON_BASE}/v3/reference/options/{ticker.upper()}",
                        headers=_polygon_headers(), params={"limit": 250}, timeout=10)
    resp.raise_for_status()
    expirations = sorted({r["details"]["expiration_date"]
                          for r in resp.json().get("results", [])})
    if not expirations:
        raise ValueError("No expirations from Polygon")
    if expiry is None:
        expiry = expirations[0]

    T   = max((datetime.strptime(expiry, "%Y-%m-%d").date() - date.today()).days, 0) / 365.0
    dte = int(T * 365)

    resp = requests.get(f"{POLYGON_BASE}/v3/snapshot/options/{ticker.upper()}",
                        headers=_polygon_headers(),
                        params={"expiration_date": expiry, "limit": 250}, timeout=10)
    resp.raise_for_status()
    options = resp.json().get("results", [])

    rows = []
    for opt in options:
        d     = opt.get("details", {})
        q     = opt.get("day", {})
        otype = d.get("contract_type", "call").lower()
        strike = float(d.get("strike_price", 0))
        bid    = float(opt.get("last_quote", {}).get("bid") or 0)
        ask    = float(opt.get("last_quote", {}).get("ask") or 0)
        mid    = round((bid + ask) / 2, 4) if bid + ask > 0 else 0
        iv     = implied_vol(mid, S, strike, T, r, otype) if mid > 0 else None
        g      = greeks(S, strike, T, r, iv or 0.25, otype)
        rows.append({
            "type": otype, "strike": strike, "bid": bid, "ask": ask, "mid": mid,
            "volume": _int(q.get("volume")), "OI": _int(opt.get("open_interest")),
            "iv": iv, "ITM": (otype=="call" and strike<S) or (otype=="put" and strike>S),
            **g,
        })

    chain  = pd.DataFrame(rows).sort_values(["type","strike"]).reset_index(drop=True)
    calls  = chain[chain["type"]=="call"]
    atm    = calls.iloc[(calls["strike"]-S).abs().argsort()[:1]]
    atm_iv = float(atm["iv"].values[0]) if not atm.empty and atm["iv"].values[0] else 0.25
    result = {
        "ticker": ticker.upper(), "spot": S, "expiry": expiry,
        "dte": dte, "expiries": expirations, "chain": chain,
        "atm_iv": atm_iv, "iv_rank": iv_rank(ticker, atm_iv),
        "risk_free": r, "source": "polygon",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }
    result["signals"] = generate_signals(result)
    return result
