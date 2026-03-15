#!/usr/bin/env python3
"""
cli.py — OPTFLOW terminal interface
Uses the same source priority as the dashboard: Tradier > Polygon > yfinance

Usage:
    python3 cli.py chain SPY
    python3 cli.py chain SPY --expiry 2025-06-20 --strikes 10
    python3 cli.py portfolio
    python3 cli.py portfolio --file my_positions.json
"""

import argparse
import asyncio
import sys
import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from common.data_feeds import fetch_chain, fetch_spots_async
from common.portfolio import load_portfolio, portfolio_summary

console = Console()


def cmd_chain(args):
    ticker = args.ticker.upper()

    with console.status(f"[cyan]Fetching {ticker} options..."):
        result = fetch_chain(ticker, getattr(args, "expiry", None))

    chain  = result["chain"]
    ivr    = result.get("iv_rank")
    source = result.get("source", "unknown")

    console.print(Panel(
        f"[bold]{ticker}[/]  "
        f"Spot: [bold green]{result['spot']:.2f}[/]  |  "
        f"Expiry: [cyan]{result['expiry']}[/] ({result['dte']} DTE)  |  "
        f"ATM IV: {result['atm_iv']*100:.1f}%  |  "
        f"IV Rank: {f'{ivr:.1f}' if ivr is not None else 'N/A'}  |  "
        f"Source: [yellow]{source}[/]",
        title="Options Chain"
    ))

    for opt_type in ["call", "put"]:
        sub = chain[chain["type"] == opt_type].copy()
        # Trim to ATM ± strikes
        if not sub.empty and args.strikes:
            spot = result["spot"]
            atm_idx = (sub["strike"] - spot).abs().argsort().iloc[0]
            lo = max(0, atm_idx - args.strikes)
            hi = atm_idx + args.strikes
            sub = sub.iloc[lo:hi]

        t = Table(
            title=f"[bold]{'CALLS' if opt_type=='call' else 'PUTS'}[/]",
            show_lines=False, header_style="bold magenta"
        )
        cols = ["strike","bid","ask","mid","volume","OI","iv","delta","gamma","theta","vega"]
        for col in cols:
            t.add_column(col.upper(), justify="right")

        for _, row in sub.iterrows():
            style = "bold" if row.get("ITM") else ""
            vals = []
            for col in cols:
                v = row.get(col)
                if v is None or (isinstance(v, float) and pd.isna(v)):
                    vals.append("—")
                elif col == "iv":
                    vals.append(f"{v*100:.1f}%" if v else "—")
                elif col in ("volume","OI"):
                    vals.append(f"{int(v):,}" if v else "0")
                elif isinstance(v, float):
                    vals.append(f"{v:.4f}" if abs(v) < 10 else f"{v:.2f}")
                else:
                    vals.append(str(v))
            t.add_row(*vals, style=style)
        console.print(t)

    # Signals
    sigs = result.get("signals", {})
    if sigs:
        console.print("\n[bold yellow]Signals[/]")
        colors = {"BUY":"green","SELL/SHORT":"red","EXIT":"red",
                  "WATCH":"yellow","HOLD":"blue","NEUTRAL":"white"}
        for _, (action, reason) in sigs.items():
            c = colors.get(action, "white")
            console.print(f"  [{c}]● {action}[/]  {reason}")


def cmd_portfolio(args):
    path      = getattr(args, "file", None)
    positions = load_portfolio(path)
    if not positions:
        console.print("[yellow]No positions found.[/]")
        return

    tickers = list({p["ticker"] for p in positions})

    with console.status("[cyan]Fetching market data..."):
        spot_map = asyncio.run(fetch_spots_async(tickers))
        iv_map   = {}
        for t in tickers:
            try:
                chain_result = fetch_chain(t)
                iv_map[t] = chain_result.get("atm_iv", 0.25)
            except Exception:
                iv_map[t] = 0.25

    df = portfolio_summary(positions, spot_map, iv_map)
    if df.empty:
        console.print("[yellow]No positions could be evaluated.[/]")
        return

    table = Table(title="[bold]Portfolio[/]", show_lines=False, header_style="bold cyan")
    cols = ["ticker","type","strike","expiry","dte","contracts","direction",
            "entry_cost","current_value","pnl","pnl_pct","delta","theta","vega"]
    for col in cols:
        if col in df.columns:
            table.add_column(col.upper(), justify="right")

    for _, row in df.iterrows():
        vals = []
        for col in cols:
            if col not in df.columns:
                continue
            v = row[col]
            if col == "pnl":
                vals.append(f"[green]{v:+.2f}[/]" if v >= 0 else f"[red]{v:+.2f}[/]")
            elif col == "pnl_pct":
                vals.append(f"[green]{v:+.1f}%[/]" if v >= 0 else f"[red]{v:+.1f}%[/]")
            elif isinstance(v, float) and not pd.isna(v):
                vals.append(f"{v:.4f}" if 0 < abs(v) < 1 else f"{v:.2f}")
            else:
                vals.append(str(v) if pd.notna(v) else "—")
        table.add_row(*vals)

    console.print(table)

    total_pnl   = df["pnl"].sum()
    net_delta   = df["delta"].sum()
    net_theta   = df["theta"].sum()
    console.print(
        f"\n  Net P&L: [{'green' if total_pnl>=0 else 'red'}]{total_pnl:+.2f}[/]  |  "
        f"Net Δ: {net_delta:+.4f}  |  Net θ: {net_theta:+.2f}/day"
    )

    alerts = [(r["ticker"], r["strike"], r["type"], s)
              for _, r in df.iterrows() for s in r.get("signals", [])]
    if alerts:
        console.print("\n[bold yellow]Alerts[/]")
        for ticker, strike, typ, sig in alerts:
            console.print(f"  ⚠  [yellow]{ticker} {strike} {typ}:[/] {sig}")


def main():
    parser = argparse.ArgumentParser(
        prog="python3 cli.py",
        description="OPTFLOW — options terminal CLI"
    )
    sub = parser.add_subparsers(dest="cmd")

    cp = sub.add_parser("chain", help="Fetch options chain")
    cp.add_argument("ticker")
    cp.add_argument("--expiry",  default=None, help="YYYY-MM-DD")
    cp.add_argument("--strikes", type=int, default=15, help="Rows per side (default 15)")

    pp = sub.add_parser("portfolio", help="View portfolio P&L")
    pp.add_argument("--file", default=None, help="Path to positions .json or .csv")

    args = parser.parse_args()
    if   args.cmd == "chain":     cmd_chain(args)
    elif args.cmd == "portfolio": cmd_portfolio(args)
    else: parser.print_help()


if __name__ == "__main__":
    main()
