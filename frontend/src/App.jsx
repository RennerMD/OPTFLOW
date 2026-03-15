import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const API = "http://127.0.0.1:8000/api";
const WS  = "ws://127.0.0.1:8000/ws";
const SIDEBAR_W = 264;

// ── Utilities ──────────────────────────────────────────────────────────────────
const fmt     = (v,d=2) => v==null||isNaN(v) ? "—" : Number(v).toFixed(d);
const fmtPct  = v => v==null ? "—" : `${(v*100).toFixed(1)}%`;
const fmtK    = v => v==null ? "—" : v>999 ? `${(v/1000).toFixed(1)}k` : String(v);
const fmtUSD  = v => v==null ? "—" : `$${Math.abs(v).toFixed(2)}`;
const clsx    = (...c) => c.filter(Boolean).join(" ");
const pnlColor    = v => v>0?"#00e5a0":v<0?"#ff4d6d":"#888";
const signalColor = a => ({BUY:"#00e5a0","SELL/SHORT":"#ff4d6d",EXIT:"#ff4d6d",
                            WATCH:"#f5a623",HOLD:"#4da8ff",NEUTRAL:"#888"}[a]||"#888");
const persist = (k,v) => { try{localStorage.setItem(k,JSON.stringify(v));}catch{} };
const recall  = (k,d) => { try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;} };

// ── Small shared components ────────────────────────────────────────────────────

function IVGauge({rank}) {
  if (rank==null) return <span className="muted">N/A</span>;
  const color = rank<30?"#00e5a0":rank>70?"#ff4d6d":"#f5a623";
  return (
    <div className="iv-gauge">
      <div className="iv-bar-bg">
        <div className="iv-bar-fill" style={{width:`${rank}%`,background:color}}/>
        <div className="iv-bar-cursor" style={{left:`${rank}%`}}/>
      </div>
      <span style={{color}}>{rank.toFixed(1)}</span>
    </div>
  );
}

function SignalChip({action,reason}) {
  const c = signalColor(action);
  return (
    <div className="signal-chip" style={{borderColor:c}}>
      <span className="signal-dot" style={{background:c}}/>
      <span className="signal-action" style={{color:c}}>{action}</span>
      <span className="signal-reason">{reason}</span>
    </div>
  );
}

function SideSection({label,open,onToggle,children,badge,indent=false}) {
  return (
    <div style={{
      borderBottom:indent?"none":"1px solid var(--border)",
      borderTop:indent?"1px solid rgba(255,255,255,0.04)":"none",
      flexShrink:0,
    }}>
      <button onClick={onToggle} className="side-section-btn"
        style={{paddingLeft:indent?"22px":"14px",fontSize:indent?"8px":"9px",
          color:indent?"#333":"#444"}}>
        <span style={{display:"flex",alignItems:"center",gap:6}}>
          {indent&&<span style={{fontSize:8,color:"#2a2a2a"}}>▸</span>}
          {label}
          {badge&&<span style={{background:"rgba(255,77,109,0.15)",color:"#ff4d6d",
            fontSize:9,padding:"1px 5px",borderRadius:2}}>{badge}</span>}
        </span>
        <span style={{fontSize:9,transition:"transform 0.2s",
          display:"inline-block",transform:open?"rotate(180deg)":"rotate(0deg)"}}>▾</span>
      </button>
      {open&&<div>{children}</div>}
    </div>
  );
}

