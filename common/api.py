"""
api.py — OPTFLOW FastAPI backend
Run: uvicorn api:app --port 8000
"""
import os, json, asyncio, signal, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
from dotenv import load_dotenv
from common.paths import ENV_FILE

from common.data_feeds import fetch_chain, fetch_spots_async, fetch_iv_history
from common.portfolio import load_portfolio, portfolio_summary
from common.config_routes import router as config_router

from common.paths import ROOT, PID_FILE
_pool = ThreadPoolExecutor(max_workers=20)

app = FastAPI(title="OPTFLOW API")
app.include_router(config_router)
app.add_middleware(CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"])


# ── Serialisation helpers ──────────────────────────────────────────────────────

def _to_json(obj):
    if isinstance(obj, pd.DataFrame):
        return json.loads(obj.replace({np.nan: None}).to_json(orient="records"))
    if isinstance(obj, np.integer):  return int(obj)
    if isinstance(obj, np.floating): return None if np.isnan(obj) else float(obj)
    if isinstance(obj, dict):        return {k: _to_json(v) for k, v in obj.items()}
    return obj


def _clean(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if   isinstance(v, float) and np.isnan(v): out[k] = None
        elif hasattr(v, "item"):                    out[k] = v.item()
        else:                                       out[k] = v
    return out


async def _run(fn, *args):
    return await asyncio.get_event_loop().run_in_executor(_pool, fn, *args)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("http://127.0.0.1:5173")


@app.get("/api/chain/{ticker}")
async def get_chain(ticker: str,
                    expiry:      Optional[str] = Query(None),
                    strikes:     int           = Query(20),
                    option_type: Optional[str] = Query(None)):
    try:
        result = await _run(fetch_chain, ticker.upper(), expiry)
    except Exception as e:
        raise HTTPException(400, str(e))

    chain, spot = result["chain"], result["spot"]
    if option_type in ("call", "put"):
        chain = chain[chain["type"] == option_type]

    def _trim(df):
        if df.empty: return df
        i = (df["strike"] - spot).abs().argsort().iloc[0]
        return df.iloc[max(0, i - strikes): i + strikes]

    chain = pd.concat([
        _trim(chain[chain["type"] == "call"].reset_index(drop=True)),
        _trim(chain[chain["type"] == "put"].reset_index(drop=True)),
    ]).reset_index(drop=True) if option_type is None else _trim(chain.reset_index(drop=True))

    sigs = result.get("signals") or {}
    return {
        "ticker": result["ticker"], "spot": result["spot"],
        "expiry": result["expiry"], "dte": result["dte"],
        "expiries": result["expiries"], "atm_iv": result["atm_iv"],
        "iv_rank": result["iv_rank"], "source": result.get("source", "unknown"),
        "fetched_at": result["fetched_at"],
        "signals": {k: {"action": v[0], "reason": v[1]} for k, v in sigs.items()},
        "chain": _to_json(chain),
    }


@app.get("/api/chain/{ticker}/expiries")
async def get_expiries(ticker: str):
    try:
        r = await _run(fetch_chain, ticker.upper(), None)
        return {"ticker": ticker.upper(), "expiries": r["expiries"]}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/spot/{ticker}")
async def get_spot(ticker: str):
    try:
        spots = await fetch_spots_async([ticker.upper()])
        return {"ticker": ticker.upper(), "price": spots[ticker.upper()]}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/portfolio")
async def get_portfolio(file: Optional[str] = Query(None)):
    try:
        positions = load_portfolio(file)
        if not positions:
            return {"account_value": 0, "cost_basis": 0, "summary": {},
                    "positions": [], "alerts": [], "expirations": []}

        tickers  = list({p["ticker"] for p in positions})
        spot_map = await fetch_spots_async(tickers)

        async def _iv(t):
            try:    return t, (await _run(fetch_chain, t)).get("atm_iv", 0.25)
            except: return t, 0.25

        iv_map = dict(await asyncio.gather(*[_iv(t) for t in tickers]))
        df     = portfolio_summary(positions, spot_map, iv_map)

        rows = [_clean(r.to_dict()) for _, r in df.iterrows()]
        for r in rows:
            r["alerts"] = r.pop("signals", [])

        pnl   = round(float(df["pnl"].sum()), 2)
        mval  = round(float(df["current_value"].sum()), 2)
        basis = round(float(df["entry_cost"].sum()), 2)

        return {
            "account_value": mval, "cost_basis": basis,
            "summary": {
                "total_pnl":      pnl,
                "total_pnl_pct":  round(pnl / (basis or 1) * 100, 2),
                "market_value":   mval,
                "net_delta":      round(float(df["delta"].sum()), 4),
                "net_theta":      round(float(df["theta"].sum()), 2),
                "net_vega":       round(float(df["vega"].sum()), 2),
                "net_gamma":      round(float(df["gamma"].sum()), 6) if "gamma" in df else 0,
                "position_count": len(df),
            },
            "positions":   rows,
            "alerts":      [{"ticker": r["ticker"], "strike": r["strike"],
                              "type": r["type"], "message": a, "dte": r.get("dte")}
                             for r in rows for a in r.get("alerts", [])],
            "expirations": sorted([{"ticker": r["ticker"], "expiry": r["expiry"],
                                     "dte": r["dte"], "type": r["type"], "strike": r["strike"]}
                                    for r in rows if r.get("dte", 999) <= 45],
                                   key=lambda x: x["dte"]),
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/iv-history/{ticker}")
async def get_iv_history(ticker: str, days: int = Query(60)):
    df = fetch_iv_history(ticker.upper(), days)
    if df.empty:
        raise HTTPException(404, "No history available")
    df.index = df.index.strftime("%Y-%m-%d")
    return {"ticker": ticker.upper(),
            "history": _to_json(df.reset_index().rename(columns={"index": "date"}))}


@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket, tickers: str = Query(...)):
    await websocket.accept()
    tlist = [t.strip().upper() for t in tickers.split(",")]
    try:
        while True:
            spots = await fetch_spots_async(tlist)
            spots["ts"] = pd.Timestamp.now().isoformat(timespec="seconds")
            await websocket.send_json(spots)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.close(code=1011, reason=str(e))


# ── Health ──────────────────────────────────────────────────────────────────────

_poly_cache: dict = {"active": None, "error": None, "at": 0.0}

@app.get("/api/health")
async def health():
    load_dotenv(str(ENV_FILE), override=True)
    key = os.getenv("POLYGON_API_KEY", "").strip()
    global _poly_cache

    poly_active, poly_error = False, None
    if key:
        now = time.time()
        if now - _poly_cache["at"] > 60 or _poly_cache["active"] is None:
            try:
                async with httpx.AsyncClient(timeout=5) as c:
                    r = await c.get("https://api.polygon.io/v1/marketstatus/now",
                                    headers={"Authorization": f"Bearer {key}"})
                    _poly_cache = {
                        "active": r.status_code in (200, 429),
                        "error":  None if r.status_code == 200
                                  else ("free tier — Starter needed for options" if r.status_code == 429
                                        else f"HTTP {r.status_code}"),
                        "at": now,
                    }
            except Exception as e:
                _poly_cache = {"active": False, "error": str(e), "at": now}
        poly_active, poly_error = _poly_cache["active"], _poly_cache["error"]

    tradier_active, tradier_error = False, None
    try:
        from common.tradier import is_configured
        if is_configured():
            res = await asyncio.get_event_loop().run_in_executor(
                _pool, lambda: __import__('common.tradier',fromlist=['verify_connection']).verify_connection())
            tradier_active, tradier_error = res["ok"], res.get("error")
    except Exception as e:
        tradier_error = str(e)

    return {
        "status": "ok",
        "polygon_configured": bool(key),
        "polygon_active":     poly_active,
        "polygon_error":      poly_error,
        "tradier_active":     tradier_active,
        "tradier_error":      tradier_error,
        "data_source": ("tradier (real-time)" if tradier_active
                        else "polygon (Starter needed)" if poly_active
                        else "yfinance (15-min delayed)"),
    }


# ── Shutdown ────────────────────────────────────────────────────────────────────

GOODBYE_HTML = """<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OPTFLOW Stopped</title>
<style>
  body{background:#07090c;color:#48516b;font-family:'IBM Plex Mono',monospace;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center}
  .logo{font-size:28px;color:#00d98b;margin-bottom:16px}
  h1{font-size:14px;color:#c8cfe0;letter-spacing:0.15em;margin-bottom:8px}
  p{font-size:11px;letter-spacing:0.08em;margin:4px 0}
  code{background:#0c0f14;padding:2px 8px;color:#f0a500}
</style></head>
<body><div class="box">
  <div class="logo">&#9672;</div>
  <h1>OPTFLOW STOPPED</h1>
  <p>Ports 8000 and 5173 are free.</p>
  <p style="margin-top:16px">Relaunch: double-click <code>OPTFLOW.command</code></p>
</div></body></html>"""


@app.post("/api/shutdown")
async def shutdown():
    """
    Returns the goodbye page HTML directly in this response — no second request needed.
    After the browser renders it from this response, the server dies cleanly.
    Firefox stays open because it has a valid page to display.
    """
    async def _kill():
        await asyncio.sleep(0.8)   # enough for response to reach browser
        pid_file = PID_FILE
        killed = False
        if pid_file.exists():
            try:
                os.kill(int(pid_file.read_text().strip()), signal.SIGTERM)
                killed = True
            except Exception:
                pass
        if not killed:
            import subprocess as _sp, sys as _sys
            for port in [8000, 5173]:
                if _sys.platform == "win32":
                    r = _sp.run(["netstat","-aon"], capture_output=True, text=True)
                    for line in r.stdout.splitlines():
                        if f":{port}" in line and "LISTENING" in line:
                            parts = line.strip().split()
                            if parts:
                                _sp.run(["taskkill","/F","/PID",parts[-1]], capture_output=True)
                else:
                    _sp.run(f"lsof -ti :{port} | xargs kill -9 2>/dev/null", shell=True)

    asyncio.create_task(_kill())
    return HTMLResponse(GOODBYE_HTML)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000)