// ── ChainTable ─────────────────────────────────────────────────────────────────
function ChainTable({chain,spot,activeType,onRowClick}) {
  const rows = chain.filter(r=>r.type===activeType);
  const cols = ["strike","bid","ask","mid","volume","OI","iv","delta","gamma","theta","vega"];
  const minDiff = spot ? Math.min(...rows.map(r=>Math.abs(r.strike-spot))) : null;
  return (
    <div className="chain-scroll">
      <table className="chain-table">
        <thead><tr>
          {onRowClick&&<th title="Open in Lab">LAB</th>}
          {cols.map(c=><th key={c}>{c.toUpperCase()}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((row,i)=>{
            const isATM = minDiff!=null && Math.abs(row.strike-spot)===minDiff;
            return (
              <tr key={i} className={clsx(row.ITM&&"itm",isATM&&"atm")}>
                {onRowClick&&(
                  <td style={{padding:"2px 6px"}}>
                    <button onClick={()=>onRowClick(row)}
                      title="Analyze in Lab"
                      style={{background:"none",border:"1px solid #1e1e1e",color:"#333",
                        fontFamily:"var(--mono)",fontSize:9,padding:"1px 5px",cursor:"pointer",
                        transition:"all 0.15s",letterSpacing:0}}
                      onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
                      onMouseLeave={e=>{e.currentTarget.style.color="#333";e.currentTarget.style.borderColor="#1e1e1e";}}>
                      +
                    </button>
                  </td>
                )}
                {cols.map(c=>(
                  <td key={c} className={c==="strike"?"strike-col":""}>
                    {c==="iv"?fmtPct(row[c]):c==="volume"||c==="OI"?fmtK(row[c]):fmt(row[c],c==="strike"?2:4)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── IVChart ────────────────────────────────────────────────────────────────────
function IVChart({ticker}) {
  const [data,setData] = useState([]);
  useEffect(()=>{
    fetch(`${API}/iv-history/${ticker}`)
      .then(r=>r.json()).then(d=>setData(d.history||[])).catch(()=>{});
  },[ticker]);
  if (!data.length) return null;
  return (
    <div className="iv-chart-wrap">
      <div style={{fontSize:10,color:"#444",letterSpacing:"0.1em",marginBottom:6}}>60-DAY HV</div>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} margin={{top:2,right:4,bottom:2,left:4}}>
          <XAxis dataKey="date" hide/>
          <YAxis hide domain={["auto","auto"]}/>
          <Tooltip contentStyle={{background:"#111",border:"1px solid #232323",fontSize:10}}
            formatter={v=>`${(v*100).toFixed(1)}%`}/>
          <Line type="monotone" dataKey="hv" stroke="#4da8ff" dot={false} strokeWidth={1.5}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── PortfolioPanel ─────────────────────────────────────────────────────────────
function PortfolioPanel({data,onTickerOpen}) {
  if (!data) return (
    <div className="panel-empty">
      No portfolio loaded<br/>
      <span style={{fontSize:10,color:"#2a2a2a",marginTop:8,display:"block"}}>
        Import via sidebar → PORTFOLIO IMPORT
      </span>
    </div>
  );
  const {positions=[],alerts=[],expirations=[],summary={},
         account_value:acctValue=0,cost_basis:costBasis=0} = data;
  const {total_pnl:totalPnl=0,total_pnl_pct:totalPct=0,
         net_delta:netDelta=0,net_theta:netTheta=0,net_vega:netVega=0} = summary;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div className="acct-value-bar">
        <div>
          <div style={{fontSize:9,color:"#555",letterSpacing:"0.15em",marginBottom:4}}>ACCOUNT VALUE (OPTIONS)</div>
          <div style={{fontSize:28,fontWeight:700,color:"#fff",lineHeight:1}}>
            ${Math.abs(acctValue).toLocaleString("en-US",{minimumFractionDigits:2})}
          </div>
          <div style={{fontSize:11,marginTop:5,color:pnlColor(totalPnl)}}>
            {totalPnl>=0?"+":""}{fmtUSD(totalPnl)} ({totalPnl>=0?"+":""}{fmt(totalPct,1)}%)
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:20}}>
          {[["POS",positions.length,"#fff"],["≤45d",expirations.length,expirations.length>0?"#f5a623":"#555"],
            ["⚠",alerts.length,alerts.length>0?"#ff4d6d":"#555"]].map(([l,v,c])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:"#444",letterSpacing:"0.1em",marginBottom:3}}>{l}</div>
              <div style={{fontSize:18,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="greeks-bar">
        {[["NET Δ",fmt(netDelta,3),netDelta>0?"#00e5a0":netDelta<0?"#ff4d6d":"#555","Directional exposure"],
          ["NET Θ",fmt(netTheta,2),netTheta<0?"#ff4d6d":"#00e5a0","Daily decay"],
          ["NET V",fmt(netVega,2),netVega>0?"#4da8ff":"#f5a623","Vol sensitivity"],
          ["BASIS",`$${Math.abs(costBasis).toFixed(0)}`,"#fff","Capital deployed"]
        ].map(([l,v,c,tip])=>(
          <div key={l} className="greek-stat" title={tip}>
            <span className="greek-stat-label">{l}</span>
            <span className="greek-stat-val" style={{color:c}}>{v}</span>
          </div>
        ))}
      </div>
      {(alerts.length>0||expirations.length>0)&&(
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {alerts.length>0&&(
            <div style={{flex:1,minWidth:220}}>
              <div className="section-label" style={{marginBottom:6}}>EXIT ALERTS</div>
              {alerts.map((a,i)=>(
                <div key={i} className="port-alert" style={{marginBottom:3,cursor:"pointer"}}
                  onClick={()=>onTickerOpen&&onTickerOpen(a.ticker)}>
                  <span style={{color:"#ff4d6d"}}>⚠</span>
                  <div style={{flex:1}}>
                    <b style={{color:"#fff"}}>{a.ticker}</b>
                    <span style={{color:"#555",marginLeft:6,fontSize:10}}>{a.type} {fmt(a.strike)}</span>
                    <div style={{fontSize:10,color:"#f5a623",marginTop:1}}>{a.message}</div>
                  </div>
                  {a.dte!=null&&<span className="dte-badge" style={{fontSize:9}}>{a.dte}d</span>}
                </div>
              ))}
            </div>
          )}
          {expirations.length>0&&(
            <div style={{flex:1,minWidth:160}}>
              <div className="section-label" style={{marginBottom:6}}>EXPIRATIONS</div>
              {expirations.map((e,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,
                  fontSize:11,padding:"3px 8px",border:"1px solid #1e1e1e",cursor:"pointer"}}
                  onClick={()=>onTickerOpen&&onTickerOpen(e.ticker)}>
                  <b style={{color:"#fff",width:44}}>{e.ticker}</b>
                  <span style={{color:"#555",fontSize:10}}>{e.type} {fmt(e.strike)}</span>
                  <span style={{marginLeft:"auto"}}>
                    <span className="dte-badge" style={{fontSize:9,
                      borderColor:e.dte<=21?"rgba(255,77,109,0.4)":e.dte<=45?"rgba(245,166,35,0.4)":"#282828",
                      color:e.dte<=21?"#ff4d6d":e.dte<=45?"#f5a623":"#555"}}>{e.dte}d</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{overflowX:"auto"}}>
        <table className="chain-table">
          <thead>
            <tr>{["TICKER","SIDE","STRIKE","EXPIRY","DTE","QTY","ENTRY","MID","P&L","P&L%","Δ","Θ","TARGET","STOP","IV","STATUS"]
              .map(c=><th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {positions.length===0
              ? <tr><td colSpan={16} style={{textAlign:"center",padding:16,color:"#2a2a2a"}}>No positions</td></tr>
              : positions.map((p,i)=>{
                  const pct=p.pnl_pct||0, urg=p.dte<=21?"#ff4d6d":p.dte<=45?"#f5a623":null;
                  return (
                    <tr key={i} style={{cursor:"pointer"}} onClick={()=>onTickerOpen&&onTickerOpen(p.ticker)}>
                      <td className="strike-col">{p.ticker}</td>
                      <td style={{color:p.direction==="long"?"#00e5a0":"#ff4d6d",fontSize:10}}>
                        {p.direction?.toUpperCase()} {p.type}</td>
                      <td>{fmt(p.strike)}</td>
                      <td style={{fontSize:10,color:"#555"}}>{p.expiry}</td>
                      <td><span className="dte-badge" style={{fontSize:9,
                        borderColor:urg?"rgba(255,77,109,0.35)":"#282828",color:urg||"#555"}}>{p.dte}d</span></td>
                      <td>{p.contracts}</td>
                      <td style={{color:"#555"}}>${fmt(p.entry_price,2)}</td>
                      <td>${fmt(p.mid,2)}</td>
                      <td style={{color:pnlColor(p.pnl),fontWeight:600}}>{p.pnl>=0?"+":""}{fmtUSD(p.pnl)}</td>
                      <td style={{color:pnlColor(pct)}}>{pct>=0?"+":""}{fmt(pct,1)}%</td>
                      <td>{fmt(p.delta,3)}</td>
                      <td style={{color:p.theta<0?"#ff4d6d":"#00e5a0"}}>{fmt(p.theta,2)}</td>
                      <td style={{color:"#00e5a0",fontSize:10}}>{p.target_price?`$${fmt(p.target_price,2)}`:"—"}</td>
                      <td style={{color:"#ff4d6d",fontSize:10}}>{p.stop_price?`$${fmt(p.stop_price,2)}`:"—"}</td>
                      <td>{fmtPct(p.iv)}</td>
                      <td>{p.alerts?.length
                        ? <span style={{color:"#f5a623",fontSize:10,fontWeight:700}}>⚠ ACT</span>
                        : <span style={{color:"#2a2a2a",fontSize:10}}>HOLD</span>}</td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── StrategyPanel ──────────────────────────────────────────────────────────────
function StrategyPanel({chainData, onLabOpen}) {
  const [mode,setMode] = useState("longcall");
  if (!chainData) return <div className="panel-empty">Load a chain first</div>;
  const {chain=[],spot,iv_rank:ivRank,dte,atm_iv:atmIV} = chainData;

  const strategies = [
    {id:"longcall",name:"LONG CALL",color:"#00e5a0",category:"DEBIT",
     desc:"Directional bullish. Pay premium, profit if stock rises.",
     entryRule:"IV Rank < 30",exitRules:["Sell at 100% profit","Stop at 50% of premium","Exit at 21 DTE"],
     strikeGuide:"ATM or 1-3 strikes OTM.",
     score:ivRank!=null?Math.max(0,100-ivRank*1.8):null,signal:ivRank<30?"BUY":ivRank>55?"AVOID":"NEUTRAL"},
    {id:"longput",name:"LONG PUT",color:"#00e5a0",category:"DEBIT",
     desc:"Directional bearish. Profit if stock falls below strike.",
     entryRule:"IV Rank < 30",exitRules:["Sell at 100% profit","Stop at 50% of premium","Exit at 21 DTE"],
     strikeGuide:"ATM or 1-2 strikes OTM.",
     score:ivRank!=null?Math.max(0,100-ivRank*1.8):null,signal:ivRank<30?"BUY":ivRank>55?"AVOID":"NEUTRAL"},
    {id:"csp",name:"CASH-SECURED PUT",color:"#4da8ff",category:"CREDIT",
     desc:"Sell OTM put. Keep premium or acquire stock at discount.",
     entryRule:"IV Rank > 50, 30-45 DTE",exitRules:["Buy back at 50% profit","Roll if tested","Exit at 21 DTE"],
     strikeGuide:"10-20% OTM.",
     score:ivRank!=null?Math.max(0,ivRank*0.9-Math.abs(dte-37)*0.9+5):null,
     signal:ivRank>50&&dte>=25&&dte<=50?"SELL":ivRank>40?"WATCH":"NEUTRAL"},
    {id:"coveredcall",name:"COVERED CALL",color:"#4da8ff",category:"CREDIT",
     desc:"Sell OTM call against shares. Collect premium, cap upside.",
     entryRule:"IV Rank > 45, own underlying",exitRules:["Buy back at 50% profit","Roll near strike","Let expire OTM"],
     strikeGuide:"10-15% OTM (delta 0.25-0.35).",
     score:ivRank!=null?Math.max(0,ivRank*0.85-Math.abs(dte-30)*0.7):null,
     signal:ivRank>45?"SELL":"NEUTRAL"},
    {id:"ironcondor",name:"IRON CONDOR",color:"#9b6dff",category:"CREDIT",
     desc:"Sell OTM strangle + wings. Profit in range-bound market.",
     entryRule:"IV Rank > 60, 30-45 DTE",exitRules:["Close at 50% max profit","Adjust if short Δ > 0.30","Exit at 21 DTE"],
     strikeGuide:"Short at 1σ (16Δ), wings 5-10pts.",
     score:ivRank!=null?Math.max(0,ivRank-45-Math.abs(dte-37)*0.6):null,
     signal:ivRank>60&&dte>=25&&dte<=50?"SELL":ivRank>45?"WATCH":"AVOID"},
    {id:"vertical",name:"DEBIT SPREAD",color:"#f5a623",category:"DEBIT",
     desc:"Buy near strike, sell further OTM. Lower cost vs naked.",
     entryRule:"Any IV Rank",exitRules:["Close at 75% max profit","Stop at 50% debit paid","Exit at 21 DTE"],
     strikeGuide:"Buy ATM, sell 5-10% OTM.",
     score:ivRank!=null?40+Math.min(35,ivRank*0.5):null,signal:"NEUTRAL"},
  ];

  const sorted = [...strategies].sort((a,b)=>(b.score||0)-(a.score||0));
  const active = strategies.find(s=>s.id===mode)||strategies[0];
  const calls  = chain.filter(r=>r.type==="call").sort((a,b)=>a.strike-b.strike);
  const puts   = chain.filter(r=>r.type==="put").sort((a,b)=>a.strike-b.strike);

  function recStrikes(modeOverride, chainOverride, spotOverride, dteOverride) {
    const _mode  = modeOverride  || mode;
    const _chain = chainOverride || chain;
    const _spot  = spotOverride  || spot;
    const _dte   = dteOverride   || dte;
    const _calls = _chain.filter(r=>r.type==="call").sort((a,b)=>a.strike-b.strike);
    const _puts  = _chain.filter(r=>r.type==="put").sort((a,b)=>a.strike-b.strike);
    function _calls_f(a,b){ return _calls.filter(r=>r.strike>=_spot*a&&r.strike<=_spot*b); }
    function _puts_f(a,b) { return _puts.filter(r=>r.strike>=_spot*a&&r.strike<=_spot*b); }
    switch(_mode) {
      case "longcall":    return _calls.filter(r=>r.strike>=_spot*0.99&&r.strike<=_spot*1.10).slice(0,6).map(r=>({...r,type:"call",note:r.strike<=_spot*1.015?"ATM":`${((r.strike/spot-1)*100).toFixed(1)}%OTM`}));
      case "longput":     return _puts.filter(r=>r.strike<=_spot*1.01&&r.strike>=_spot*0.90).slice(-6).map(r=>({...r,type:"put",note:r.strike>=_spot*0.985?"ATM":`${((1-r.strike/_spot)*100).toFixed(1)}%OTM`}));
      case "csp":         return _puts.filter(r=>r.strike>=_spot*0.82&&r.strike<=_spot*0.97).slice(-6).map(r=>({...r,type:"call",note:`${((1-r.strike/_spot)*100).toFixed(1)}%OTM`,annRet:r.bid&&_dte?`${((r.bid/r.strike)*(365/dte)*100).toFixed(0)}%`:null}));
      case "coveredcall": return _calls.filter(r=>r.strike>=_spot*1.02&&r.strike<=_spot*1.15).slice(0,6).map(r=>({...r,type:"call",note:`${((r.strike/spot-1)*100).toFixed(1)}%OTM`,annRet:r.bid&&_dte?`${((r.bid/_spot)*(365/dte)*100).toFixed(0)}%`:null}));
      case "ironcondor": {
        const sp=_puts.filter(r=>r.strike<=_spot*0.95).slice(-1)[0];
        const sc=_calls.filter(r=>r.strike>=_spot*1.05)[0];
        const lp=_puts.filter(r=>r.strike<=_spot*0.90).slice(-1)[0];
        const lc=_calls.filter(r=>r.strike>=_spot*1.10)[0];
        return [sp,sc,lp,lc].filter(Boolean).map((r,i)=>({...r,type:i<2?"put":"call",note:["SHORT PUT","SHORT CALL","LONG PUT","LONG CALL"][i]}));
      }
      case "vertical": return _calls.filter(r=>r.strike>=_spot*0.99&&r.strike<=_spot*1.08).slice(0,4).map((r,i)=>({...r,note:i===0?"BUY":"SELL"}));
      default: return [];
    }
  }
  const recs = recStrikes(null,null,null,null);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span className="section-label">STRATEGY RANKING</span>
        <span style={{fontSize:10,color:"#444"}}>
          IVR <b style={{color:ivRank<30?"#00e5a0":ivRank>70?"#ff4d6d":"#f5a623"}}>{fmt(ivRank,1)}</b>
          &nbsp;·&nbsp;DTE <b style={{color:"#fff"}}>{dte}</b>
          &nbsp;·&nbsp;ATM IV <b style={{color:"#4da8ff"}}>{fmtPct(atmIV)}</b>
        </span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
        {sorted.map((s,rank)=>{
          const rgb=s.color==="#00e5a0"?"0,229,160":s.color==="#4da8ff"?"77,168,255":s.color==="#9b6dff"?"155,109,255":"245,166,35";
          const on=mode===s.id;
          return (
            <div key={s.id} onClick={()=>setMode(s.id)}
              style={{border:`1px solid ${on?s.color:"#1e1e1e"}`,background:on?`rgba(${rgb},0.05)`:"var(--bg1)",
                padding:"8px 10px",cursor:"pointer",transition:"all 0.15s",position:"relative"}}>
              {rank===0&&<span style={{position:"absolute",top:5,right:6,fontSize:8,color:"#f5a623"}}>★</span>}
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:10,fontWeight:700,color:on?s.color:"#bbb"}}>{s.name}</span>
                <span style={{fontSize:8,color:s.color,background:`rgba(${rgb},0.12)`,padding:"1px 5px"}}>{s.category}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:9,color:signalColor(s.signal),fontWeight:700}}>{s.signal}</span>
                {onLabOpen&&<button onClick={e=>{
                    e.stopPropagation();
                    // Build legs from this strategy's recommended strikes
                    const r2 = recStrikes(s.id, chain, spot, dte);
                    const legs = r2.slice(0,4).map((rec,i)=>({
                      id: i+1,
                      type: rec.type||"call",
                      dir: rec.note?.includes("SHORT")||rec.note==="SELL" ? "short" : "long",
                      strike: rec.strike,
                      iv: rec.iv||atmIV||0.25,
                      qty: 1,
                      dte: dte||30,
                      entry: rec.mid||rec.ask||0,
                    }));
                    onLabOpen(legs);
                  }}
                  style={{background:"none",border:"1px solid #1e1e1e",color:"#333",
                    fontFamily:"var(--mono)",fontSize:8,padding:"1px 6px",cursor:"pointer",
                    transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
                  onMouseLeave={e=>{e.currentTarget.style.color="#333";e.currentTarget.style.borderColor="#1e1e1e";}}>
                  LAB →
                </button>}
              </div>
              {s.score!=null&&(
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{flex:1,height:2,background:"#1a1a1a"}}>
                    <div style={{height:"100%",width:`${Math.min(100,s.score)}%`,background:s.color,transition:"width 0.5s"}}/>
                  </div>
                  <span style={{fontSize:9,color:"#444",width:20,textAlign:"right"}}>{s.score.toFixed(0)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{border:"1px solid #1e1e1e",padding:"10px 12px",background:"var(--bg1)",display:"flex",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:2,minWidth:160}}>
          <div style={{fontSize:11,fontWeight:700,color:active.color,marginBottom:4}}>{active.name}</div>
          <div style={{fontSize:10,color:"#666",lineHeight:1.6,marginBottom:6}}>{active.desc}</div>
          <div style={{fontSize:10,color:"#555"}}><span style={{color:"#444"}}>ENTRY </span><span style={{color:"#ccc"}}>{active.entryRule}</span></div>
          <div style={{fontSize:10,color:"#555",marginTop:4}}>{active.strikeGuide}</div>
        </div>
        <div style={{flex:1,minWidth:140}}>
          <div style={{fontSize:10,color:"#444",letterSpacing:"0.08em",marginBottom:5}}>EXIT RULES</div>
          {active.exitRules.map((r,i)=>(
            <div key={i} style={{display:"flex",gap:6,marginBottom:4,fontSize:10}}>
              <span style={{color:i===0?"#00e5a0":i===1?"#ff4d6d":"#f5a623",flexShrink:0}}>{i===0?"✓":i===1?"✗":"⏱"}</span>
              <span style={{color:"#555",lineHeight:1.4}}>{r}</span>
            </div>
          ))}
        </div>
      </div>
      {recs.length>0&&(
        <div>
          <div className="section-label" style={{marginBottom:6}}>STRIKES — {active.name}</div>
          <table className="chain-table">
            <thead><tr>
              <th>NOTE</th><th>STRIKE</th><th>BID</th><th>ASK</th><th>MID</th>
              <th>IV</th><th>Δ</th><th>Θ</th>{recs[0]?.annRet!==undefined&&<th>ANN</th>}
            </tr></thead>
            <tbody>
              {recs.map((r,i)=>(
                <tr key={i} style={{borderLeft:r.note?.includes("SHORT")||r.note==="SELL"?"2px solid #ff4d6d":r.note==="BUY"||r.note==="ATM"?"2px solid #00e5a0":"none"}}>
                  <td style={{color:"#f5a623",fontSize:10}}>{r.note}</td>
                  <td className="strike-col">{fmt(r.strike)}</td>
                  <td>{fmt(r.bid,2)}</td><td>{fmt(r.ask,2)}</td>
                  <td style={{color:"#fff",fontWeight:600}}>{fmt(r.mid,2)}</td>
                  <td>{fmtPct(r.iv)}</td>
                  <td style={{color:r.delta>0?"#00e5a0":"#ff4d6d"}}>{fmt(r.delta,3)}</td>
                  <td style={{color:"#ff4d6d"}}>{fmt(r.theta,3)}</td>
                  {r.annRet!==undefined&&<td style={{color:"#4da8ff",fontSize:10}}>{r.annRet||"—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Black-Scholes (client-side, no API calls needed) ──────────────────────────

function normCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x<0 ? -1 : 1;
  x = Math.abs(x)/Math.sqrt(2);
  const t = 1/(1+p*x);
  const y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}
function normPDF(x){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

function bsPrice(S,K,T,r,sigma,type){
  if(T<=0||sigma<=0) return Math.max(0, type==="call"?S-K:K-S);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  if(type==="call") return S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2);
  return K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
}

function bsGreeks(S,K,T,r,sigma,type){
  if(T<=0||sigma<=0) return {delta:type==="call"&&S>K?1:0,gamma:0,theta:0,vega:0,rho:0};
  const sqT=Math.sqrt(T);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*sqT);
  const d2=d1-sigma*sqT;
  const pdf=normPDF(d1);
  const gamma=pdf/(S*sigma*sqT);
  const vega=S*pdf*sqT/100;
  if(type==="call"){
    return {
      delta:normCDF(d1),gamma,vega,
      theta:(-S*pdf*sigma/(2*sqT)-r*K*Math.exp(-r*T)*normCDF(d2))/365,
      rho:K*T*Math.exp(-r*T)*normCDF(d2)/100
    };
  }
  return {
    delta:normCDF(d1)-1,gamma,vega,
    theta:(-S*pdf*sigma/(2*sqT)+r*K*Math.exp(-r*T)*normCDF(-d2))/365,
    rho:-K*T*Math.exp(-r*T)*normCDF(-d2)/100
  };
}

// Build payoff data for a set of legs at a given DTE fraction
function calcPayoff(legs, spotRange, dteRatio, r=0.04){
  return spotRange.map(S=>{
    let total=0, totalAtExpiry=0;
    legs.forEach(leg=>{
      const sign = leg.dir==="long"?1:-1;
      const T    = Math.max(0, leg.dte * dteRatio / 365);
      const Texp = 0;
      const pNow = bsPrice(S, leg.strike, T, r, leg.iv, leg.type);
      const pExp = bsPrice(S, leg.strike, Texp, r, leg.iv, leg.type);
      total         += sign*(pNow - leg.entry)*100*leg.qty;
      totalAtExpiry += sign*(pExp - leg.entry)*100*leg.qty;
    });
    return {S:parseFloat(S.toFixed(2)), pnl:parseFloat(total.toFixed(2)), expiry:parseFloat(totalAtExpiry.toFixed(2))};
  });
}

const LEG_COLORS = ["#00e5a0","#4da8ff","#f5a623","#ff4d6d","#9b6dff","#00bcd4"];

function LabPanel({chainData, seedLegs, onClose}){
  const spot0 = chainData?.spot || 100;
  const dte0  = chainData?.dte  || 30;
  const r     = chainData?.risk_free || 0.04;
  const chain = chainData?.chain || [];

  // Leg state — each: {id,type,dir,strike,iv,qty,dte,entry}
  const [legs,setLegs] = useState(()=>{
    if(seedLegs&&seedLegs.length) return seedLegs;
    // Default: ATM call
    const calls = chain.filter(c=>c.type==="call").sort((a,b)=>Math.abs(a.strike-spot0)-Math.abs(b.strike-spot0));
    const atm   = calls[0];
    return atm ? [{id:1,type:"call",dir:"long",strike:atm.strike,iv:atm.iv||0.25,qty:1,dte:dte0,entry:atm.mid||atm.ask||0}] : [];
  });
  const [nextLegId,setNextLegId] = useState(10);

  // Sliders
  const [spotAdj,setSpotAdj] = useState(0);         // % adjustment from spot0
  const [dteAdj,setDteAdj]   = useState(100);        // % of original DTE remaining
  const [ivShift,setIvShift] = useState(0);          // additive IV shift in decimal
  const [contracts,setContracts] = useState(1);
  const [chartMode,setChartMode] = useState("simple"); // "simple" | "multi"

  const spot = spot0*(1+spotAdj/100);

  // Available strikes from chain
  const strikes = [...new Set(chain.map(r=>r.strike))].sort((a,b)=>a-b);
  const expiries = chainData?.expiries || [];

  const updateLeg = (id,patch) => setLegs(prev=>prev.map(l=>l.id===id?{...l,...patch}:l));
  const removeLeg = id => setLegs(prev=>prev.filter(l=>l.id!==id));
  const addLeg = () => {
    const atm = strikes.reduce((a,b)=>Math.abs(a-spot)<Math.abs(b-spot)?a:b, strikes[0]||spot0);
    const row = chain.find(c=>c.strike===atm&&c.type==="call");
    setLegs(prev=>[...prev,{id:nextLegId,type:"call",dir:"long",strike:atm,
      iv:row?.iv||0.25,qty:1,dte:dte0,entry:row?.mid||0}]);
    setNextLegId(n=>n+1);
  };

  // Payoff chart data
  const lo = spot0*0.75, hi = spot0*1.25;
  const N  = 80;
  const spotRange = Array.from({length:N},(_,i)=>lo+(hi-lo)*i/(N-1));

  const effectiveLegs = legs.map(l=>({...l, iv:Math.max(0.01,(l.iv||0.25)+ivShift), qty:l.qty*contracts}));
  const payoffData    = calcPayoff(effectiveLegs, spotRange, dteAdj/100, r);

  // Greeks at current spot
  const netGreeks = effectiveLegs.reduce((acc,l)=>{
    const sign = l.dir==="long"?1:-1;
    const T    = Math.max(0.001, l.dte*(dteAdj/100)/365);
    const g    = bsGreeks(spot, l.strike, T, r, l.iv||0.25, l.type);
    const mult = sign*100*l.qty;
    return {
      delta: acc.delta+g.delta*mult,
      gamma: acc.gamma+g.gamma*mult,
      theta: acc.theta+g.theta*mult,
      vega:  acc.vega+g.vega*mult,
      value: acc.value+sign*bsPrice(spot,l.strike,T,r,l.iv||0.25,l.type)*100*l.qty,
      cost:  acc.cost+sign*l.entry*100*l.qty,
    };
  },{delta:0,gamma:0,theta:0,vega:0,value:0,cost:0});
  const unrealizedPnl = netGreeks.value - netGreeks.cost;

  // Max profit/loss and breakevens from expiry data
  const expiryPnls = payoffData.map(d=>d.expiry);
  const maxProfit  = Math.max(...expiryPnls);
  const maxLoss    = Math.min(...expiryPnls);
  const breakevens = [];
  for(let i=1;i<payoffData.length;i++){
    const a=payoffData[i-1].expiry, b=payoffData[i].expiry;
    if((a<0&&b>=0)||(a>=0&&b<0)){
      const S=payoffData[i-1].S+(payoffData[i].S-payoffData[i-1].S)*(0-a)/(b-a);
      breakevens.push(S.toFixed(2));
    }
  }

  // Chart Y domain with padding
  const allVals = payoffData.flatMap(d=>[d.pnl,d.expiry]);
  const yMin = Math.min(...allVals)*1.1, yMax = Math.max(...allVals)*1.1;
  const yDom = [Math.min(yMin,-50), Math.max(yMax,50)];

  const SliderRow = ({label,value,min,max,step,onChange,display}) => (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <span style={{fontSize:9,color:"#444",letterSpacing:"0.08em",width:80,flexShrink:0}}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{flex:1,accentColor:"var(--green)",cursor:"pointer"}}/>
      <span style={{fontSize:10,color:"#ccc",width:60,textAlign:"right",flexShrink:0}}>{display}</span>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,padding:"10px 14px",overflow:"auto",flex:1}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid var(--border)",paddingBottom:8}}>
        <span className="section-label">OPTIONS LAB</span>
        <span style={{fontSize:10,color:"#444"}}>
          {chainData?.ticker} · ${fmt(spot)} · {Math.round(dte0*(dteAdj/100))}d remaining
        </span>
        <button onClick={addLeg}
          style={{marginLeft:"auto",background:"var(--green)",border:"none",color:"#000",
            fontFamily:"var(--mono)",fontSize:10,fontWeight:700,padding:"3px 10px",cursor:"pointer"}}>
          + ADD LEG
        </button>
        {onClose&&<button onClick={onClose}
          style={{background:"none",border:"1px solid var(--border2)",color:"#555",
            fontFamily:"var(--mono)",fontSize:10,padding:"3px 8px",cursor:"pointer",
            transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}}
          onMouseLeave={e=>{e.currentTarget.style.color="#555";e.currentTarget.style.borderColor="var(--border2)";}}>
          ✕ CLOSE
        </button>}
      </div>

      {/* Legs */}
      {legs.length===0&&(
        <div style={{padding:"12px",fontSize:10,color:"#333",textAlign:"center",
          border:"1px dashed var(--border2)"}}>No legs — click + ADD LEG or click a strike in the chain</div>
      )}
      {legs.map((leg,i)=>{
        const color = LEG_COLORS[i%LEG_COLORS.length];
        const sign  = leg.dir==="long"?1:-1;
        const T     = Math.max(0.001,leg.dte*(dteAdj/100)/365);
        const curP  = bsPrice(spot,leg.strike,T,r,(leg.iv||0.25)+ivShift,leg.type);
        const legPnl= sign*(curP-leg.entry)*100*leg.qty*contracts;
        return (
          <div key={leg.id} style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",
            padding:"7px 10px",border:`1px solid rgba(${color==="var(--green)"?"0,229,160":color==="#4da8ff"?"77,168,255":color==="#f5a623"?"245,166,35":color==="#ff4d6d"?"255,77,109":"155,109,255"},0.2)`,
            background:"var(--bg1)",borderLeft:`3px solid ${color}`}}>
            {/* Type */}
            <select value={leg.type} onChange={e=>updateLeg(leg.id,{type:e.target.value})}
              className="expiry-select" style={{width:56}}>
              <option value="call">CALL</option>
              <option value="put">PUT</option>
            </select>
            {/* Direction */}
            <select value={leg.dir} onChange={e=>updateLeg(leg.id,{dir:e.target.value})}
              className="expiry-select" style={{width:62}}>
              <option value="long">LONG</option>
              <option value="short">SHORT</option>
            </select>
            {/* Strike */}
            <select value={leg.strike} onChange={e=>updateLeg(leg.id,{strike:Number(e.target.value),
              entry:(chain.find(c=>c.strike===Number(e.target.value)&&c.type===leg.type)?.mid||leg.entry)})}
              className="expiry-select" style={{width:76}}>
              {strikes.map(k=><option key={k} value={k}>${k}</option>)}
            </select>
            {/* IV */}
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:9,color:"#444"}}>IV</span>
              <input type="number" value={((leg.iv||0.25)*100).toFixed(1)}
                onChange={e=>updateLeg(leg.id,{iv:Math.max(0.01,Number(e.target.value)/100)})}
                style={{width:52,background:"var(--bg2)",border:"1px solid var(--border2)",
                  color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 4px",textAlign:"right"}}/>
              <span style={{fontSize:9,color:"#444"}}>%</span>
            </div>
            {/* Qty */}
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:9,color:"#444"}}>QTY</span>
              <input type="number" min={1} max={100} value={leg.qty}
                onChange={e=>updateLeg(leg.id,{qty:Math.max(1,parseInt(e.target.value)||1)})}
                style={{width:40,background:"var(--bg2)",border:"1px solid var(--border2)",
                  color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 4px",textAlign:"right"}}/>
            </div>
            {/* Entry */}
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:9,color:"#444"}}>ENTRY</span>
              <input type="number" step={0.01} value={leg.entry.toFixed(2)}
                onChange={e=>updateLeg(leg.id,{entry:Math.max(0,Number(e.target.value))})}
                style={{width:54,background:"var(--bg2)",border:"1px solid var(--border2)",
                  color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 4px",textAlign:"right"}}/>
            </div>
            {/* Live P&L */}
            <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:pnlColor(legPnl)}}>
              {legPnl>=0?"+":""}{fmtUSD(legPnl)}
            </span>
            <button onClick={()=>removeLeg(leg.id)}
              style={{background:"none",border:"none",color:"#333",cursor:"pointer",
                fontSize:14,padding:0,fontFamily:"var(--mono)",transition:"color 0.15s"}}
              onMouseEnter={e=>e.target.style.color="var(--red)"}
              onMouseLeave={e=>e.target.style.color="#333"}>×</button>
          </div>
        );
      })}

      {/* Sliders */}
      <div style={{border:"1px solid var(--border)",padding:"10px 12px",background:"var(--bg1)"}}>
        <div style={{fontSize:9,color:"#444",letterSpacing:"0.1em",marginBottom:8}}>SCENARIO</div>
        <SliderRow label="UNDERLYING" value={spotAdj} min={-25} max={25} step={0.5}
          onChange={setSpotAdj} display={`$${fmt(spot)} (${spotAdj>=0?"+":""}${spotAdj}%)`}/>
        <SliderRow label="DTE" value={dteAdj} min={0} max={100} step={1}
          onChange={setDteAdj} display={`${Math.round(dte0*dteAdj/100)}d (${dteAdj}%)`}/>
        <SliderRow label="IV SHIFT" value={Math.round(ivShift*100)} min={-30} max={30} step={1}
          onChange={v=>setIvShift(v/100)} display={`${ivShift>=0?"+":""}${(ivShift*100).toFixed(0)}%`}/>
        <SliderRow label="CONTRACTS" value={contracts} min={1} max={50} step={1}
          onChange={setContracts} display={`${contracts}×`}/>
      </div>

      {/* Payoff chart */}
      <div style={{border:"1px solid var(--border)",padding:"10px 12px",background:"var(--bg1)"}}>
        <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:9,color:"#444",letterSpacing:"0.1em",flex:1}}>PAYOFF DIAGRAM</span>
          <div style={{display:"flex",gap:2}}>
            {["simple","multi"].map(m=>(
              <button key={m} onClick={()=>setChartMode(m)}
                style={{background:chartMode===m?"var(--green)":"none",
                  border:"1px solid var(--border2)",
                  color:chartMode===m?"#000":"#555",fontFamily:"var(--mono)",
                  fontSize:9,padding:"2px 8px",cursor:"pointer",letterSpacing:"0.06em"}}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={payoffData} margin={{top:4,right:8,bottom:4,left:48}}>
            <XAxis dataKey="S" type="number" domain={[lo,hi]}
              tickFormatter={v=>`$${v.toFixed(0)}`}
              tick={{fontSize:9,fill:"#444"}} tickLine={false} axisLine={false}/>
            <YAxis domain={yDom} tickFormatter={v=>v>=0?`+$${v.toFixed(0)}`:`-$${Math.abs(v).toFixed(0)}`}
              tick={{fontSize:9,fill:"#444"}} tickLine={false} axisLine={false} width={46}/>
            <Tooltip
              contentStyle={{background:"#111",border:"1px solid #232323",fontSize:10}}
              formatter={(v,n)=>[`${v>=0?"+":""}$${v.toFixed(2)}`,n==="pnl"?"Now":"Expiry"]}
              labelFormatter={v=>`$${Number(v).toFixed(2)}`}/>
            {/* Zero line */}
            <Line type="monotone" dataKey={()=>0} stroke="#222" strokeWidth={1} dot={false} legendType="none" tooltipType="none"/>
            {/* Current spot line — reference line via custom dot */}
            {chartMode==="simple"&&(
              <Line type="monotone" dataKey="expiry" stroke="#00e5a0" strokeWidth={2}
                dot={false} name="Expiry"/>
            )}
            {chartMode==="simple"&&(
              <Line type="monotone" dataKey="pnl" stroke="#4da8ff" strokeWidth={1.5}
                dot={false} strokeDasharray="4 3" name="Now"/>
            )}
            {chartMode==="multi"&&legs.map((leg,i)=>{
              const c=LEG_COLORS[i%LEG_COLORS.length];
              const sign=leg.dir==="long"?1:-1;
              return (
                <Line key={leg.id} type="monotone"
                  dataKey={d=>sign*(bsPrice(d.S,leg.strike,0,r,(leg.iv||0.25)+ivShift,leg.type)-leg.entry)*100*leg.qty*contracts}
                  stroke={c} strokeWidth={1} dot={false} strokeDasharray="3 2"
                  name={`${leg.dir} ${leg.type} ${leg.strike}`}/>
              );
            })}
            {chartMode==="multi"&&(
              <Line type="monotone" dataKey="expiry" stroke="#fff" strokeWidth={2.5}
                dot={false} name="Combined"/>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Greeks + stats */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {/* Net Greeks */}
        <div style={{flex:2,minWidth:200,border:"1px solid var(--border)",
          padding:"8px 12px",background:"var(--bg1)"}}>
          <div style={{fontSize:9,color:"#444",letterSpacing:"0.1em",marginBottom:8}}>NET GREEKS</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
            {[["Δ DELTA",netGreeks.delta.toFixed(3),netGreeks.delta>0?"#00e5a0":netGreeks.delta<0?"#ff4d6d":"#555"],
              ["Γ GAMMA",netGreeks.gamma.toFixed(4),"#4da8ff"],
              ["Θ THETA",`${netGreeks.theta.toFixed(2)}/d`,netGreeks.theta<0?"#ff4d6d":"#00e5a0"],
              ["V VEGA", netGreeks.vega.toFixed(3),"#9b6dff"],
              ["P&L NOW",`${unrealizedPnl>=0?"+":""}$${unrealizedPnl.toFixed(2)}`,pnlColor(unrealizedPnl)],
            ].map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:9,color:"#444"}}>{l}</span>
                <span style={{fontSize:11,fontWeight:700,color:c}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Trade stats */}
        <div style={{flex:1,minWidth:140,border:"1px solid var(--border)",
          padding:"8px 12px",background:"var(--bg1)"}}>
          <div style={{fontSize:9,color:"#444",letterSpacing:"0.1em",marginBottom:8}}>TRADE STATS</div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:9,color:"#444"}}>MAX PROFIT</span>
              <span style={{fontSize:11,fontWeight:700,color:"#00e5a0"}}>
                {maxProfit>9999?"UNLIMITED":`+$${maxProfit.toFixed(0)}`}
              </span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:9,color:"#444"}}>MAX LOSS</span>
              <span style={{fontSize:11,fontWeight:700,color:"#ff4d6d"}}>
                {maxLoss<-9999?"UNLIMITED":`-$${Math.abs(maxLoss).toFixed(0)}`}
              </span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <span style={{fontSize:9,color:"#444"}}>BREAKEVEN</span>
              <span style={{fontSize:10,color:"#f5a623",textAlign:"right"}}>
                {breakevens.length?breakevens.map(b=>`$${b}`).join(" / "):"—"}
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function Sidebar({open,serverStatus,onStop,portData,onOpenTicker,
                  view,setView,watchlist,setWatchlist,liveSpots,
                  settings,setSettings,recentTickers,fetchPortfolio}) {

  const [sections,setSections] = useState(()=>
    recall("optflow_sidebar_sections",
      {views:true,watchlist:true,positions:false,settings:false,
       settings_keys:false,settings_import:false,settings_brokers:false}));

  const toggle = k => {
    const next={...sections,[k]:!sections[k]};
    setSections(next); persist("optflow_sidebar_sections",next);
  };

  // API keys state
  const [envData,setEnvData]       = useState({});
  const [polyKey,setPolyKey]       = useState("");
  const [tradierKey,setTradierKey] = useState("");
  const [keyMsg,setKeyMsg]         = useState("");

  // Portfolio import state
  const [positions,setPositions]   = useState([]);
  const [importMsg,setImportMsg]   = useState("");
  const [saveMsg,setSaveMsg]       = useState("");

  // Watchlist input
  const [watchInput,setWatchInput] = useState("");

  const loadEnv = useCallback(async()=>{
    try {
      const r = await fetch(`${API}/config/env`);
      if (r.ok) setEnvData(await r.json());
    } catch {}
  },[]);

  useEffect(()=>{ if (open) loadEnv(); },[open,loadEnv]);

  const saveKey = async(keyObj) => {
    try {
      const r = await fetch(`${API}/config/env`,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(keyObj)});
      if (!r.ok) throw new Error(r.status);
      setKeyMsg("Saved ✓ — restart API to apply"); loadEnv();
      setTimeout(()=>setKeyMsg(""),3000);
    } catch(e){ setKeyMsg("Save failed: "+e.message); }
  };

  // CSV parser (moved from launcher.html)
  const parseCSVLine = line => {
    const result=[]; let cur="",inQ=false;
    for (const c of line) {
      if (c==='"') inQ=!inQ;
      else if (c===','&&!inQ) { result.push(cur.trim()); cur=""; }
      else cur+=c;
    }
    result.push(cur.trim()); return result;
  };

  const parseRHRow = (row,headers) => {
    const r={};
    headers.forEach((h,i)=>{ r[h]=(row[i]||"").trim().replace(/^"|"$/g,""); });
    const OTRANS={BTO:1,STC:1,BTC:1,STO:1};
    const trans=(r["Trans Code"]||"").trim().toUpperCase();
    if (!OTRANS[trans]) return null;
    const instrument=(r["Instrument"]||"").trim();
    const desc=(r["Description"]||"").trim();
    const qty=(r["Quantity"]||"0").replace(/[^0-9.]/g,"");
    const priceStr=(r["Price"]||"0").replace(/[$,()]/g,"");
    const dateStr=(r["Activity Date"]||r["Process Date"]||"").trim();
    let entryDate="";
    const dm=dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (dm){ const ey=parseInt(dm[3])+(parseInt(dm[3])<100?2000:0);
      entryDate=ey+"-"+dm[1].padStart(2,"0")+"-"+dm[2].padStart(2,"0"); }
    let ticker="",optType="call",strike=0,expiry="";
    const occ=instrument.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
    if (occ){
      ticker=occ[1]; optType=occ[3]==="C"?"call":"put"; strike=parseInt(occ[4])/1000;
      const yd="20"+occ[2]; expiry=yd.slice(0,4)+"-"+yd.slice(4,6)+"-"+yd.slice(6,8);
    } else {
      const tm=instrument.match(/^([A-Z]+)/); ticker=tm?tm[1]:instrument;
      const descM=desc.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(Call|Put)\s+\$(\d+\.?\d*)/i);
      if (descM){
        const [,mo,dy,yr,type,stk]=descM;
        expiry=yr+"-"+mo.padStart(2,"0")+"-"+dy.padStart(2,"0");
        optType=type.toLowerCase(); strike=parseFloat(stk);
      }
    }
    return {ticker,type:optType,strike:Math.round(strike*100)/100,expiry,
      contracts:Math.max(1,Math.abs(parseInt(qty)||1)),
      entry_price:Math.abs(parseFloat(priceStr)||0),
      entry_date:entryDate,direction:trans==="STO"?"short":"long",
      _close:trans==="STC"||trans==="BTC"};
  };

  const handleFile = e => {
    const file=e.target.files[0]; if (!file) return;
    setImportMsg("Reading…");
    const reader=new FileReader();
    reader.onload=ev=>{
      setTimeout(()=>{
        try {
          if (file.name.endsWith(".json")){
            setPositions(JSON.parse(ev.target.result));
            setImportMsg("Loaded JSON ✓"); return;
          }
          const lines=ev.target.result.split("\n").filter(l=>l.trim());
          const headers=parseCSVLine(lines[0]);
          const isRH=headers.some(h=>h.trim()==="Trans Code");
          if (isRH){
            let parsed=[],skipped=0,closes=0;
            for (let i=1;i<lines.length;i++){
              const pos=parseRHRow(parseCSVLine(lines[i]),headers);
              if (!pos){skipped++;continue;}
              if (pos._close) closes++;
              delete pos._close; parsed.push(pos);
            }
            setPositions(parsed);
            setImportMsg(`${parsed.length} options loaded${skipped?`, ${skipped} skipped`:""}${closes?` (${closes} closing trades)`:""}`);;
          } else {
            const rows=lines.slice(1).map(line=>{
              const vals=parseCSVLine(line),obj={};
              headers.forEach((h,i)=>{obj[h.trim()]=vals[i]||"";});
              obj.strike=parseFloat(obj.strike)||0;
              obj.contracts=parseInt(obj.contracts)||1;
              obj.entry_price=parseFloat(obj.entry_price)||0;
              return obj;
            }).filter(o=>o.ticker);
            setPositions(rows);
            setImportMsg(`${rows.length} positions loaded`);
          }
        } catch(err){ setImportMsg("Parse error: "+err.message); }
      },20);
    };
    reader.readAsText(file);
  };

  const savePortfolio = async() => {
    const KEEP=["ticker","type","strike","expiry","contracts","entry_price","entry_date","direction"];
    const clean=positions.map(p=>{
      const o={};
      KEEP.forEach(k=>{if(p[k]!==undefined)o[k]=p[k];});
      o.strike=parseFloat(o.strike)||0;
      o.contracts=parseInt(o.contracts)||1;
      o.entry_price=parseFloat(o.entry_price)||0;
      o.ticker=(o.ticker||"").toUpperCase();
      o.type=(o.type||"call").toLowerCase();
      o.direction=(o.direction||"long").toLowerCase();
      return o;
    }).filter(p=>p.ticker);
    if (!clean.length){setSaveMsg("Nothing to save");return;}
    try {
      const r=await fetch(`${API}/config/portfolio`,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(clean)});
      if (!r.ok){ const b=await r.text(); throw new Error(`HTTP ${r.status}: ${b.slice(0,80)}`); }
      setSaveMsg(`Saved ${clean.length} positions ✓`);
      setTimeout(()=>setSaveMsg(""),3000);
      fetchPortfolio();
    } catch(e){ setSaveMsg("Save failed: "+e.message); }
  };

  const addWatch=()=>{
    const t=watchInput.trim().toUpperCase();
    if(!t||watchlist.includes(t)) return;
    const next=[...watchlist,t].slice(0,20);
    setWatchlist(next); persist("optflow_watchlist",next); setWatchInput("");
  };
  const removeWatch=t=>{ const next=watchlist.filter(w=>w!==t); setWatchlist(next); persist("optflow_watchlist",next); };

  // Status color helpers
  const apiColor  = serverStatus.api   ==="up" ?"#00e5a0":"serverStatus.api==='checking'"?"#f5a623":"#ff4d6d";
  const tradierOk = serverStatus.tradier_active;
  const polyOk    = serverStatus.polygon_active;

  return (
    <div style={{
      width: open ? SIDEBAR_W : 0,
      minWidth: open ? SIDEBAR_W : 0,
      transition:"width 0.22s cubic-bezier(0.4,0,0.2,1)",
      overflow:"hidden",flexShrink:0,
      borderRight:"1px solid var(--border)",
      background:"var(--bg1)",display:"flex",flexDirection:"column",
    }}>
      <div style={{width:SIDEBAR_W,display:"flex",flexDirection:"column",height:"100%",overflowY:"auto",overflowX:"hidden"}}>

        {/* ── Always-visible header: status + stop ── */}
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{color:"var(--green)",fontSize:15}}>◈</span>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.15em",color:"#fff"}}>OPTFLOW</span>
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:7,height:7,borderRadius:"50%",display:"inline-block",
                background:serverStatus.api==="up"?"#00e5a0":serverStatus.api==="checking"?"#f5a623":"#ff4d6d",
                boxShadow:serverStatus.api==="up"?"0 0 6px #00e5a0":"none"}}/>
              <span style={{fontSize:9,color:"#555",letterSpacing:"0.1em"}}>
                {serverStatus.api==="up"?"RUNNING":serverStatus.api==="checking"?"CHECKING":"DOWN"}
              </span>
            </div>
          </div>
          {/* Data source chips */}
          <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
            <span style={{fontSize:9,padding:"2px 6px",border:"1px solid",
              borderColor:tradierOk?"rgba(0,229,160,0.3)":"#1e1e1e",
              color:tradierOk?"#00e5a0":"#333",letterSpacing:"0.06em"}}>
              {tradierOk?"● ":"○ "}TRADIER
            </span>
            <span style={{fontSize:9,padding:"2px 6px",border:"1px solid",
              borderColor:polyOk?"rgba(0,229,160,0.3)":"#1e1e1e",
              color:polyOk?"#00e5a0":"#333",letterSpacing:"0.06em"}}>
              {polyOk?"● ":"○ "}POLYGON
            </span>
            {serverStatus.data_source&&(
              <span style={{fontSize:9,color:"#444",padding:"2px 0"}}>{serverStatus.data_source}</span>
            )}
          </div>
          {/* Stop Session */}
          <button onClick={onStop} className="stop-btn" style={{width:"100%",padding:"5px",fontSize:10}}>
            ■ STOP SESSION
          </button>
        </div>

        {/* ── VIEWS ── */}
        <SideSection label="VIEWS" open={sections.views} onToggle={()=>toggle("views")}>
          {[["portfolio","▤ PORTFOLIO"],["chain","◫ CHAIN"],["strategy","◆ STRATEGY"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} className="side-nav-btn"
              style={{borderLeft:`2px solid ${view===v?"var(--green)":"transparent"}`,
                color:view===v?"var(--green)":"#666",
                background:view===v?"rgba(0,229,160,0.04)":"none"}}>
              {label}
            </button>
          ))}
        </SideSection>

        {/* ── WATCHLIST ── */}
        <SideSection label="WATCHLIST" open={sections.watchlist} onToggle={()=>toggle("watchlist")}>
          <div style={{padding:"6px 12px 8px"}}>
            <div style={{display:"flex",gap:4}}>
              <input value={watchInput} onChange={e=>setWatchInput(e.target.value.toUpperCase())}
                onKeyDown={e=>e.key==="Enter"&&addWatch()} placeholder="ADD TICKER" maxLength={6}
                className="side-input"/>
              <button onClick={addWatch} className="side-add-btn">+</button>
            </div>
          </div>
          {watchlist.length===0&&<div style={{padding:"6px 12px",fontSize:10,color:"#333"}}>No tickers</div>}
          {watchlist.map(t=>(
            <div key={t} className="watch-row" onClick={()=>onOpenTicker(t)}>
              <span style={{fontWeight:700,color:"#fff",fontSize:11,width:48}}>{t}</span>
              <span style={{color:"#00e5a0",fontSize:11,marginLeft:"auto"}}>
                {liveSpots[t]?`$${fmt(liveSpots[t])}`:"—"}
              </span>
              <button onClick={e=>{e.stopPropagation();removeWatch(t);}} className="remove-btn">×</button>
            </div>
          ))}
        </SideSection>

        {/* ── POSITIONS quick-view ── */}
        <SideSection label="POSITIONS" open={sections.positions} onToggle={()=>toggle("positions")}
          badge={portData?.alerts?.length||null}>
          {(!portData?.positions?.length)
            ? <div style={{padding:"6px 12px",fontSize:10,color:"#333"}}>No positions</div>
            : portData.positions.map((p,i)=>(
              <div key={i} className="watch-row" onClick={()=>{onOpenTicker(p.ticker);setView("chain");}}>
                <span style={{fontWeight:700,color:"#fff",width:42,fontSize:10}}>{p.ticker}</span>
                <span style={{color:"#555",fontSize:9}}>{p.type[0].toUpperCase()} {fmt(p.strike)}</span>
                <span style={{marginLeft:"auto",color:pnlColor(p.pnl),fontWeight:600,fontSize:10}}>
                  {p.pnl>=0?"+":""}{fmtUSD(p.pnl)}</span>
                {p.alerts?.length>0&&<span style={{color:"#f5a623",fontSize:10}}>⚠</span>}
              </div>
            ))}
          <div style={{padding:"6px 12px 8px"}}>
            <button onClick={()=>setView("portfolio")} className="side-outline-btn">VIEW PORTFOLIO →</button>
          </div>
        </SideSection>

        {/* ── SETTINGS (contains API keys, portfolio import, brokers, display) ── */}
        <SideSection label="SETTINGS" open={sections.settings} onToggle={()=>toggle("settings")}>

          {/* Display */}
          <div style={{padding:"8px 14px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
            <div style={{fontSize:9,color:"#444",letterSpacing:"0.12em",marginBottom:8}}>DISPLAY</div>
            {[["Chain rows",settings.chainRows,[10,20,30,50],"chainRows"],
              ["Auto-refresh",settings.autoRefresh,["on","off"],"autoRefresh"]
            ].map(([label,val,opts,key])=>(
              <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:10,color:"#555"}}>{label}</span>
                <div style={{display:"flex",gap:2}}>
                  {opts.map(o=>(
                    <button key={o} onClick={()=>{ const n={...settings,[key]:o}; setSettings(n); persist("optflow_settings",n); }}
                      style={{background:String(val)===String(o)?"var(--green)":"var(--bg2)",
                        border:"1px solid var(--border2)",color:String(val)===String(o)?"#000":"#555",
                        fontFamily:"var(--mono)",fontSize:10,padding:"2px 8px",cursor:"pointer"}}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* API Keys sub-section */}
          <SideSection label="API KEYS" open={sections.settings_keys} onToggle={()=>toggle("settings_keys")} indent>
            <div style={{padding:"6px 14px",display:"flex",flexDirection:"column",gap:8}}>
              {Object.entries(envData).map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:10}}>
                  <span style={{color:"#4da8ff"}}>{k}</span>
                  <span style={{color:v?"#00e5a0":"#333",fontSize:9}}>{v?"● SET":"○ NOT SET"}</span>
                </div>
              ))}
              <div>
                <div style={{fontSize:9,color:"#444",marginBottom:3}}>POLYGON KEY</div>
                <div style={{display:"flex",gap:4}}>
                  <input type="password" value={polyKey} onChange={e=>setPolyKey(e.target.value)}
                    placeholder="polygon.io" className="side-input"/>
                  <button onClick={()=>{if(polyKey.trim()){saveKey({POLYGON_API_KEY:polyKey.trim()});setPolyKey("");}}}
                    className="side-add-btn">✓</button>
                </div>
              </div>
              <div>
                <div style={{fontSize:9,color:"#444",marginBottom:3}}>TRADIER TOKEN</div>
                <div style={{display:"flex",gap:4}}>
                  <input type="password" value={tradierKey} onChange={e=>setTradierKey(e.target.value)}
                    placeholder="tradier.com" className="side-input"/>
                  <button onClick={()=>{if(tradierKey.trim()){saveKey({TRADIER_TOKEN:tradierKey.trim()});setTradierKey("");}}}
                    className="side-add-btn">✓</button>
                </div>
              </div>
              {keyMsg&&<div style={{fontSize:10,color:"#00e5a0"}}>{keyMsg}</div>}
            </div>
          </SideSection>

          {/* Portfolio Import sub-section */}
          <SideSection label="PORTFOLIO IMPORT" open={sections.settings_import} onToggle={()=>toggle("settings_import")} indent>
            <div style={{padding:"6px 14px",display:"flex",flexDirection:"column",gap:8}}>
              <label style={{display:"flex",flexDirection:"column",alignItems:"center",
                border:"1px dashed var(--border2)",padding:"10px 8px",cursor:"pointer",
                fontSize:10,color:"#555",gap:3,transition:"all 0.15s",textAlign:"center"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--green)";e.currentTarget.style.color="var(--green)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border2)";e.currentTarget.style.color="#555";}}>
                <span style={{fontSize:14}}>↑</span>
                <span>Robinhood CSV or positions.json</span>
                <input type="file" accept=".csv,.json" onChange={handleFile} style={{display:"none"}}/>
              </label>
              {importMsg&&<div style={{fontSize:10,color:"#00e5a0"}}>{importMsg}</div>}
              {positions.length>0&&(
                <>
                  <div style={{fontSize:10,color:"#555"}}>{positions.length} position{positions.length!==1?"s":""} ready</div>
                  <button onClick={savePortfolio} className="side-add-btn" style={{width:"100%",padding:"5px",fontSize:10}}>
                    SAVE TO PORTFOLIO
                  </button>
                  {saveMsg&&<div style={{fontSize:10,color:"#00e5a0"}}>{saveMsg}</div>}
                </>
              )}
            </div>
          </SideSection>

          {/* Brokers sub-section */}
          <SideSection label="BROKERS" open={sections.settings_brokers} onToggle={()=>toggle("settings_brokers")} indent>
            <div style={{padding:"6px 14px",display:"flex",flexDirection:"column",gap:5}}>
              <div style={{fontSize:10,color:"#444",lineHeight:1.5,marginBottom:2}}>
                Robinhood: export via Account → Statements → CSV.
              </div>
              {[["Tastytrade","https://www.tastytrade.com/api"],
                ["Alpaca","https://alpaca.markets"],
                ["IBKR","https://www.interactivebrokers.com/en/trading/ib-api.php"],
                ["Schwab","https://developer.schwab.com"]
              ].map(([name,url])=>(
                <a key={name} href={url} target="_blank"
                  style={{display:"flex",justifyContent:"space-between",
                    fontSize:10,color:"#555",textDecoration:"none",padding:"3px 0",
                    borderBottom:"1px solid var(--border)",transition:"color 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.color="#4da8ff"}
                  onMouseLeave={e=>e.currentTarget.style.color="#555"}>
                  {name}<span style={{fontSize:9}}>↗</span>
                </a>
              ))}
            </div>
          </SideSection>

        </SideSection>

        {/* ── Always-visible footer: source ── */}
        <div style={{marginTop:"auto",padding:"8px 12px",borderTop:"1px solid var(--border)",
          fontSize:9,color:"#333",letterSpacing:"0.06em",flexShrink:0}}>
          OPTFLOW v0.2 &nbsp;·&nbsp; {serverStatus.data_source||"—"}
        </div>
      </div>
    </div>
  );
}

// ── Pane ───────────────────────────────────────────────────────────────────────

function Pane({tabs,setTabs,nextId,setNextId,liveSpots,portData,
               fetchPortfolio,portLoading,recentTickers,setRecentTickers,compact,
               view,setView,onOpenRight,role="left"}) {

  const [activeTabId,setActiveTabId] = useState(tabs[0]?.id||1);
  const [inputTicker,setInput]       = useState("");
  const [navStack,setNavStack]       = useState([]);  // [{view, tabId}]
  const [labLegs,setLabLegs]         = useState([]);   // seed legs for LabPanel
  const dragIdx = useRef(null);
  const wsRefs  = useRef({});

  // Push current state before any navigation
  const pushNav = useCallback((currentView, currentTabId) => {
    setNavStack(prev => [...prev.slice(-19), {view: currentView, tabId: currentTabId}]);
  }, []);

  const goBack = useCallback(() => {
    setNavStack(prev => {
      if (!prev.length) return prev;
      const stack    = [...prev];
      const last     = stack.pop();
      setView(last.view);
      setActiveTabId(last.tabId);
      return stack;
    });
  }, []);

  const activeTab = tabs.find(t=>t.id===activeTabId)||tabs[0];

  useEffect(()=>{
    const ticker=activeTab?.ticker;
    if (!ticker||wsRefs.current[ticker]) return;
    const ws=new WebSocket(`${WS}/stream?tickers=${ticker}`);
    ws.onmessage=e=>{const d=JSON.parse(e.data);
      setTabs(prev=>prev.map(t=>t.ticker===ticker?{...t,livePrice:d[ticker]}:t));};
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{delete wsRefs.current[ticker];};
    wsRefs.current[ticker]=ws;
  },[activeTab?.ticker]);

  const updateTab = useCallback((id,patch)=>{
    setTabs(p=>p.map(t=>t.id===id?{...t,...patch}:t));
  },[setTabs]);

  const fetchChain = useCallback(async(id,tkr,exp)=>{
    updateTab(id,{loading:true,error:null});
    try {
      const r=await fetch(`${API}/chain/${tkr}${exp?`?expiry=${exp}`:""}`);
      if (!r.ok) throw new Error((await r.json()).detail);
      const d=await r.json();
      updateTab(id,{chainData:d,expiries:d.expiries||[],loading:false,expiry:exp||d.expiry});
    } catch(e){ updateTab(id,{error:e.message,loading:false}); }
  },[updateTab]);

  const openTicker = useCallback((tkr)=>{
    const ex=tabs.find(t=>t.ticker===tkr);
    if (ex){
      pushNav(view, activeTabId);
      setActiveTabId(ex.id); setView("chain"); return;
    }
    pushNav(view, activeTabId);
    const id=nextId; setNextId(n=>n+1);
    setTabs(p=>[...p,{id,ticker:tkr,chainData:null,expiry:null,expiries:[],
                       loading:false,error:null,activeType:"call",livePrice:null}]);
    setActiveTabId(id); setView("chain");
    fetchChain(id,tkr,null);
    setRecentTickers(p=>{
      const n=[tkr,...p.filter(r=>r!==tkr)].slice(0,8);
      persist("optflow_recent",n); return n;
    });
  },[tabs,nextId,fetchChain,setTabs,setNextId,setRecentTickers]);

  const closeTab = id=>{
    if (tabs.length===1) return;
    const idx=tabs.findIndex(t=>t.id===id);
    const rem=tabs.filter(t=>t.id!==id);
    setTabs(rem);
    if (activeTabId===id) setActiveTabId(rem[Math.max(0,idx-1)]?.id||rem[0]?.id);
  };

  const handleSearch = e=>{
    e.preventDefault();
    const t=inputTicker.trim().toUpperCase();
    if (!t) return;
    setInput(""); openTicker(t);
  };

  const livePrice = activeTab?.livePrice||activeTab?.chainData?.spot;
  const src = activeTab?.chainData?.source;

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minWidth:0,overflow:"hidden",
      borderRight:"1px solid var(--border)"}}>

      {/* Pane header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 10px",
        background:"var(--bg1)",borderBottom:"1px solid var(--border)",flexShrink:0,flexWrap:"wrap",rowGap:3}}>
        {/* Back button */}
        {navStack.length>0&&(
          <button onClick={goBack} title={`Back to ${navStack[navStack.length-1].view}`}
            style={{background:"none",border:"1px solid var(--border2)",color:"#555",
              fontFamily:"var(--mono)",fontSize:11,padding:"3px 8px",cursor:"pointer",
              transition:"all 0.15s",flexShrink:0,letterSpacing:0}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="#555";e.currentTarget.style.borderColor="var(--border2)";}}>
            ← {navStack[navStack.length-1].view}
          </button>
        )}
        <form onSubmit={handleSearch} style={{display:"flex"}}>
          <input value={inputTicker} onChange={e=>setInput(e.target.value.toUpperCase())}
            placeholder="TICKER" maxLength={6} className="ticker-input" style={{width:68}}/>
          <button type="submit" className="search-btn" style={{padding:"3px 10px",fontSize:10}}>+</button>
        </form>
        {!compact&&recentTickers.slice(0,5).map(t=>{
          const isOpen=!!tabs.find(tb=>tb.ticker===t);
          return (
            <button key={t} onClick={()=>openTicker(t)}
              style={{background:"none",border:`1px solid ${isOpen?"rgba(0,229,160,0.3)":"#1c1c1c"}`,
                color:isOpen?"#00e5a0":"#444",fontFamily:"var(--mono)",fontSize:9,
                padding:"2px 6px",cursor:"pointer",transition:"all 0.15s"}}>
              {t}
            </button>
          );
        })}
        <div style={{marginLeft:"auto",display:"flex",gap:2}}>
          {["portfolio","chain","strategy","lab"].map(v=>(
            <button key={v} onClick={()=>{ if(v!==view){pushNav(view,activeTabId);} setView(v); }}
              style={{background:"none",border:`1px solid ${view===v?"var(--green)":"transparent"}`,
                color:view===v?"var(--green)":"var(--muted)",fontFamily:"var(--mono)",
                fontSize:10,padding:"2px 8px",cursor:"pointer",transition:"all 0.15s",letterSpacing:"0.06em"}}>
              {v[0].toUpperCase()+v.slice(1)}
            </button>
          ))}
        </div>
        {view!=="portfolio"&&(
          <div style={{display:"flex",alignItems:"baseline",gap:5,flexShrink:0}}>
            <span style={{color:"#444",fontSize:10}}>{activeTab?.ticker}</span>
            <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>{livePrice?`$${fmt(livePrice)}`:"—"}</span>
            {activeTab?.loading&&<span style={{color:"var(--green)",animation:"blink 1s step-start infinite",fontSize:9}}>●</span>}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{display:"flex",alignItems:"stretch",borderBottom:"1px solid var(--border)",
        background:"var(--bg1)",overflowX:"auto",minHeight:26,flexShrink:0}}>
        {tabs.map((tab,idx)=>(
          <div key={tab.id} className={clsx("ticker-tab",tab.id===activeTabId&&"active")}
            style={{minHeight:26,padding:"0 9px",fontSize:10}}
            draggable
            onDragStart={e=>{dragIdx.current=idx;e.dataTransfer.effectAllowed="move";}}
            onDragOver={e=>{
              e.preventDefault();
              if(dragIdx.current===null||dragIdx.current===idx) return;
              setTabs(prev=>{const n=[...prev];const[m]=n.splice(dragIdx.current,1);n.splice(idx,0,m);dragIdx.current=idx;return n;});
            }}
            onDragEnd={()=>{dragIdx.current=null;}}
            onClick={()=>{
              setActiveTabId(tab.id);
              if(view==="portfolio") setView("chain");
              if(!tab.chainData&&!tab.loading) fetchChain(tab.id,tab.ticker,null);
            }}>
            <span className="ticker-tab-name" style={{fontSize:10}}>{tab.ticker}</span>
            {(tab.livePrice||tab.chainData?.spot)&&(
              <span className="ticker-tab-price">${fmt(tab.livePrice||tab.chainData?.spot)}</span>
            )}
            {tab.loading&&<span style={{color:"var(--green)",fontSize:7,animation:"blink 1s step-start infinite"}}>●</span>}
            <button className="ticker-tab-close" onClick={e=>{e.stopPropagation();closeTab(tab.id);}}>×</button>
          </div>
        ))}
        <button className="tab-add-btn" style={{fontSize:14,padding:"0 10px"}}
          onClick={()=>{const t=prompt("Ticker:");if(t)openTicker(t.trim().toUpperCase());}}>+</button>
      </div>

      {activeTab?.error&&view!=="portfolio"&&(
        <div className="error-bar">⚠ {activeTab.error}</div>
      )}

      {/* Content */}
      <div style={{flex:1,overflow:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:10}}>

        {view==="portfolio"&&(
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,paddingBottom:8,borderBottom:"1px solid var(--border)"}}>
              <span className="section-label">PORTFOLIO</span>
              <button onClick={fetchPortfolio} disabled={portLoading}
                style={{background:"var(--green)",border:"none",color:"#000",fontFamily:"var(--mono)",
                  fontSize:10,fontWeight:700,padding:"3px 10px",cursor:"pointer",opacity:portLoading?0.4:1}}>
                {portLoading?"…":"REFRESH"}
              </button>
            </div>
            {portLoading&&<div className="loading-bar">LOADING…</div>}
            <PortfolioPanel data={portData} onTickerOpen={tkr=>{
              if(onOpenRight){ onOpenRight(tkr); }
              else { openTicker(tkr); setView("chain"); }
            }}/>
          </>
        )}

        {view==="chain"&&activeTab&&(
          <>
            <div className="controls-row">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="section-label">EXPIRY</span>
                <select className="expiry-select" value={activeTab.expiry||""}
                  onChange={e=>{updateTab(activeTab.id,{expiry:e.target.value});fetchChain(activeTab.id,activeTab.ticker,e.target.value);}}>
                  {activeTab.expiries.map(e=><option key={e} value={e}>{e}</option>)}
                </select>
                {activeTab.chainData&&<span className="dte-badge">{activeTab.chainData.dte}d</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="section-label">IVR</span>
                <IVGauge rank={activeTab.chainData?.iv_rank}/>
                <span className="muted" style={{fontSize:10}}>{activeTab.chainData?fmtPct(activeTab.chainData.atm_iv):"—"}</span>
              </div>
              <div style={{display:"flex",gap:0,marginLeft:"auto"}}>
                {["call","put"].map(t=>(
                  <button key={t} className={clsx("type-btn",activeTab.activeType===t&&"active")}
                    onClick={()=>updateTab(activeTab.id,{activeType:t})}>{t.toUpperCase()}S</button>
                ))}
              </div>
              <span style={{fontSize:10,color:["tradier","polygon"].includes(src)?"#00e5a0":"#555"}}>
                {src==="tradier"?"● LIVE":src==="polygon"?"● LIVE":"○ DELAYED"}
              </span>
            </div>
            {activeTab.chainData?.signals&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.values(activeTab.chainData.signals).map((s,i)=>(
                  <SignalChip key={i} action={s.action} reason={s.reason}/>
                ))}
              </div>
            )}
            {activeTab.loading&&<div className="loading-bar">FETCHING…</div>}
            {activeTab.chainData
              ?<ChainTable chain={activeTab.chainData.chain} spot={activeTab.chainData.spot} activeType={activeTab.activeType}
                  onRowClick={row=>{
                    const leg={id:1,type:row.type,dir:"long",strike:row.strike,
                      iv:row.iv||0.25,qty:1,dte:activeTab.chainData.dte||30,entry:row.mid||row.ask||0};
                    if(onOpenRight){
                      onOpenRight(activeTab.ticker,[leg]);
                    } else {
                      pushNav(view,activeTabId);
                      setLabLegs([leg]);
                      setView("lab");
                    }
                  }}/>
              :!activeTab.loading&&<div className="panel-empty">Enter a ticker and press +</div>}
            {activeTab.chainData&&<IVChart ticker={activeTab.ticker}/>}
          </>
        )}

        {view==="lab"&&activeTab&&(
          <LabPanel
            chainData={activeTab.chainData}
            seedLegs={labLegs}
            onClose={()=>{ pushNav(view,activeTabId); setView("strategy"); }}
          />
        )}

        {view==="strategy"&&activeTab&&(
          <>
            <div className="controls-row">
              <span className="section-label">STRATEGY — {activeTab.ticker}</span>
              {!activeTab.chainData&&!activeTab.loading&&(
                <button onClick={()=>fetchChain(activeTab.id,activeTab.ticker,null)}
                  style={{background:"var(--green)",border:"none",color:"#000",fontFamily:"var(--mono)",
                    fontSize:10,fontWeight:700,padding:"3px 10px",cursor:"pointer"}}>LOAD CHAIN</button>
              )}
            </div>
            <StrategyPanel chainData={activeTab.chainData}
              onLabOpen={legs=>{
                if(onOpenRight){ onOpenRight(activeTab.ticker, legs); }
                else { pushNav(view,activeTabId); setLabLegs(legs); setView("lab"); }
              }}/>
          </>
        )}
      </div>

      {/* Pane footer */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 14px",
        borderTop:"1px solid var(--border)",fontSize:10,color:"var(--muted)",
        background:"var(--bg1)",flexShrink:0}}>
        <span
          style={{color:src==="tradier"?"#00e5a0":src==="polygon"?"#4da8ff":activeTab?.chainData?"#555":"#2a2a2a"}}
          title={src==="tradier"?"Real-time via Tradier":src==="polygon"?"Real-time via Polygon":"15-min delayed via yfinance"}>
          {src==="tradier"?"● TRADIER":src==="polygon"?"● POLYGON":activeTab?.chainData?"○ YFINANCE (DELAYED)":"—"}
        </span>
        <span className="muted">·</span>
        <span style={{color:"#2a2a2a"}}>{activeTab?.chainData?.fetched_at||""}</span>
        <span style={{marginLeft:"auto",color:"#2a2a2a"}}>{tabs.length} tab{tabs.length!==1?"s":""}</span>
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────


// ── AnalysisPane — right panel: strategy + lab combined ───────────────────────

function AnalysisPane({tabs,setTabs,nextId,setNextId,liveSpots,
                       labLegs,setLabLegs,view,setView,onClose}) {

  const [activeTabId,setActiveTabId] = useState(tabs[0]?.id||1);
  const wsRefs = useRef({});

  const activeTab = tabs.find(t=>t.id===activeTabId)||tabs[0];
  const chainData = activeTab?.chainData;

  // Keep tabs in sync with liveSpots via WS
  useEffect(()=>{
    const ticker=activeTab?.ticker;
    if(!ticker||wsRefs.current[ticker]) return;
    const ws=new WebSocket(`${WS}/stream?tickers=${ticker}`);
    ws.onmessage=e=>{const d=JSON.parse(e.data);
      setTabs(prev=>prev.map(t=>t.ticker===ticker?{...t,livePrice:d[ticker]}:t));};
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{delete wsRefs.current[ticker];};
    wsRefs.current[ticker]=ws;
  },[activeTab?.ticker]);

  const updateTab = useCallback((id,patch)=>{
    setTabs(p=>p.map(t=>t.id===id?{...t,...patch}:t));
  },[setTabs]);

  const fetchChain = useCallback(async(id,tkr,exp)=>{
    updateTab(id,{loading:true,error:null});
    try {
      const r=await fetch(`${API}/chain/${tkr}${exp?`?expiry=${exp}`:""}`);
      if(!r.ok) throw new Error((await r.json()).detail);
      const d=await r.json();
      updateTab(id,{chainData:d,expiries:d.expiries||[],loading:false,expiry:exp||d.expiry});
    } catch(e){ updateTab(id,{error:e.message,loading:false}); }
  },[updateTab]);

  // Auto-fetch chain when tab switches without data
  useEffect(()=>{
    if(activeTab&&!activeTab.chainData&&!activeTab.loading){
      fetchChain(activeTab.id, activeTab.ticker, null);
    }
  },[activeTab?.id]);

  const livePrice = activeTab?.livePrice||chainData?.spot;
  const src = chainData?.source;

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minWidth:0,
      overflow:"hidden",borderLeft:"1px solid var(--border)"}}>

      {/* Analysis pane header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 10px",
        background:"var(--bg1)",borderBottom:"1px solid var(--border)",
        flexShrink:0,flexWrap:"wrap",rowGap:3}}>

        {/* Ticker tabs */}
        <div style={{display:"flex",alignItems:"stretch",overflowX:"auto",flex:1,minWidth:0}}>
          {tabs.map(tab=>(
            <div key={tab.id}
              className={clsx("ticker-tab",tab.id===activeTabId&&"active")}
              style={{fontSize:10,padding:"0 8px",minHeight:26,cursor:"pointer"}}
              onClick={()=>setActiveTabId(tab.id)}>
              <span className="ticker-tab-name" style={{fontSize:10}}>{tab.ticker}</span>
              {(tab.livePrice||tab.chainData?.spot)&&(
                <span className="ticker-tab-price">${fmt(tab.livePrice||tab.chainData?.spot)}</span>
              )}
              {tab.loading&&<span style={{color:"var(--green)",fontSize:7,
                animation:"blink 1s step-start infinite"}}>●</span>}
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div style={{display:"flex",gap:2,flexShrink:0}}>
          {[["analysis","◆ ANALYSIS"],["chain","◫ CHAIN"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)}
              style={{background:view===v?"rgba(0,229,160,0.08)":"none",
                border:`1px solid ${view===v?"rgba(0,229,160,0.4)":"transparent"}`,
                color:view===v?"var(--green)":"#555",fontFamily:"var(--mono)",
                fontSize:10,padding:"2px 8px",cursor:"pointer",
                transition:"all 0.15s",letterSpacing:"0.06em"}}>
              {label}
            </button>
          ))}
        </div>

        {/* Ticker info + close */}
        {livePrice&&(
          <span style={{fontSize:13,fontWeight:700,color:"#fff",flexShrink:0}}>
            {activeTab?.ticker} ${fmt(livePrice)}
          </span>
        )}
        {activeTab?.loading&&(
          <span style={{color:"var(--green)",animation:"blink 1s step-start infinite",fontSize:9}}>●</span>
        )}
        <button onClick={onClose} title="Close analysis pane"
          style={{background:"none",border:"1px solid var(--border2)",color:"#444",
            fontFamily:"var(--mono)",fontSize:10,padding:"2px 6px",cursor:"pointer",
            transition:"all 0.15s",flexShrink:0,marginLeft:4}}
          onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}}
          onMouseLeave={e=>{e.currentTarget.style.color="#444";e.currentTarget.style.borderColor="var(--border2)";}}>
          ✕
        </button>
      </div>

      {/* Error bar */}
      {activeTab?.error&&(
        <div className="error-bar">⚠ {activeTab.error}</div>
      )}

      {/* Content */}
      <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column"}}>
        {!chainData&&!activeTab?.loading&&(
          <div className="panel-empty">Loading chain data…</div>
        )}
        {activeTab?.loading&&(
          <div className="loading-bar">FETCHING CHAIN…</div>
        )}

        {chainData&&view==="analysis"&&(
          <div style={{display:"flex",flexDirection:"column",flex:1}}>
            {/* Compact strategy ranking */}
            <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",
              background:"var(--bg1)",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span className="section-label">STRATEGY</span>
                <span style={{fontSize:10,color:"#444"}}>
                  IVR <b style={{color:chainData.iv_rank<30?"#00e5a0":chainData.iv_rank>70?"#ff4d6d":"#f5a623"}}>
                    {fmt(chainData.iv_rank,1)}</b>
                  &nbsp;·&nbsp;DTE <b style={{color:"#fff"}}>{chainData.dte}</b>
                  &nbsp;·&nbsp;<b style={{color:"#4da8ff"}}>{fmtPct(chainData.atm_iv)}</b> ATM IV
                </span>
              </div>
              <StrategyPanel chainData={chainData}
                onLabOpen={legs=>{ setLabLegs(legs); setView("analysis"); }}/>
            </div>

            {/* Lab below strategy */}
            <LabPanel chainData={chainData} seedLegs={labLegs}
              onClose={null}/>
          </div>
        )}

        {chainData&&view==="chain"&&(
          <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:10}}>
            <div className="controls-row">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="section-label">EXPIRY</span>
                <select className="expiry-select" value={activeTab.expiry||""}
                  onChange={e=>{updateTab(activeTab.id,{expiry:e.target.value});
                    fetchChain(activeTab.id,activeTab.ticker,e.target.value);}}>
                  {activeTab.expiries.map(e=><option key={e} value={e}>{e}</option>)}
                </select>
                <span className="dte-badge">{chainData.dte}d</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="section-label">IVR</span>
                <IVGauge rank={chainData.iv_rank}/>
              </div>
              <div style={{display:"flex",gap:0,marginLeft:"auto"}}>
                {["call","put"].map(t=>(
                  <button key={t} className={clsx("type-btn",activeTab.activeType===t&&"active")}
                    onClick={()=>updateTab(activeTab.id,{activeType:t})}>{t.toUpperCase()}S</button>
                ))}
              </div>
            </div>
            <ChainTable chain={chainData.chain} spot={chainData.spot}
              activeType={activeTab.activeType}
              onRowClick={row=>{
                setLabLegs([{id:1,type:row.type,dir:"long",strike:row.strike,
                  iv:row.iv||0.25,qty:1,dte:chainData.dte||30,entry:row.mid||row.ask||0}]);
                setView("analysis");
              }}/>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 12px",
        borderTop:"1px solid var(--border)",fontSize:10,color:"var(--muted)",
        background:"var(--bg1)",flexShrink:0}}>
        <span style={{color:src==="tradier"?"#00e5a0":src==="polygon"?"#4da8ff":chainData?"#555":"#2a2a2a"}}
          title={src==="tradier"?"Real-time via Tradier":src==="polygon"?"Real-time via Polygon":"15-min delayed"}>
          {src==="tradier"?"● TRADIER":src==="polygon"?"● POLYGON":chainData?"○ YFINANCE":"—"}
        </span>
        <span className="muted">·</span>
        <span style={{color:"#2a2a2a"}}>{chainData?.fetched_at||""}</span>
      </div>
    </div>
  );
}

export default function App() {
  // Sidebar open state — persisted
  const [sideOpen,setSideOpen] = useState(()=>recall("optflow_sidebar_open",true));
  const toggleSide = () => { const n=!sideOpen; setSideOpen(n); persist("optflow_sidebar_open",n); };

  // Split pane
  const [splitMode,setSplitMode] = useState(false);
  const [splitPos,setSplitPos]   = useState(50);
  const splitDragging = useRef(false);

  // Server status (polled every 5s)
  const [serverStatus,setServerStatus] = useState({api:"checking"});
  const statusPoll = useRef(false);
  const pollStatus = useCallback(async()=>{
    if (statusPoll.current) return;
    statusPoll.current=true;
    try {
      const r=await fetch(`${API}/health`,{signal:AbortSignal.timeout(4000)});
      if (!r.ok) throw new Error();
      const d=await r.json();
      setServerStatus({api:"up",...d});
    } catch { setServerStatus(p=>({...p,api:"down"})); }
    finally { statusPoll.current=false; }
  },[]);
  useEffect(()=>{ pollStatus(); const id=setInterval(pollStatus,5000); return ()=>clearInterval(id); },[pollStatus]);

  // Shared state
  const [nextId,setNextId]   = useState(3);
  const [liveSpots,setLiveSpots] = useState({});
  // Left pane — portfolio/chain
  const [tabsA,setTabsA] = useState([{id:1,ticker:"SPY",chainData:null,expiry:null,expiries:[],loading:false,error:null,activeType:"call",livePrice:null}]);
  // Right pane — analysis
  const [tabsB,setTabsB] = useState([{id:2,ticker:"SPY",chainData:null,expiry:null,expiries:[],loading:false,error:null,activeType:"call",livePrice:null}]);
  const [portData,setPortData]       = useState(null);
  const [portLoading,setPortLoading] = useState(false);
  const [watchlist,setWatchlist]     = useState(()=>recall("optflow_watchlist",["SPY","QQQ","NVDA"]));
  const [settings,setSettings]       = useState(()=>recall("optflow_settings",{chainRows:20,autoRefresh:"on"}));
  const [recentTickers,setRecentTickers] = useState(()=>recall("optflow_recent",["SPY","QQQ"]));
  const [view,setView]               = useState("portfolio");
  // Right pane state (independent)
  const [viewB,setViewB]             = useState("analysis");
  const [labLegsB,setLabLegsB]       = useState([]);

  const fetchPortfolio = useCallback(async()=>{
    setPortLoading(true);
    try { const r=await fetch(`${API}/portfolio`); if (r.ok) setPortData(await r.json()); }
    catch {} finally { setPortLoading(false); }
  },[]);
  useEffect(()=>{ fetchPortfolio(); },[]);

  // Stop session handler
  const handleStop = useCallback(async()=>{
    if (!window.confirm("Stop all OPTFLOW servers?")) return;
    try {
      const r=await fetch(`${API}/shutdown`,{method:"POST"});
      if (r.ok){ const html=await r.text(); document.open();document.write(html);document.close(); }
    } catch {}
  },[]);

  // Open right pane with a ticker (from portfolio row click or LAB button)
  const openInRight = useCallback((ticker, labLegs=[]) => {
    // Ensure ticker tab exists in tabsB
    setTabsB(prev => {
      if (prev.find(t=>t.ticker===ticker)) return prev;
      const id = nextId; setNextId(n=>n+1);
      return [...prev, {id,ticker,chainData:null,expiry:null,expiries:[],
                        loading:false,error:null,activeType:"call",livePrice:null}];
    });
    setLabLegsB(labLegs);
    setViewB(labLegs.length ? "analysis" : "chain");
    setSplitMode(true);
  }, [nextId]);

  // Split divider drag
  const onSplitDrag = e=>{
    e.preventDefault(); splitDragging.current=true;
    const onMove=ev=>{
      if (!splitDragging.current) return;
      const c=document.getElementById("pane-container");
      if (!c) return;
      const rect=c.getBoundingClientRect();
      setSplitPos(Math.min(80,Math.max(20,((ev.clientX-rect.left)/rect.width)*100)));
    };
    document.addEventListener("mousemove",onMove);
    document.addEventListener("mouseup",()=>{splitDragging.current=false;},{once:true});
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* Header */}
        <header style={{display:"flex",alignItems:"center",gap:10,padding:"0 12px",
          height:40,borderBottom:"1px solid var(--border)",background:"var(--bg1)",
          position:"sticky",top:0,zIndex:100,flexShrink:0}}>
          <button onClick={toggleSide} title={sideOpen?"Close sidebar":"Open sidebar"}
            style={{background:"none",border:"none",cursor:"pointer",padding:"3px 4px",
              display:"flex",flexDirection:"column",gap:3,transition:"opacity 0.15s",
              opacity:sideOpen?1:0.5}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=sideOpen?1:0.5}>
            {[0,1,2].map(i=><span key={i} style={{display:"block",width:15,height:2,background:"var(--green)"}}/>)}
          </button>
          <span style={{color:"var(--green)",fontSize:15}}>◈</span>
          <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.15em",color:"#fff"}}>OPTFLOW</span>
          <div style={{marginLeft:"auto",display:"flex",gap:6}}>
            <button onClick={()=>{ if(!splitMode) openInRight(tabsA[0]?.ticker||"SPY"); else setSplitMode(false); }}
              style={{background:splitMode?"rgba(0,229,160,0.08)":"none",
                border:`1px solid ${splitMode?"rgba(0,229,160,0.3)":"#282828"}`,
                color:splitMode?"var(--green)":"#444",fontFamily:"var(--mono)",
                fontSize:10,padding:"3px 10px",cursor:"pointer",transition:"all 0.15s"}}>
              {splitMode?"⊟ SINGLE":"⊞ SPLIT"}
            </button>
          </div>
        </header>

        {/* Body: sidebar + panes side by side */}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          <Sidebar open={sideOpen} serverStatus={serverStatus} onStop={handleStop}
            portData={portData} onOpenTicker={t=>{
              if (!tabsA.find(tb=>tb.ticker===t)){
                const id=nextId; setNextId(n=>n+1);
                setTabsA(p=>[...p,{id,ticker:t,chainData:null,expiry:null,expiries:[],
                  loading:false,error:null,activeType:"call",livePrice:null}]);
              }
            }}
            view={view} setView={setView}
            watchlist={watchlist} setWatchlist={setWatchlist}
            liveSpots={liveSpots} settings={settings} setSettings={setSettings}
            recentTickers={recentTickers} fetchPortfolio={fetchPortfolio}/>

          {/* Pane container */}
          <div id="pane-container" style={{display:"flex",flex:1,overflow:"hidden",position:"relative"}}>

            {/* Pane A — always visible */}
            <div style={{
              flex: splitMode ? `0 0 ${splitPos}%` : "1 1 100%",
              display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,
            }}>
              <Pane tabs={tabsA} setTabs={setTabsA}
                nextId={nextId} setNextId={setNextId}
                liveSpots={liveSpots}
                portData={portData} fetchPortfolio={fetchPortfolio} portLoading={portLoading}
                recentTickers={recentTickers} setRecentTickers={setRecentTickers}
                compact={splitMode} role="left"
                view={view} setView={setView}
                onOpenRight={openInRight}/>
            </div>

            {splitMode&&(
              <>
                {/* Draggable divider */}
                <div onMouseDown={onSplitDrag}
                  style={{width:4,flexShrink:0,background:"var(--border)",
                    cursor:"col-resize",transition:"background 0.15s",zIndex:10}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--green)"}
                  onMouseLeave={e=>e.currentTarget.style.background="var(--border)"}/>
                {/* Right pane — analysis (strategy + lab) */}
                <div style={{flex:"1 1 0",display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
                  <AnalysisPane
                    tabs={tabsB} setTabs={setTabsB}
                    nextId={nextId} setNextId={setNextId}
                    liveSpots={liveSpots}
                    labLegs={labLegsB} setLabLegs={setLabLegsB}
                    view={viewB} setView={setViewB}
                    onClose={()=>setSplitMode(false)}/>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#080808;--bg1:#0d0d0d;--bg2:#131313;--bg3:#1a1a1a;
    --border:#1e1e1e;--border2:#282828;
    --text:#d0d0d0;--muted:#555;
    --green:#00e5a0;--red:#ff4d6d;--blue:#4da8ff;--amber:#f5a623;
    --mono:'IBM Plex Mono',monospace;
  }
  body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:12px;overflow:hidden}
  .app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
  /* Sidebar utilities */
  .side-section-btn{display:flex;align-items:center;justify-content:space-between;width:100%;
    background:none;border:none;color:#444;font-family:var(--mono);font-size:9px;
    letter-spacing:0.15em;padding:7px 14px;cursor:pointer;transition:color 0.15s}
  .side-section-btn:hover{color:#777}
  .side-nav-btn{display:flex;align-items:center;width:100%;background:none;border:none;border-left:2px solid transparent;
    font-family:var(--mono);font-size:11px;letter-spacing:0.08em;padding:7px 14px;
    cursor:pointer;transition:all 0.15s;text-align:left}
  .side-nav-btn:hover{color:#ccc!important;background:rgba(255,255,255,0.02)!important}
  .side-input{flex:1;background:var(--bg2);border:1px solid var(--border2);color:#fff;
    font-family:var(--mono);font-size:11px;padding:4px 7px;outline:none;min-width:0}
  .side-input:focus{border-color:var(--green)}
  .side-add-btn{background:var(--green);border:none;color:#000;font-family:var(--mono);
    font-size:11px;font-weight:700;padding:4px 10px;cursor:pointer;flex-shrink:0}
  .side-outline-btn{width:100%;background:none;border:1px solid var(--border2);color:#555;
    font-family:var(--mono);font-size:10px;letter-spacing:0.06em;padding:4px;cursor:pointer;transition:all 0.15s}
  .side-outline-btn:hover{border-color:var(--green);color:var(--green)}
  .watch-row{display:flex;align-items:center;gap:6px;padding:5px 12px;
    border-bottom:1px solid rgba(255,255,255,0.02);cursor:pointer;transition:background 0.15s}
  .watch-row:hover{background:rgba(255,255,255,0.02)}
  .remove-btn{background:none;border:none;color:#333;cursor:pointer;font-size:13px;
    padding:0;line-height:1;font-family:var(--mono);transition:color 0.15s;flex-shrink:0}
  .remove-btn:hover{color:var(--red)}
  .stop-btn{background:none;border:1px solid rgba(255,61,90,0.35);color:rgba(255,61,90,0.7);
    font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:0.08em;
    cursor:pointer;transition:all 0.15s}
  .stop-btn:hover{background:rgba(255,61,90,0.08);border-color:var(--red);color:var(--red)}
  /* Pane utilities */
  .section-label{color:var(--muted);font-size:10px;letter-spacing:0.12em}
  .controls-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
    padding-bottom:8px;border-bottom:1px solid var(--border)}
  .expiry-select{background:var(--bg2);border:1px solid var(--border2);color:var(--text);
    font-family:var(--mono);font-size:11px;padding:2px 5px;outline:none}
  .expiry-select:focus{border-color:var(--green)}
  .dte-badge{background:var(--bg3);border:1px solid var(--border2);color:var(--amber);font-size:10px;padding:1px 5px}
  .iv-gauge{display:flex;align-items:center;gap:6px}
  .iv-bar-bg{position:relative;width:64px;height:4px;background:var(--bg3);border:1px solid var(--border)}
  .iv-bar-fill{position:absolute;top:0;left:0;height:100%;transition:width 0.4s}
  .iv-bar-cursor{position:absolute;top:-4px;width:2px;height:12px;background:#fff;transform:translateX(-1px)}
  .type-btn{background:none;border:1px solid var(--border2);color:var(--muted);
    font-family:var(--mono);font-size:10px;letter-spacing:0.06em;padding:2px 9px;cursor:pointer;transition:all 0.15s}
  .type-btn:hover{color:var(--text)}
  .type-btn.active{color:#000;background:var(--green);border-color:var(--green)}
  .signal-chip{display:flex;align-items:center;gap:5px;border:1px solid;padding:2px 7px;background:rgba(255,255,255,0.02)}
  .signal-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
  .signal-action{font-size:10px;font-weight:700;letter-spacing:0.08em}
  .signal-reason{font-size:10px;color:var(--muted)}
  .ticker-input{background:var(--bg2);border:1px solid var(--border2);border-right:none;
    color:#fff;font-family:var(--mono);font-size:12px;font-weight:700;
    padding:3px 8px;letter-spacing:0.08em;outline:none}
  .ticker-input:focus{border-color:var(--green)}
  .search-btn{background:var(--green);border:none;color:#000;font-family:var(--mono);
    font-size:11px;font-weight:700;padding:4px 10px;cursor:pointer;transition:opacity 0.15s}
  .search-btn:hover{opacity:0.85}
  .chain-scroll{overflow:auto;max-height:calc(100vh - 260px)}
  .chain-table{width:100%;border-collapse:collapse;font-size:11px}
  .chain-table th{position:sticky;top:0;background:var(--bg1);color:var(--muted);
    font-size:9px;letter-spacing:0.1em;font-weight:500;
    padding:4px 8px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap}
  .chain-table th:first-child{text-align:left}
  .chain-table td{padding:3px 8px;text-align:right;
    border-bottom:1px solid rgba(255,255,255,0.02);white-space:nowrap}
  .chain-table td:first-child{text-align:left}
  .chain-table tr:hover td{background:rgba(255,255,255,0.02)}
  .chain-table tr.itm td{color:#444}
  .chain-table tr.atm td{background:rgba(0,229,160,0.03)}
  .chain-table tr.atm{outline:1px solid rgba(0,229,160,0.15)}
  .strike-col{font-weight:600;color:#fff!important}
  .loading-bar{padding:16px;text-align:center;color:var(--muted);font-size:11px;letter-spacing:0.08em}
  .panel-empty{padding:36px;text-align:center;color:var(--muted);font-size:11px;letter-spacing:0.1em;line-height:2}
  .error-bar{background:rgba(255,77,109,0.07);border-bottom:1px solid rgba(255,77,109,0.2);
    color:var(--red);padding:4px 14px;font-size:11px}
  .tab-bar{display:flex;align-items:stretch;border-bottom:1px solid var(--border);
    background:var(--bg1);overflow-x:auto;min-height:26px;flex-shrink:0}
  .tab-bar::-webkit-scrollbar{height:2px}
  .ticker-tab{display:flex;align-items:center;gap:5px;padding:0 9px;min-width:66px;
    border-right:1px solid var(--border);cursor:pointer;user-select:none;
    font-size:10px;letter-spacing:0.06em;color:var(--muted);transition:all 0.15s;
    white-space:nowrap;background:var(--bg1)}
  .ticker-tab:hover{background:var(--bg2);color:var(--text)}
  .ticker-tab.active{background:var(--bg);color:#fff;border-bottom:2px solid var(--green)}
  .ticker-tab-name{font-weight:700;letter-spacing:0.08em}
  .ticker-tab-price{font-size:9px;color:var(--muted)}
  .ticker-tab.active .ticker-tab-price{color:var(--green)}
  .ticker-tab-close{background:none;border:none;color:#2a2a2a;font-size:13px;
    cursor:pointer;padding:0;line-height:1;margin-left:2px;transition:color 0.15s;font-family:var(--mono)}
  .ticker-tab-close:hover{color:var(--red)}
  .tab-add-btn{background:none;border:none;color:#333;font-size:15px;cursor:pointer;
    padding:0 10px;transition:color 0.15s;font-family:var(--mono)}
  .tab-add-btn:hover{color:var(--green)}
  .acct-value-bar{display:flex;align-items:center;border:1px solid var(--border);
    padding:14px 18px;background:var(--bg1)}
  .greeks-bar{display:flex;border:1px solid var(--border);overflow:hidden}
  .greek-stat{display:flex;flex-direction:column;align-items:center;
    padding:9px 14px;border-right:1px solid var(--border);gap:4px;flex:1;cursor:default}
  .greek-stat:last-child{border-right:none}
  .greek-stat-label{font-size:9px;color:var(--muted);letter-spacing:0.1em;text-align:center}
  .greek-stat-val{font-size:15px;font-weight:700}
  .port-alert{display:flex;gap:8px;align-items:center;
    background:rgba(245,166,35,0.04);border:1px solid rgba(245,166,35,0.15);padding:5px 8px;font-size:11px}
  .iv-chart-wrap{border:1px solid var(--border);padding:10px;background:var(--bg1)}
  .muted{color:var(--muted)}
  @keyframes blink{50%{opacity:0}}
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:var(--border2)}
`;
