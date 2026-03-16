import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import React from "react";
import { LineChart, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Brush } from "recharts";

const API = "http://127.0.0.1:8000/api";
const WS  = "ws://127.0.0.1:8000/ws";
const SIDEBAR_W = 264;

// ── Utilities ──────────────────────────────────────────────────────────────────
const fmt     = (v,d=2) => v==null||isNaN(v) ? "—" : Number(v).toFixed(d);
const fmtPct  = v => v==null ? "—" : `${(v*100).toFixed(1)}%`;
const fmtK    = v => v==null ? "—" : v>999 ? `${(v/1000).toFixed(1)}k` : String(v);
const fmtUSD  = v => v==null ? "—" : `$${Math.abs(v).toFixed(2)}`;
// Client-side market hours guard (NYSE 9:30–16:00 ET, Mon–Fri)
// Used to suppress stale AH flags that arrive before the server re-ticks
const isMarketHoursNow = () => {
  const et = new Date().toLocaleString("en-US",{timeZone:"America/New_York"});
  const d  = new Date(et);
  const day = d.getDay();            // 0=Sun,6=Sat
  if(day===0||day===6) return false;
  const mins = d.getHours()*60+d.getMinutes();
  return mins >= 9*60+30 && mins <= 16*60;
};

// Helpers for enriched spot objects {price, close, ah_change, ah_pct, is_ah}
const spotPrice = d => d ? (typeof d==="object" ? d.price||0 : d) : 0;
// spotIsAH respects both the backend flag AND a live client-side market hours check
const spotIsAH  = d => !!(d && typeof d==="object" && d.is_ah && !isMarketHoursNow());
const spotAHPct = d => d && typeof d==="object" ? (d.ah_pct||0) : 0;
const spotClose = d => d && typeof d==="object" ? (d.close||0) : 0;
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

function SideSection({label,open,onToggle,children,badge,indent=false,headerAction}) {
  return (
    <div style={{
      borderBottom:indent?"none":"1px solid var(--border)",
      borderTop:indent?"1px solid rgba(255,255,255,0.04)":"none",
      flexShrink:0,
    }}>
      <div style={{display:"flex",alignItems:"center"}}>
        <button onClick={onToggle} className="side-section-btn"
          style={{flex:1,paddingLeft:indent?"22px":"14px",fontSize:indent?"8px":"9px",
            color:indent?"var(--t3)":"var(--t2)"}}>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            {indent&&<span style={{fontSize:8,color:"var(--t4)"}}>▸</span>}
            {label}
            {badge&&<span style={{background:"rgba(255,77,109,0.15)",color:"#ff4d6d",
              fontSize:9,padding:"1px 5px",borderRadius:2}}>{badge}</span>}
          </span>
          <span style={{fontSize:9,transition:"transform 0.2s",
            display:"inline-block",transform:open?"rotate(180deg)":"rotate(0deg)"}}>▾</span>
        </button>
        {headerAction&&<div style={{paddingRight:8,flexShrink:0}}>{headerAction}</div>}
      </div>
      {open&&<div>{children}</div>}
    </div>
  );
}

// ── ChainTable ─────────────────────────────────────────────────────────────────
function ChainTable({chain,spot,activeType,onRowClick,limit=50,selectedStrike=null,onSelectRow}) {
  const allRows = chain.filter(r=>r.type===activeType);
  const rows = (() => {
    if(!limit || !allRows.length) return allRows;
    if(!spot) return allRows.slice(0, limit);
    const atmIdx = allRows.reduce((best,r,i)=>
      Math.abs(r.strike-spot) < Math.abs(allRows[best].strike-spot) ? i : best, 0);
    const start = Math.max(0, atmIdx - Math.floor(limit/2));
    const end   = Math.min(allRows.length, start + limit);
    return allRows.slice(start, end);
  })();
  const cols = ["strike","bid","ask","mid","volume","OI","iv","delta","gamma","theta","vega"];
  const minDiff = (spot && rows.length) ? Math.min(...rows.map(r=>Math.abs(r.strike-spot))) : null;
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
              <tr key={i}
                onClick={()=>{ if(onSelectRow) onSelectRow(row); }}
                className={clsx(row.ITM&&"itm",isATM&&"atm")}
                style={{
                  cursor:onSelectRow?"pointer":"default",
                  outline: selectedStrike===row.strike?"1px solid rgba(0,229,160,0.6)":"none",
                  outlineOffset:"-1px",
                  background: selectedStrike===row.strike
                    ?"rgba(0,229,160,0.07)"
                    :(row.ITM?undefined:"none"),
                  boxShadow: selectedStrike===row.strike
                    ?"inset 3px 0 0 #00e5a0":"none",
                }}>
                {onRowClick&&(
                  <td style={{padding:"2px 6px"}}>
                    <button onClick={()=>onRowClick(row)}
                      title="Analyze in Lab"
                      style={{background:"none",border:"1px solid #1e1e1e",color:"#666",
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
function IVChart({ticker, atmIV=null}) {
  const [allData,    setAllData]    = useState([]);
  const [refIV,      setRefIV]      = useState(null);
  const [ivFetchedAt,setIvFetchedAt]= useState(null);  // timestamp of last atm_iv fetch
  const [loading,    setLoad]       = useState(false);
  const [show,    setShow]   = useState({hv20:true,hv30:false,ivrank:false,price:false,premium:true,omega:false});
  // Date range — default to last 90 days, but user can change
  const todayStr   = new Date().toISOString().slice(0,10);
  const default90  = new Date(Date.now()-90*864e5).toISOString().slice(0,10);
  const [dateFrom, setDateFrom] = useState(default90);
  const [dateTo,   setDateTo]   = useState(todayStr);
  // Quick-select presets
  const PRESETS = [["1M",30],["3M",90],["6M",180],["1Y",365]];
  const applyPreset = days => {
    setDateTo(todayStr);
    setDateFrom(new Date(Date.now()-days*864e5).toISOString().slice(0,10));
  };
  const toggle = k => setShow(s=>({...s,[k]:!s[k]}));

  useEffect(()=>{
    if(!ticker) return;
    setLoad(true);
    // Fetch full history (365d) once; filter client-side by date range
    fetch(`${API}/iv-history/${ticker}?days=365`)
      .then(r=>r.json())
      .then(d=>{
        setAllData(d.history||[]);
        setRefIV(d.atm_iv||null);
        if(d.atm_iv) setIvFetchedAt(new Date());
        setLoad(false);
      })
      .catch(()=>setLoad(false));
  },[ticker]);

  // Refresh atm_iv every 5 minutes while the chart is visible
  // (history data is stable; only the reference IV needs freshening)
  useEffect(()=>{
    if(!ticker) return;
    const refresh = ()=>{
      fetch(`${API}/iv-history/${ticker}?days=1`)   // minimal fetch — just need atm_iv
        .then(r=>r.json())
        .then(d=>{
          if(d.atm_iv){ setRefIV(d.atm_iv); setIvFetchedAt(new Date()); }
        })
        .catch(()=>{});
    };
    const id = setInterval(refresh, 5*60*1000);   // every 5 minutes
    return ()=>clearInterval(id);
  },[ticker]);

  // Use the prop value (from live chain) if available, else our own fetched value
  // The prop updates whenever the chain is re-fetched (e.g. expiry change)
  const currentIV = atmIV || refIV;
  // Track when the displayed ATM IV was last updated
  // atmIV prop updates are tracked by the parent; refIV by ivFetchedAt
  const ivAge = ivFetchedAt
    ? Math.round((Date.now()-ivFetchedAt)/60000)   // minutes ago
    : null;

  // Filter by date range client-side
  const data = allData.filter(d=>d.date>=dateFrom && d.date<=dateTo);

  if(loading) return <div style={{fontSize:9,color:"#444",padding:"6px 0"}}>Loading vol history…</div>;
  if(!allData.length) return null;

  const chartData = data.map(d=>({
    ...d,
    price:   d.close||null,
    premium: (currentIV!=null&&d.hv20!=null) ? currentIV - d.hv20 : null,
    iv:      currentIV||null,
  }));

  const last    = chartData[chartData.length-1]||{};
  const premium = (currentIV!=null&&last.hv20!=null) ? currentIV - last.hv20 : null;
  const isRich  = premium!=null && premium>0;

  const volVals = chartData.flatMap(d=>[
    show.hv20?d.hv20:null, show.hv30?d.hv30:null,
    show.premium?d.premium:null, currentIV||null
  ].filter(v=>v!=null));
  const volMin = volVals.length ? Math.min(...volVals)*0.85 : 0;
  const volMax = volVals.length ? Math.max(...volVals)*1.2  : 1;

  const SERIES = [
    {k:"hv20",   label:"HV 20d",   color:"#4da8ff", dash:null,  axis:"left"},
    {k:"hv30",   label:"HV 30d",   color:"#9b6dff", dash:"3 2", axis:"left"},
    {k:"ivrank", label:"HV Rank",  color:"#00e5a0", dash:"2 2", axis:"right"},
    {k:"price",  label:"Price",    color:"#666",    dash:"2 3", axis:"right"},
    {k:"premium",label:"Vol Prem", color:"#f5a623", dash:"4 2", axis:"left"},
    {k:"omega",  label:"Elasticity",color:"#ff4d6d", dash:"2 2", axis:"omega"},
  ];
  const rgbMap = {"#4da8ff":"77,168,255","#9b6dff":"155,109,255",
                  "#00e5a0":"0,229,160","#f5a623":"245,166,35",
                  "#666":"102,102,102","#ff4d6d":"255,77,109"};

  return (
    <div style={{marginTop:10}}>
      {/* Header: signal + series toggles */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
        <span style={{fontSize:9,color:"#777",letterSpacing:"0.08em"}}>VOL CHART</span>
        {currentIV&&(
          <span style={{fontSize:9,color:"#f5a623",display:"flex",alignItems:"center",gap:4}}>
            ATM IV {fmtPct(currentIV)}
            <span style={{fontSize:8,color:"#666",fontWeight:400}} title="ATM IV is a point-in-time snapshot — refreshes every 5 min">
              {atmIV?"(chain)":ivAge!=null?"("+( ivAge===0?"just now":ivAge+"m ago")+")" :"(snapshot)"}
            </span>
          </span>
        )}
        {premium!=null&&(
          <span style={{fontSize:9,fontWeight:600,color:isRich?"#ff4d6d":"#00e5a0"}}>
            {isRich?`▲ IV rich +${fmtPct(premium)}`:`▼ IV cheap −${fmtPct(Math.abs(premium))}`}
            <span style={{fontSize:8,fontWeight:400,color:"#555",marginLeft:4}}>
              (ATM IV − HV 20d)
            </span>
          </span>
        )}
        <div style={{marginLeft:"auto",display:"flex",gap:3,flexWrap:"wrap"}}>
          {SERIES.map(s=>(
            <button key={s.k} onClick={()=>toggle(s.k)}
              style={{
                background:show[s.k]?`rgba(${rgbMap[s.color]||"100,100,100"},0.15)`:"none",
                border:`1px solid ${show[s.k]?s.color:"#282828"}`,
                color:show[s.k]?s.color:"#444",
                fontFamily:"var(--mono)",fontSize:8,padding:"1px 7px",
                cursor:"pointer",transition:"all 0.15s"}}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Duration controls */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
        {/* Preset buttons */}
        {PRESETS.map(([label,days])=>{
          const fromDate=new Date(Date.now()-days*864e5).toISOString().slice(0,10);
          const active=dateFrom===fromDate&&dateTo===todayStr;
          return (
            <button key={label} onClick={()=>applyPreset(days)}
              style={{background:active?"rgba(0,229,160,0.08)":"none",
                border:`1px solid ${active?"rgba(0,229,160,0.4)":"#282828"}`,
                color:active?"#00e5a0":"#555",fontFamily:"var(--mono)",
                fontSize:8,padding:"1px 8px",cursor:"pointer",transition:"all 0.15s"}}>
              {label}
            </button>
          );
        })}
        <span style={{color:"#444",fontSize:8,marginLeft:2}}>from</span>
        <input type="date" value={dateFrom}
          min={allData[0]?.date||"2020-01-01"} max={dateTo}
          onChange={e=>setDateFrom(e.target.value)}
          style={{background:"var(--bg2)",border:"1px solid var(--border2)",
            color:"#ccc",fontFamily:"var(--mono)",fontSize:8,padding:"1px 6px",
            outline:"none",colorScheme:"dark"}}/>
        <span style={{color:"#444",fontSize:8}}>to</span>
        <input type="date" value={dateTo}
          min={dateFrom} max={todayStr}
          onChange={e=>setDateTo(e.target.value)}
          style={{background:"var(--bg2)",border:"1px solid var(--border2)",
            color:"#ccc",fontFamily:"var(--mono)",fontSize:8,padding:"1px 6px",
            outline:"none",colorScheme:"dark"}}/>
        <span style={{fontSize:8,color:"#444",marginLeft:2}}>
          {chartData.length}d shown
        </span>
      </div>

      {/* Chart with Brush for drag-select zoom */}
      <ResponsiveContainer width="100%" height={110}>
        <ComposedChart data={chartData} margin={{top:2,right:4,bottom:0,left:4}}>
          <XAxis dataKey="date" hide/>
          <YAxis yAxisId="left"  hide domain={[volMin,volMax]}/>
          <YAxis yAxisId="right" hide orientation="right" domain={["auto","auto"]}/>
          <YAxis yAxisId="omega" hide orientation="right" domain={["auto","auto"]}/>
          <Tooltip
            contentStyle={{background:"#0d0d0d",border:"1px solid #222",
              fontSize:9,padding:"4px 8px"}}
            formatter={(v,name)=>{
              if(name==="iv")    return [`${(v*100).toFixed(1)}%`,"ATM IV (ref)"];
              if(name==="omega") return [`${Number(v).toFixed(1)}×`,"Elasticity Ω"];
              const s=SERIES.find(s=>s.k===name);
              if(!s) return [v,name];
              if(name==="ivrank") return [`${(v*100).toFixed(0)}th pct`,"HV Rank"];
              if(name==="price")  return [`$${Number(v).toFixed(2)}`,"Price"];
              return [`${(v*100).toFixed(1)}%`,s.label];
            }}
            labelFormatter={l=>l}/>
          <Brush dataKey="date" height={16} stroke="#282828"
            fill="#0a0a0a" travellerWidth={6}
            style={{fontSize:8}}
            onChange={({startIndex,endIndex})=>{
              if(chartData[startIndex]&&chartData[endIndex]){
                setDateFrom(chartData[startIndex].date);
                setDateTo(chartData[endIndex].date);
              }
            }}/>
          {currentIV&&(
            <Line yAxisId="left" type="monotone" dataKey="iv" name="iv"
              stroke="#f5a623" dot={false} strokeWidth={1} strokeDasharray="4 2"/>
          )}
          {SERIES.filter(s=>show[s.k]).map(s=>(
            <Line key={s.k} yAxisId={s.axis} type="monotone" dataKey={s.k} name={s.k}
              stroke={s.color} dot={false}
              strokeWidth={s.k==="hv20"?1.5:1.2}
              strokeDasharray={s.dash||"0"}/>
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Date range display */}
      <div style={{display:"flex",justifyContent:"space-between",
        fontSize:8,color:"#444",marginTop:1}}>
        <span>{chartData[0]?.date||dateFrom}</span>
        <span>{chartData[chartData.length-1]?.date||dateTo}</span>
      </div>
    </div>
  );
}


// ── ChainPositions — expandable positions used inside chain view ──────────────
function ChainPositions({positions, liveSpots, onAddToBuilder, onSelectRow, selectedKey=null}) {
  const [expanded, setExpanded] = useState(new Set());
  const toggle = i => setExpanded(prev=>{const n=new Set(prev);n.has(i)?n.delete(i):n.add(i);return n;});
  const todayStr = new Date().toISOString().slice(0,10);
  return (
    <table className="chain-table" style={{marginTop:2}}>
      <thead>
        <tr>
          <th style={{width:28}}>LAB</th>
          <th>SIDE</th><th>STRIKE</th><th>EXPIRY</th><th>DTE</th>
          <th>QTY</th><th>ENTRY</th><th>MID</th><th>P&L</th><th>P&L%</th>
          <th>Δ</th><th>Θ</th><th>IV</th><th>STATUS</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p,i)=>{
          const pct=p.pnl_pct||0;
          const urg=p.dte<=21?"#ff4d6d":p.dte<=45?"#f5a623":null;
          const isOpen=expanded.has(i);
          const spot=spotPrice(liveSpots[p.ticker])||p.mid||0;
          return (
            <React.Fragment key={i}>
              {/* Build a row-compatible shape for OptionAnalysis */}
              {/* Key = ticker+type+strike+expiry to uniquely identify */}
              {(()=>{
                const rowKey=`${p.ticker}_${p.type}_${p.strike}_${p.expiry}`;
                const isSelected=selectedKey===rowKey;
                const analysisRow={
                  strike:parseFloat(p.strike)||0,
                  type:p.type,
                  iv:parseFloat(p.iv)||0,
                  delta:parseFloat(p.delta)||0,
                  theta:parseFloat(p.theta)||0,
                  gamma:parseFloat(p.gamma)||0,
                  vega:parseFloat(p.vega)||0,
                  bid:parseFloat(p.bid)||parseFloat(p.entry_price)||0,
                  ask:parseFloat(p.ask)||parseFloat(p.mid)||0,
                  mid:parseFloat(p.mid)||0,
                  volume:p.volume||0,
                  OI:p.OI||p.open_interest||0,
                  expiry:p.expiry||""
                };
                return (
              <tr style={{
                  cursor:"pointer",
                  outline:isSelected?"1px solid rgba(0,229,160,0.6)":"none",
                  outlineOffset:"-1px",
                  background:isSelected?"rgba(0,229,160,0.07)":isOpen?"rgba(0,229,160,0.03)":"none",
                  boxShadow:isSelected?"inset 3px 0 0 #00e5a0":
                    `inset 2px 0 0 ${p.direction==="long"?"#00e5a0":"#ff4d6d"}`}}
                onClick={()=>{
                  toggle(i);
                  if(onSelectRow) onSelectRow(analysisRow, rowKey);
                }}>
                <td style={{padding:"2px 6px"}} onClick={e=>e.stopPropagation()}>
                  <button onClick={()=>onAddToBuilder&&onAddToBuilder(p)}
                    title="Add to Builder"
                    style={{background:"none",border:"1px solid #1e1e1e",color:"#666",
                      fontFamily:"var(--mono)",fontSize:9,padding:"1px 5px",cursor:"pointer",transition:"all 0.15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
                    onMouseLeave={e=>{e.currentTarget.style.color="#333";e.currentTarget.style.borderColor="#1e1e1e";}}>+</button>
                </td>
                <td style={{color:p.direction==="long"?"#00e5a0":"#ff4d6d",fontSize:10}}>
                  {p.direction?.toUpperCase()} {p.type}
                </td>
                <td className="strike-col">
                  {fmt(p.strike)}
                  <span style={{fontSize:8,color:isOpen?"var(--green)":"#444",marginLeft:4}}>
                    {isOpen?"▾":"▸"}
                  </span>
                </td>
                <td style={{fontSize:10,color:"#999"}}>{p.expiry}</td>
                <td><span className="dte-badge" style={{fontSize:9,
                  borderColor:urg?"rgba(255,77,109,0.35)":"#282828",color:urg||"#555"}}>
                  {p.dte}d</span></td>
                <td>{p.contracts}</td>
                <td style={{color:"#999"}}>${fmt(p.entry_price,2)}</td>
                <td>${fmt(p.mid,2)}</td>
                <td style={{color:pnlColor(p.pnl),fontWeight:600}}>{p.pnl>=0?"+":""}{fmtUSD(p.pnl)}</td>
                <td style={{color:pnlColor(pct)}}>{pct>=0?"+":""}{fmt(pct,1)}%</td>
                <td>{fmt(p.delta,3)}</td>
                <td style={{color:p.theta<0?"#ff4d6d":"#00e5a0"}}>{fmt(p.theta,2)}</td>
                <td>{fmtPct(p.iv)}</td>
                <td>{p.alerts?.length
                  ?<span style={{color:"#f5a623",fontSize:10,fontWeight:700}}>⚠ ACT</span>
                  :<span style={{color:"#444",fontSize:10}}>HOLD</span>}</td>
              </tr>
                ); /* end return from IIFE */
              })()}
              {isOpen&&(
                <tr><td colSpan={14} style={{padding:"8px 12px",
                  background:"rgba(0,0,0,0.35)",
                  borderBottom:"2px solid rgba(0,229,160,0.12)"}}>
                  {/* Greeks summary */}
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:8,fontSize:9}}>
                    {[["Δ DELTA",fmt(p.delta,3),p.delta>0?"#00e5a0":p.delta<0?"#ff4d6d":"#555"],
                      ["Θ THETA",`${fmt(p.theta,2)}/d`,p.theta<0?"#ff4d6d":"#00e5a0"],
                      ["IV",fmtPct(p.iv),"#4da8ff"],
                      ["P&L",`${p.pnl>=0?"+":""}${fmtUSD(p.pnl)}`,pnlColor(p.pnl)],
                      ["P&L%",`${pct>=0?"+":""}${fmt(pct,1)}%`,pnlColor(pct)],
                      ["ENTRY",`$${fmt(p.entry_price,2)}`,"#999"],
                      ["MID",`$${fmt(p.mid,2)}`,"#ccc"],
                      ["DTE",`${p.dte}d`,p.dte<=21?"#ff4d6d":p.dte<=45?"#f5a623":"#777"],
                    ].map(([label,val,color])=>(
                      <div key={label} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <span style={{color:"#555",letterSpacing:"0.06em"}}>{label}</span>
                        <span style={{fontWeight:700,color,fontSize:10}}>{val}</span>
                      </div>
                    ))}
                  </div>
                  {/* IV scenario */}
                  <div style={{fontSize:9,color:"#666",marginBottom:4}}>
                    IV SCENARIO — {p.ticker} {p.direction?.toUpperCase()} {p.type}
                    &nbsp;${fmt(p.strike)} · spot ${fmt(spot)}
                  </div>
                  <IVScenarioTable
                    legs={[{id:0,real:true,type:p.type||"call",dir:p.direction||"long",
                      strike:parseFloat(p.strike)||0,iv:parseFloat(p.iv)||0.25,
                      qty:parseInt(p.contracts)||1,dte:parseInt(p.dte)||30,
                      expiry:p.expiry||"",entry:parseFloat(p.entry_price)||0,
                      ticker:p.ticker,closing:false}]}
                    spot0={spot} spot={spot} r={0.04}
                    analysisDate={todayStr} mode="pnl"/>
                </td></tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── SortTh — hoisted from PortfolioPanel to avoid component-in-render crash ──
function SortTh({label, sortKey, setSortKey, sortAsc, setSortAsc, colKey, style={}}) {
  const active = sortKey === colKey;
  return (
    <th onClick={()=>{
          if(active) setSortAsc(a=>!a);
          else { setSortKey(colKey); setSortAsc(true); }
        }}
      style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap",...style}}>
      {label}
      <span style={{fontSize:8,color:active?"var(--green)":"#333",marginLeft:3}}>
        {active?(sortAsc?"▲":"▼"):"⇅"}
      </span>
    </th>
  );
}

// ── PortfolioPanel ─────────────────────────────────────────────────────────────
function PortfolioPanel({data, onTickerOpen, liveSpots={}, onAddToBuilder}) {
  const [sortKey,  setSortKey]  = useState("ticker");
  const [sortAsc,  setSortAsc]  = useState(true);
  const [filter,   setFilter]   = useState("");
  const [expanded, setExpanded] = useState(new Set());

  if (!data) return (
    <div className="panel-empty">
      No portfolio loaded<br/>
      <span style={{fontSize:10,color:"#999",marginTop:8,display:"block"}}>
        Import via sidebar → Settings → Portfolio Import
      </span>
    </div>
  );

  const {positions=[],alerts=[],expirations=[],summary={},
         account_value:acctValue=0,cost_basis:costBasis=0} = data;
  const {total_pnl:totalPnl=0,total_pnl_pct:totalPct=0,
         net_delta:netDelta=0,net_theta:netTheta=0,net_vega:netVega=0} = summary;

  // ── Sort + filter ─────────────────────────────────────────────────────────
  const toggleSort = key => {
    if(sortKey===key) setSortAsc(a=>!a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const q = filter.trim().toLowerCase();
  const filtered = positions.filter(p=>
    !q||p.ticker?.toLowerCase().includes(q)||
       p.type?.toLowerCase().includes(q)||
       p.direction?.toLowerCase().includes(q)
  );
  const sorted = [...filtered].sort((a,b)=>{
    const av=a[sortKey]??"", bv=b[sortKey]??"";
    const cmp = typeof av==="number"?av-bv:String(av).localeCompare(String(bv));
    return sortAsc?cmp:-cmp;
  });

  const toggleExpand = (i,e) => {
    e.stopPropagation();
    setExpanded(prev=>{
      const next=new Set(prev);
      next.has(i)?next.delete(i):next.add(i);
      return next;
    });
  };

  // Build a single-leg array for IVScenarioTable
  const posToScenarioLeg = p => [{
    id:0, real:true, type:p.type||"call", dir:p.direction||"long",
    strike:parseFloat(p.strike)||0, iv:parseFloat(p.iv)||0.25,
    qty:parseInt(p.contracts)||1,  dte:parseInt(p.dte)||30,
    expiry:p.expiry||"",           entry:parseFloat(p.entry_price)||0,
    ticker:p.ticker, closing:false,
  }];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12,padding:"2px 0"}}>

      {/* ── Summary bar ── */}
      <div className="acct-value-bar">
        <div>
          <div style={{fontSize:9,color:"#999",letterSpacing:"0.15em",marginBottom:4}}>
            PORTFOLIO VALUE (OPTIONS)
          </div>
          <div style={{fontSize:26,fontWeight:700,color:"#fff",lineHeight:1}}>
            ${Math.abs(acctValue).toLocaleString("en-US",{minimumFractionDigits:2})}
          </div>
          <div style={{fontSize:11,marginTop:5,color:pnlColor(totalPnl)}}>
            {totalPnl>=0?"+":""}{fmtUSD(totalPnl)}&nbsp;
            ({totalPnl>=0?"+":""}{fmt(totalPct,1)}%)
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:20}}>
          {[["POS",positions.length,"#fff"],
            ["≤45d",expirations.length,expirations.length>0?"#f5a623":"#555"],
            ["⚠",alerts.length,alerts.length>0?"#ff4d6d":"#555"]
          ].map(([l,v,c])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:"#777",letterSpacing:"0.1em",marginBottom:3}}>{l}</div>
              <div style={{fontSize:18,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Net Greeks bar ── */}
      <div className="greeks-bar">
        {[["NET Δ",fmt(netDelta,3),netDelta>0?"#00e5a0":netDelta<0?"#ff4d6d":"#555","Directional exposure"],
          ["NET Θ",fmt(netTheta,2),netTheta<0?"#ff4d6d":"#00e5a0","Daily decay"],
          ["NET V",fmt(netVega,2),netVega>0?"#4da8ff":"#f5a623","Vol sensitivity"],
          ["BASIS",`$${Math.abs(costBasis).toFixed(0)}`,"#fff","Capital deployed"],
        ].map(([l,v,c,tip])=>(
          <div key={l} className="greek-stat" title={tip}>
            <span className="greek-stat-label">{l}</span>
            <span className="greek-stat-val" style={{color:c}}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── Alerts + Expirations ── */}
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
                    <span style={{color:"#999",marginLeft:6,fontSize:10}}>
                      {a.type} {fmt(a.strike)}
                    </span>
                    <div style={{fontSize:10,color:"#f5a623",marginTop:1}}>{a.message}</div>
                  </div>
                  {a.dte!=null&&(
                    <span className="dte-badge" style={{fontSize:9}}>{a.dte}d</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {expirations.length>0&&(
            <div style={{flex:1,minWidth:160}}>
              <div className="section-label" style={{marginBottom:6}}>EXPIRATIONS</div>
              {expirations.map((e,i)=>(
                <div key={i} onClick={()=>onTickerOpen&&onTickerOpen(e.ticker)}
                  style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,
                    fontSize:11,padding:"3px 8px",border:"1px solid #1e1e1e",cursor:"pointer"}}>
                  <b style={{color:"#fff",width:44}}>{e.ticker}</b>
                  <span style={{color:"#999",fontSize:10}}>{e.type} {fmt(e.strike)}</span>
                  <span style={{marginLeft:"auto"}}>
                    <span className="dte-badge" style={{fontSize:9,
                      borderColor:e.dte<=21?"rgba(255,77,109,0.4)":e.dte<=45?"rgba(245,166,35,0.4)":"#282828",
                      color:e.dte<=21?"#ff4d6d":e.dte<=45?"#f5a623":"#555"}}>
                      {e.dte}d
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Filter bar ── */}
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <input
          value={filter}
          onChange={e=>setFilter(e.target.value)}
          placeholder="Filter ticker / type / direction…"
          style={{flex:1,background:"var(--bg2)",border:"1px solid var(--border2)",
            color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"4px 10px",
            outline:"none"}}/>
        {filter&&(
          <button onClick={()=>setFilter("")}
            style={{background:"none",border:"none",color:"#999",cursor:"pointer",
              fontFamily:"var(--mono)",fontSize:11}}>✕</button>
        )}
        <span style={{fontSize:9,color:"#777",flexShrink:0}}>
          {sorted.length}/{positions.length}
        </span>
      </div>

      {/* ── Positions table ── */}
      <div style={{overflowX:"auto"}}>
        <table className="chain-table">
          <thead>
            <tr>
              <th title="Add to Builder" style={{width:28}}>LAB</th>
              <SortTh colKey="ticker" label="TICKER" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="direction" label="SIDE" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="strike" label="STRIKE" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="expiry" label="EXPIRY" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="dte" label="DTE" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <th>QTY</th>
              <th>ENTRY</th>
              <th>MID</th>
              <SortTh colKey="pnl" label="P&L" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="pnl_pct" label="P&L%" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="delta" label="Δ" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="theta" label="Θ" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <SortTh colKey="iv" label="IV" sortKey={sortKey} setSortKey={setSortKey} sortAsc={sortAsc} setSortAsc={setSortAsc}/>
              <th>STATUS</th>
              <th title="Open chain">CHAIN</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length===0
              ? <tr><td colSpan={16} style={{textAlign:"center",padding:16,color:"#999"}}>
                  {filter?"No matches":"No positions"}
                </td></tr>
              : sorted.map((p,i)=>{
                  const pct=p.pnl_pct||0;
                  const urg=p.dte<=21?"#ff4d6d":p.dte<=45?"#f5a623":null;
                  const isOpen=expanded.has(i);
                  const spot = spotPrice(liveSpots[p.ticker]) || p.mid || 0;
                  return (
                    <React.Fragment key={i}>
                      {/* Main row */}
                      <tr style={{cursor:"pointer",
                        background:isOpen?"rgba(0,229,160,0.03)":"none"}}
                        onClick={e=>toggleExpand(i,e)}>
                        {/* + Lab button — same style as ChainTable */}
                        <td style={{padding:"2px 6px"}} onClick={e=>e.stopPropagation()}>
                          <button
                            onClick={e=>{e.stopPropagation();if(onAddToBuilder)onAddToBuilder(p);}}
                            title="Add to Builder"
                            style={{background:"none",border:"1px solid #1e1e1e",color:"#666",
                              fontFamily:"var(--mono)",fontSize:9,padding:"1px 5px",cursor:"pointer",
                              transition:"all 0.15s"}}
                            onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
                            onMouseLeave={e=>{e.currentTarget.style.color="#333";e.currentTarget.style.borderColor="#1e1e1e";}}>
                            +
                          </button>
                        </td>
                        <td className="strike-col" style={{fontWeight:700}}>
                          {p.ticker}
                          <span style={{fontSize:8,color:isOpen?"var(--green)":"#444",marginLeft:4}}>
                            {isOpen?"▾":"▸"}
                          </span>
                        </td>
                        <td style={{color:p.direction==="long"?"#00e5a0":"#ff4d6d",fontSize:10}}>
                          {p.direction?.toUpperCase()} {p.type}
                        </td>
                        <td>{fmt(p.strike)}</td>
                        <td style={{fontSize:10,color:"#999"}}>{p.expiry}</td>
                        <td>
                          <span className="dte-badge" style={{fontSize:9,
                            borderColor:urg?"rgba(255,77,109,0.35)":"#282828",
                            color:urg||"#555"}}>
                            {p.dte}d
                          </span>
                        </td>
                        <td>{p.contracts}</td>
                        <td style={{color:"#999"}}>${fmt(p.entry_price,2)}</td>
                        <td>${fmt(p.mid,2)}</td>
                        <td style={{color:pnlColor(p.pnl),fontWeight:600}}>
                          {p.pnl>=0?"+":""}{fmtUSD(p.pnl)}
                        </td>
                        <td style={{color:pnlColor(pct)}}>
                          {pct>=0?"+":""}{fmt(pct,1)}%
                        </td>
                        <td>{fmt(p.delta,3)}</td>
                        <td style={{color:p.theta<0?"#ff4d6d":"#00e5a0"}}>{fmt(p.theta,2)}</td>
                        <td>{fmtPct(p.iv)}</td>
                        <td>
                          {p.alerts?.length
                            ? <span style={{color:"#f5a623",fontSize:10,fontWeight:700}}>⚠ ACT</span>
                            : <span style={{color:"#999",fontSize:10}}>HOLD</span>}
                        </td>

                        <td onClick={e=>{e.stopPropagation();onTickerOpen&&onTickerOpen(p.ticker);}}
                          style={{color:"#777",fontSize:10,cursor:"pointer",padding:"0 8px"}}
                          onMouseEnter={e=>e.currentTarget.style.color="var(--green)"}
                          onMouseLeave={e=>e.currentTarget.style.color="#777"}>
                          ↗
                        </td>
                      </tr>

                      {/* Inline IV scenario table */}
                      {isOpen&&(
                        <tr>
                          <td colSpan={16} style={{padding:"8px 12px",
                            background:"rgba(0,0,0,0.3)",
                            borderBottom:"2px solid rgba(0,229,160,0.15)"}}>
                            <div style={{fontSize:9,color:"#999",marginBottom:6,
                              letterSpacing:"0.08em"}}>
                              IV SCENARIO — {p.ticker} {p.direction?.toUpperCase()} {p.type}
                              &nbsp;${fmt(p.strike)} exp {p.expiry}
                              &nbsp;·&nbsp;spot ${fmt(spot)}
                            </div>
                            <IVScenarioTable
                              legs={posToScenarioLeg(p)}
                              spot0={spot} spot={spot} r={0.04}
                              analysisDate={new Date().toISOString().slice(0,10)}
                              mode="pnl"/>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── StrategyPanel ──────────────────────────────────────────────────────────────
function StrategyPanel({chainData, onLabOpen}) {
  const [mode,         setMode]        = useState("longcall");
  const [rankingOpen,  setRankingOpen] = useState(true);   // collapsible grid
  // Per-strategy editable exit rules stored as {strategyId: [rule, rule, ...]}
  const [exitEdits,    setExitEdits]   = useState({});
  const [editingExit,  setEditingExit] = useState(null);   // {sid, idx}
  const [exitDraft,    setExitDraft]   = useState("");

  if (!chainData) return <div className="panel-empty">Load a chain first</div>;
  const {chain=[],spot,iv_rank:ivRank,dte,atm_iv:atmIV} = chainData;

  const strategies = [
    {id:"longcall",   name:"LONG CALL",        color:"#00e5a0", category:"DEBIT",
     desc:"Directional bullish. Pay premium, profit if stock rises.",
     entryRule:"IV Rank < 30", strikeGuide:"ATM or 1-3 strikes OTM.",
     exitRules:["Sell at 100% profit","Stop at 50% of premium paid","Exit at 21 DTE"],
     score:ivRank!=null?Math.max(0,100-ivRank*1.8):null,
     signal:ivRank<30?"BUY":ivRank>55?"AVOID":"NEUTRAL"},
    {id:"longput",    name:"LONG PUT",          color:"#00e5a0", category:"DEBIT",
     desc:"Directional bearish. Profit if stock falls below strike.",
     entryRule:"IV Rank < 30", strikeGuide:"ATM or 1-2 strikes OTM.",
     exitRules:["Sell at 100% profit","Stop at 50% of premium paid","Exit at 21 DTE"],
     score:ivRank!=null?Math.max(0,100-ivRank*1.8):null,
     signal:ivRank<30?"BUY":ivRank>55?"AVOID":"NEUTRAL"},
    {id:"csp",        name:"CASH-SECURED PUT",  color:"#4da8ff", category:"CREDIT",
     desc:"Sell OTM put. Keep premium or acquire stock at discount.",
     entryRule:"IV Rank > 50, 30-45 DTE", strikeGuide:"10-20% OTM.",
     exitRules:["Buy back at 50% profit","Roll if tested before 21 DTE","Close at 21 DTE"],
     score:ivRank!=null?Math.max(0,ivRank*0.9-Math.abs(dte-37)*0.9+5):null,
     signal:ivRank>50&&dte>=25&&dte<=50?"SELL":ivRank>40?"WATCH":"NEUTRAL"},
    {id:"coveredcall",name:"COVERED CALL",      color:"#4da8ff", category:"CREDIT",
     desc:"Sell OTM call against shares. Collect premium, cap upside.",
     entryRule:"IV Rank > 45, own underlying", strikeGuide:"10-15% OTM (delta 0.25-0.35).",
     exitRules:["Buy back at 50% profit","Roll up-and-out near strike","Let expire OTM"],
     score:ivRank!=null?Math.max(0,ivRank*0.85-Math.abs(dte-30)*0.7):null,
     signal:ivRank>45?"SELL":"NEUTRAL"},
    {id:"ironcondor", name:"IRON CONDOR",       color:"#9b6dff", category:"CREDIT",
     desc:"Sell OTM strangle + wings. Profit in range-bound market.",
     entryRule:"IV Rank > 60, 30-45 DTE", strikeGuide:"Short at 16Δ, wings 5-10pt wide.",
     exitRules:["Close at 50% max profit","Adjust if short delta > 0.30","Exit at 21 DTE"],
     score:ivRank!=null?Math.max(0,ivRank-45-Math.abs(dte-37)*0.6):null,
     signal:ivRank>60&&dte>=25&&dte<=50?"SELL":ivRank>45?"WATCH":"AVOID"},
    {id:"vertical",   name:"DEBIT SPREAD",      color:"#f5a623", category:"DEBIT",
     desc:"Buy near strike, sell further OTM. Lower cost vs naked long.",
     entryRule:"Any IV Rank", strikeGuide:"Buy ATM, sell 5-10% OTM.",
     exitRules:["Close at 75% max profit","Stop at 50% of debit paid","Exit at 21 DTE"],
     score:ivRank!=null?40+Math.min(35,ivRank*0.5):null,
     signal:"NEUTRAL"},
  ];

  const sorted = [...strategies].sort((a,b)=>(b.score||0)-(a.score||0));
  const active  = strategies.find(s=>s.id===mode)||strategies[0];

  // Per-strategy exit rules: custom edits override defaults
  const getExitRules = sid => exitEdits[sid] || strategies.find(s=>s.id===sid)?.exitRules || [];
  const activeExitRules = getExitRules(active.id);

  const commitExitEdit = () => {
    if(!editingExit) return;
    const {sid, idx} = editingExit;
    const rules = [...getExitRules(sid)];
    rules[idx] = exitDraft;
    setExitEdits(prev=>({...prev,[sid]:rules}));
    setEditingExit(null);
  };

  function recStrikes(modeOverride, chainOverride, spotOverride, dteOverride) {
    const _mode  = modeOverride  || mode;
    const _chain = chainOverride || chain;
    const _spot  = spotOverride  || spot;
    const _dte   = dteOverride   || dte;
    const _calls = _chain.filter(r=>r.type==="call").sort((a,b)=>a.strike-b.strike);
    const _puts  = _chain.filter(r=>r.type==="put").sort((a,b)=>a.strike-b.strike);
    switch(_mode) {
      case "longcall":    return _calls.filter(r=>r.strike>=_spot*0.99&&r.strike<=_spot*1.10).slice(0,6)
                            .map(r=>({...r,type:"call",note:r.strike<=_spot*1.015?"ATM":`${((r.strike/_spot-1)*100).toFixed(1)}%OTM`}));
      case "longput":     return _puts.filter(r=>r.strike<=_spot*1.01&&r.strike>=_spot*0.90).slice(-6)
                            .map(r=>({...r,type:"put",note:r.strike>=_spot*0.985?"ATM":`${((1-r.strike/_spot)*100).toFixed(1)}%OTM`}));
      case "csp":         return _puts.filter(r=>r.strike>=_spot*0.82&&r.strike<=_spot*0.97).slice(-6)
                            .map(r=>({...r,type:"put",note:`${((1-r.strike/_spot)*100).toFixed(1)}%OTM`,
                              annRet:r.bid&&_dte?`${((r.bid/r.strike)*(365/_dte)*100).toFixed(0)}%`:null}));
      case "coveredcall": return _calls.filter(r=>r.strike>=_spot*1.02&&r.strike<=_spot*1.15).slice(0,6)
                            .map(r=>({...r,type:"call",note:`${((r.strike/_spot-1)*100).toFixed(1)}%OTM`,
                              annRet:r.bid&&_dte?`${((r.bid/_spot)*(365/_dte)*100).toFixed(0)}%`:null}));
      case "ironcondor": {
        const sp=_puts.filter(r=>r.strike<=_spot*0.95).slice(-1)[0];
        const sc=_calls.filter(r=>r.strike>=_spot*1.05)[0];
        const lp=_puts.filter(r=>r.strike<=_spot*0.90).slice(-1)[0];
        const lc=_calls.filter(r=>r.strike>=_spot*1.10)[0];
        return [sp,sc,lp,lc].filter(Boolean).map((r,i)=>({...r,
          type:i<2?"put":"call",note:["SHORT PUT","SHORT CALL","LONG PUT","LONG CALL"][i]}));
      }
      case "vertical": return _calls.filter(r=>r.strike>=_spot*0.99&&r.strike<=_spot*1.08).slice(0,4)
                          .map((r,i)=>({...r,note:i===0?"BUY":"SELL"}));
      default: return [];
    }
  }

  const recs = recStrikes(null,null,null,null);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>

      {/* ── Header row ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <button onClick={()=>setRankingOpen(o=>!o)}
          style={{background:"none",border:"none",cursor:"pointer",padding:0,
            display:"flex",alignItems:"center",gap:6}}>
          <span className="section-label">STRATEGY RANKING</span>
          <span style={{fontSize:9,color:"#777",transition:"transform 0.2s",display:"inline-block",
            transform:rankingOpen?"rotate(180deg)":"rotate(0deg)"}}>▾</span>
        </button>
        <span style={{fontSize:10,color:"#777"}}>
          IVR&nbsp;<b style={{color:ivRank<30?"#00e5a0":ivRank>70?"#ff4d6d":"#f5a623"}}>{fmt(ivRank,1)}</b>
          &nbsp;·&nbsp;DTE&nbsp;<b style={{color:"#e0e0e0"}}>{dte}</b>
          &nbsp;·&nbsp;ATM IV&nbsp;<b style={{color:"#4da8ff"}}>{fmtPct(atmIV)}</b>
        </span>
      </div>

      {/* ── Collapsible strategy grid ── */}
      {rankingOpen&&(
        <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
          {sorted.map((s,rank)=>{
            const rgb=s.color==="#00e5a0"?"0,229,160":s.color==="#4da8ff"?"77,168,255":
                      s.color==="#9b6dff"?"155,109,255":"245,166,35";
            const on=mode===s.id;
            return (
              <div key={s.id} onClick={()=>setMode(s.id)}
                style={{border:`1px solid ${on?s.color:"#1e1e1e"}`,
                  background:on?`rgba(${rgb},0.05)`:"var(--bg1)",
                  padding:"7px 9px",cursor:"pointer",transition:"all 0.15s",position:"relative"}}>
                {rank===0&&<span style={{position:"absolute",top:4,right:5,fontSize:8,color:"#f5a623"}}>★</span>}
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <span style={{fontSize:9,fontWeight:700,color:on?s.color:"#bbb"}}>{s.name}</span>
                  <span style={{fontSize:8,color:s.color,background:`rgba(${rgb},0.12)`,
                    padding:"1px 4px"}}>{s.category}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:9,color:signalColor(s.signal),fontWeight:700}}>{s.signal}</span>
                  {onLabOpen&&(
                    <button onClick={e=>{
                      e.stopPropagation();
                      const r2=recStrikes(s.id,chain,spot,dte);
                      onLabOpen(r2.slice(0,4).map((rec,i)=>({
                        id:i+1,type:rec.type||"call",
                        dir:rec.note?.includes("SHORT")||rec.note==="SELL"?"short":"long",
                        strike:rec.strike,iv:rec.iv||atmIV||0.25,qty:1,
                        dte:dte||30,expiry:chainData?.expiry||"",entry:rec.mid||rec.ask||0,
                      })));
                    }}
                      style={{background:"none",border:"1px solid #1e1e1e",color:"#777",
                        fontFamily:"var(--mono)",fontSize:8,padding:"1px 5px",cursor:"pointer",
                        transition:"all 0.15s"}}
                      onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
                      onMouseLeave={e=>{e.currentTarget.style.color="#777";e.currentTarget.style.borderColor="#1e1e1e";}}>
                      LAB →
                    </button>
                  )}
                </div>
                {s.score!=null&&(
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{flex:1,height:2,background:"#1a1a1a"}}>
                      <div style={{height:"100%",width:`${Math.min(100,s.score)}%`,
                        background:s.color,transition:"width 0.5s"}}/>
                    </div>
                    <span style={{fontSize:9,color:"#777",width:20,textAlign:"right"}}>
                      {s.score.toFixed(0)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Active strategy type + description ── */}
        <div style={{display:"flex",alignItems:"center",gap:8,
          padding:"6px 0 2px",borderTop:"1px solid var(--border)",marginTop:4}}>
          <span style={{fontSize:11,fontWeight:700,color:active.color}}>{active.name}</span>
          <span style={{fontSize:8,padding:"1px 6px",
            background:`rgba(${active.color==="#00e5a0"?"0,229,160":active.color==="#4da8ff"?"77,168,255":active.color==="#9b6dff"?"155,109,255":"245,166,35"},0.12)`,
            color:active.color}}>{active.category}</span>
          <span style={{fontSize:9,color:"#888",marginLeft:4}}>{active.desc}</span>
        </div>
        </>
      )}

      {/* ── Active strategy detail ── */}
      <div style={{border:"1px solid #1e1e1e",padding:"10px 12px",background:"var(--bg1)",
        display:"flex",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:2,minWidth:160}}>
          <div style={{fontSize:11,fontWeight:700,color:active.color,marginBottom:4}}>
            {active.name}
          </div>
          <div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>
            {active.desc}
          </div>
          <div style={{fontSize:10,color:"#999"}}>
            <span style={{color:"#777"}}>ENTRY&nbsp;</span>
            <span style={{color:"#ccc"}}>{active.entryRule}</span>
          </div>
          <div style={{fontSize:10,color:"#999",marginTop:3}}>{active.strikeGuide}</div>
        </div>

        <div style={{flex:1,minWidth:140}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
            <span style={{fontSize:10,color:"#777",letterSpacing:"0.08em"}}>EXIT RULES</span>
            {exitEdits[active.id]&&(
              <button onClick={()=>setExitEdits(p=>({...p,[active.id]:undefined}))}
                title="Reset to defaults"
                style={{background:"none",border:"none",color:"#666",cursor:"pointer",
                  fontFamily:"var(--mono)",fontSize:8}}
                onMouseEnter={e=>e.target.style.color="#f5a623"}
                onMouseLeave={e=>e.target.style.color="#666"}>↺</button>
            )}
          </div>
          {activeExitRules.map((rule,i)=>{
            const isEditing = editingExit?.sid===active.id && editingExit?.idx===i;
            const icon = i===0?"✓":i===1?"✗":"⏱";
            const iconColor = i===0?"#00e5a0":i===1?"#ff4d6d":"#f5a623";
            return (
              <div key={i} style={{display:"flex",gap:6,marginBottom:4,fontSize:10,
                alignItems:"flex-start"}}>
                <span style={{color:iconColor,flexShrink:0,marginTop:1}}>{icon}</span>
                {isEditing ? (
                  <input autoFocus value={exitDraft}
                    onChange={e=>setExitDraft(e.target.value)}
                    onBlur={commitExitEdit}
                    onKeyDown={e=>{if(e.key==="Enter")commitExitEdit();
                                   if(e.key==="Escape")setEditingExit(null);}}
                    style={{flex:1,background:"var(--bg2)",border:"1px solid var(--green)",
                      color:"#fff",fontFamily:"var(--mono)",fontSize:10,padding:"1px 6px",
                      outline:"none"}}/>
                ) : (
                  <span style={{color:"#999",lineHeight:1.4,cursor:"text",flex:1,
                    borderBottom:"1px dashed transparent",transition:"border-color 0.15s"}}
                    title="Click to edit"
                    onClick={()=>{setEditingExit({sid:active.id,idx:i});setExitDraft(rule);}}
                    onMouseEnter={e=>e.target.style.borderBottomColor="#444"}
                    onMouseLeave={e=>e.target.style.borderBottomColor="transparent"}>
                    {rule}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recommended strikes — also inside collapsible ── */}
      {rankingOpen&&recs.length>0&&(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span className="section-label">RECOMMENDED STRIKES — {active.name}</span>
            <span style={{fontSize:9,color:"#666"}}>
              {active.category==="CREDIT"
                ? "Strikes to sell for premium collection"
                : "Strikes to buy for directional exposure"}
            </span>
          </div>
          <table className="chain-table">
            <thead><tr>
              <th>ROLE</th><th>STRIKE</th><th>BID</th><th>ASK</th><th>MID</th>
              <th>IV</th><th>Δ</th><th>Θ</th>
              {recs[0]?.annRet!==undefined&&<th title="Annualised return on capital">ANN%</th>}
            </tr></thead>
            <tbody>
              {recs.map((r,i)=>(
                <tr key={i} style={{
                  borderLeft:r.note?.includes("SHORT")||r.note==="SELL"
                    ?"2px solid #ff4d6d"
                    :r.note==="BUY"||r.note==="ATM"
                    ?"2px solid #00e5a0":"none"}}>
                  <td style={{color:"#f5a623",fontSize:10}}>{r.note}</td>
                  <td className="strike-col">{fmt(r.strike)}</td>
                  <td>{fmt(r.bid,2)}</td>
                  <td>{fmt(r.ask,2)}</td>
                  <td style={{color:"#fff",fontWeight:600}}>{fmt(r.mid,2)}</td>
                  <td>{fmtPct(r.iv)}</td>
                  <td style={{color:r.delta>0?"#00e5a0":"#ff4d6d"}}>{fmt(r.delta,3)}</td>
                  <td style={{color:"#ff4d6d"}}>{fmt(r.theta,3)}</td>
                  {r.annRet!==undefined&&(
                    <td style={{color:"#4da8ff",fontSize:10}}>{r.annRet||"—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── SliderRow — smooth custom slider with manual input ────────────────────────
// Defined outside LabPanel so it is never remounted during lab state changes.

function SliderRow({label, value, min, max, step, onChange, display}) {
  const trackRef  = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState("");

  const xToValue = useCallback(clientX => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const steps = Math.round((ratio * (max - min)) / step);
    return Math.min(max, Math.max(min, min + steps * step));
  }, [min, max, step, value]);

  const startDrag = useCallback(e => {
    e.preventDefault();
    onChange(xToValue(e.clientX));
    const onMove = ev => onChange(xToValue(ev.clientX));
    const onUp   = ()  => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }, [xToValue, onChange]);

  const pct = ((value - min) / (max - min)) * 100;

  const commitEdit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    setEditing(false);
  };

  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,userSelect:"none"}}>
      <span style={{fontSize:9,color:"#777",letterSpacing:"0.08em",
        width:82,flexShrink:0,whiteSpace:"nowrap"}}>{label}</span>
      <div ref={trackRef} onMouseDown={startDrag}
        style={{flex:1,height:18,position:"relative",cursor:"ew-resize",
          display:"flex",alignItems:"center"}}>
        <div style={{position:"absolute",left:0,right:0,height:3,
          background:"var(--bg3)",border:"1px solid var(--border)"}}>
          <div style={{position:"absolute",left:0,width:`${pct}%`,height:"100%",
            background:"var(--green)"}}/>
        </div>
        <div style={{position:"absolute",left:`${pct}%`,transform:"translateX(-50%)",
          width:12,height:12,borderRadius:"50%",background:"var(--green)",
          border:"2px solid var(--bg)",boxShadow:"0 0 4px rgba(0,229,160,0.4)",
          pointerEvents:"none"}}/>
      </div>
      {editing ? (
        <input autoFocus value={draft}
          onChange={e=>setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e=>{if(e.key==="Enter")commitEdit();if(e.key==="Escape")setEditing(false);}}
          style={{width:80,background:"var(--bg2)",border:"1px solid var(--green)",
            color:"#fff",fontFamily:"var(--mono)",fontSize:10,padding:"2px 6px",
            textAlign:"right",outline:"none"}}/>
      ) : (
        <span onClick={()=>{setDraft(String(value));setEditing(true);}}
          title="Click to edit"
          style={{fontSize:10,color:"#ccc",width:80,textAlign:"right",flexShrink:0,
            cursor:"text",borderBottom:"1px dashed #333"}}
          onMouseEnter={e=>e.target.style.color="var(--green)"}
          onMouseLeave={e=>e.target.style.color="#ccc"}>
          {display}
        </span>
      )}
    </div>
  );
}

// ── BS math ───────────────────────────────────────────────────────────────────
function normCDF(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const sign=x<0?-1:1;x=Math.abs(x)/Math.sqrt(2);const t=1/(1+p*x);const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);return 0.5*(1+sign*y);}
function normPDF(x){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}
function bsPrice(S,K,T,r,sigma,type){
  if(T<=0||sigma<=0) return Math.max(0,type==="call"?S-K:K-S);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  return type==="call"?S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2):K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
}
function bsGreeks(S,K,T,r,sigma,type){
  if(T<=0||sigma<=0) return {delta:type==="call"&&S>K?1:0,gamma:0,theta:0,vega:0};
  const sqT=Math.sqrt(T);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*sqT);
  const d2=d1-sigma*sqT;
  const pdf=normPDF(d1);
  const gamma=pdf/(S*sigma*sqT), vega=S*pdf*sqT/100;
  if(type==="call") return {delta:normCDF(d1),gamma,vega,theta:(-S*pdf*sigma/(2*sqT)-r*K*Math.exp(-r*T)*normCDF(d2))/365};
  return {delta:normCDF(d1)-1,gamma,vega,theta:(-S*pdf*sigma/(2*sqT)+r*K*Math.exp(-r*T)*normCDF(-d2))/365};
}


const LEG_COLORS = ["#00e5a0","#4da8ff","#f5a623","#ff4d6d","#9b6dff","#00bcd4"];

// ── LegRow — top-level so React never remounts on lab state change ─────────────
function LegRow({leg, idx, editable, onRemove, onUpdate, pnl=0,
                 strikes=[], chain=[], expiries=[], onToggleClose}) {
  const isClosing = leg.closing || false;
  const color = leg.real
    ? (isClosing ? "#f5a623" : leg.dir==="long" ? "#00e5a0" : "#ff4d6d")
    : LEG_COLORS[idx%LEG_COLORS.length];
  const rgbMap={"#00e5a0":"0,229,160","#4da8ff":"77,168,255","#f5a623":"245,166,35",
                "#ff4d6d":"255,77,109","#9b6dff":"155,109,255"};
  const rgb=rgbMap[color]||"0,229,160";
  const upd=(patch)=>onUpdate&&onUpdate(leg.id,patch);

  // Compute DTE from expiry string
  const dteFromExpiry = exp => {
    if(!exp) return leg.dte||30;
    const diff = Math.round((new Date(exp)-new Date())/(1000*60*60*24));
    return Math.max(0,diff);
  };

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",
      padding:"6px 10px",background:"var(--bg1)",
      border:`1px solid rgba(${rgb},0.18)`,
      borderLeft:`3px solid ${color}`,
      opacity:isClosing?0.7:1}}>

      {/* Real/Close badge */}
      {leg.real&&(
        <span style={{fontSize:8,padding:"1px 5px",letterSpacing:"0.06em",flexShrink:0,
          background:isClosing?"rgba(245,166,35,0.12)":"rgba(0,229,160,0.12)",
          color:isClosing?"#f5a623":"#00e5a0"}}>
          {isClosing?"CLOSING":leg.ticker||"REAL"}
        </span>
      )}

      {editable ? (<>
        {/* Type */}
        <select value={leg.type} onChange={e=>upd({type:e.target.value})}
          className="expiry-select" style={{width:56}}>
          <option value="call">CALL</option><option value="put">PUT</option>
        </select>
        {/* Direction */}
        <select value={leg.dir} onChange={e=>upd({dir:e.target.value})}
          className="expiry-select" style={{width:62}}>
          <option value="long">LONG</option><option value="short">SHORT</option>
        </select>
        {/* Strike */}
        <select value={leg.strike}
          onChange={e=>{const k=Number(e.target.value);
            upd({strike:k,entry:chain.find(c=>c.strike===k&&c.type===leg.type)?.mid||leg.entry});}}
          className="expiry-select" style={{width:76}}>
          {strikes.map(k=><option key={k} value={k}>${k}</option>)}
        </select>
        {/* Expiry dropdown */}
        {expiries.length>0&&(
          <select value={leg.expiry||""}
            onChange={e=>{const exp=e.target.value; upd({expiry:exp,dte:dteFromExpiry(exp)});}}
            className="expiry-select" style={{width:90,color:leg.expiry?"#ccc":"#555"}}>
            <option value="">-- expiry --</option>
            {expiries.map(e=><option key={e} value={e}>{e}</option>)}
          </select>
        )}
        {/* Manual DTE override */}
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:9,color:"#777"}}>DTE</span>
          <input type="number" min={0} max={1000} value={leg.dte||30}
            onChange={e=>upd({dte:Math.max(0,parseInt(e.target.value)||0),expiry:""})}
            style={{width:40,background:"var(--bg2)",border:"1px solid var(--border2)",
              color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 6px",textAlign:"right"}}/>
        </div>
        {/* IV */}
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:9,color:"#777"}}>IV</span>
          <input type="number" value={((leg.iv||0.25)*100).toFixed(1)}
            onChange={e=>upd({iv:Math.max(0.01,Number(e.target.value)/100)})}
            style={{width:46,background:"var(--bg2)",border:"1px solid var(--border2)",
              color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 6px",textAlign:"right"}}/>
          <span style={{fontSize:9,color:"#777"}}>%</span>
        </div>
        {/* QTY */}
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:9,color:"#777"}}>QTY</span>
          <input type="number" min={1} max={100} value={leg.qty}
            onChange={e=>upd({qty:Math.max(1,parseInt(e.target.value)||1)})}
            style={{width:36,background:"var(--bg2)",border:"1px solid var(--border2)",
              color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 6px",textAlign:"right"}}/>
        </div>
        {/* Entry */}
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:9,color:"#777"}}>ENTRY</span>
          <input type="number" step={0.01} value={(leg.entry||0).toFixed(2)}
            onChange={e=>upd({entry:Math.max(0,Number(e.target.value))})}
            style={{width:50,background:"var(--bg2)",border:"1px solid var(--border2)",
              color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"2px 6px",textAlign:"right"}}/>
        </div>
      </>) : (<>
        {/* Read-only real leg */}
        <span style={{fontSize:10,color:"#fff",fontWeight:700,
          textDecoration:isClosing?"line-through":"none"}}>
          {leg.dir.toUpperCase()} {leg.type.toUpperCase()}
        </span>
        <span style={{fontSize:10,color:"#999"}}>${fmt(leg.strike)}</span>
        <span style={{fontSize:9,color:"#777"}}>{leg.expiry||`${leg.dte}d`}</span>
        <span style={{fontSize:9,color:"#999"}}>{leg.qty}×</span>
        <span style={{fontSize:9,color:"#999"}}>entry ${fmt(leg.entry||0,2)}</span>
      </>)}

      {/* P&L */}
      <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:isClosing?"#f5a623":pnlColor(pnl)}}>
        {isClosing?"CLOSE ":""}{pnl>=0?"+":""}{fmtUSD(pnl)}
      </span>

      {/* Close toggle (real legs only) */}
      {leg.real&&onToggleClose&&(
        <button onClick={()=>onToggleClose(leg.id)}
          title={isClosing?"Restore position":"Model as closing trade"}
          style={{background:isClosing?"rgba(245,166,35,0.15)":"none",
            border:`1px solid ${isClosing?"#f5a623":"#333"}`,
            color:isClosing?"#f5a623":"#444",fontFamily:"var(--mono)",
            fontSize:8,padding:"1px 6px",cursor:"pointer",transition:"all 0.15s",
            letterSpacing:"0.06em",flexShrink:0}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#f5a623";e.currentTarget.style.color="#f5a623";}}
          onMouseLeave={e=>{if(!isClosing){e.currentTarget.style.borderColor="#333";e.currentTarget.style.color="#444";}}}>
          {isClosing?"RESTORE":"CLOSE?"}
        </button>
      )}

      {/* Remove */}
      {onRemove&&<button onClick={()=>onRemove(leg.id)}
        style={{background:"none",border:"none",color:"#666",cursor:"pointer",fontSize:14,
          padding:0,fontFamily:"var(--mono)",transition:"color 0.15s"}}
        onMouseEnter={e=>e.target.style.color="var(--red)"}
        onMouseLeave={e=>e.target.style.color="#333"}>×</button>}
    </div>
  );
}

// ── PayoffChart — React.memo prevents remount on unrelated state changes ────────
const PayoffChart = React.memo(function PayoffChart({data,legs,chartMode,lo,hi,yDom,r,currentSpot=null,showElasticity=true}){
  // Compute elasticity per price point for the full position (simple mode)
  // Ω(S) = Σ [Δ_i(S) × (S / V_i(S)) × sign_i × qty_i] / Σ [|qty_i| * V_i(S)]
  const elastData = useMemo(()=>{
    if(!showElasticity||!legs.length) return [];
    return data.map(d=>{
      let num=0,den=0;
      legs.forEach(l=>{
        const sign=l.dir==="long"?1:-1;
        const T=Math.max(0.001,(l.dte||30)/365);
        const g=bsGreeks(d.S,l.strike,T,r,l.iv||0.25,l.type);
        const v=bsPrice(d.S,l.strike,T,r,l.iv||0.25,l.type);
        if(v>0.001){
          const wt=Math.abs(l.qty*(v*100));
          num+=g.delta*(d.S/v)*sign*wt;
          den+=wt;
        }
      });
      return {...d, omega: den>0?(num/den):null};
    });
  },[data,legs,r,showElasticity]);

  const omegaVals=elastData.map(d=>d.omega).filter(v=>v!=null&&isFinite(v));
  const omMin=omegaVals.length?Math.min(...omegaVals)*1.1:-20;
  const omMax=omegaVals.length?Math.max(...omegaVals)*1.1:20;

  return (
    <ResponsiveContainer width="100%" height={190}>
      <ComposedChart data={elastData.length?elastData:data} margin={{top:4,right:8,bottom:4,left:48}}>
        <XAxis dataKey="S" type="number" domain={[lo,hi]}
          tickFormatter={v=>`$${v.toFixed(0)}`}
          tick={{fontSize:9,fill:"#444"}} tickLine={false} axisLine={false}/>
        <YAxis yAxisId="pnl" domain={yDom}
          tickFormatter={v=>v>=0?`+$${v.toFixed(0)}`:`-$${Math.abs(v).toFixed(0)}`}
          tick={{fontSize:9,fill:"#444"}} tickLine={false} axisLine={false} width={46}/>
        {showElasticity&&<YAxis yAxisId="omega" orientation="right" domain={[omMin,omMax]}
          tickFormatter={v=>`${v.toFixed(0)}×`}
          tick={{fontSize:8,fill:"#444"}} tickLine={false} axisLine={false} width={28}/>}
        <Tooltip contentStyle={{background:"#111",border:"1px solid #232323",fontSize:9}}
          formatter={(v,n)=>{
            if(n==="omega") return v!=null?[`${v.toFixed(1)}×`,"Elasticity Ω"]:[null,null];
            return [`${v>=0?"+":""}$${v.toFixed(2)}`,n];
          }}
          labelFormatter={v=>`$${Number(v).toFixed(2)}`}/>
        {/* Zero P&L line */}
        <Line yAxisId="pnl" type="monotone" dataKey={()=>0} stroke="#1e1e1e" strokeWidth={1}
          dot={false} legendType="none" tooltipType="none"/>
        {currentSpot&&<ReferenceLine yAxisId="pnl" x={parseFloat(currentSpot.toFixed(2))}
          stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3"
          label={{value:`$${currentSpot.toFixed(0)}`,position:"top",
                  fill:"#666",fontSize:9,fontFamily:"var(--mono)"}}/>}
        {chartMode==="simple"&&<>
          <Line yAxisId="pnl" type="monotone" dataKey="expiry" stroke="#00e5a0" strokeWidth={2} dot={false} name="At Expiry"/>
          <Line yAxisId="pnl" type="monotone" dataKey="pnl" stroke="#4da8ff" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Now"/>
        </>}
        {chartMode==="multi"&&legs.map((leg,i)=>{
          const sign=leg.dir==="long"?1:-1;
          const c=leg.real?(leg.dir==="long"?"#00e5a0":"#ff4d6d"):LEG_COLORS[i%LEG_COLORS.length];
          return <Line yAxisId="pnl" key={leg.id} type="monotone"
            dataKey={d=>sign*(bsPrice(d.S,leg.strike,0,r,(leg.iv||0.25),leg.type)-leg.entry)*100*leg.qty}
            stroke={c} strokeWidth={1.5} dot={false} strokeDasharray={leg.real?undefined:"4 3"}
            name={`${leg.real?leg.ticker||"REAL":"THEO"} ${leg.dir} ${leg.type} $${leg.strike}`}/>;
        })}
        {chartMode==="multi"&&<Line yAxisId="pnl" type="monotone" dataKey="expiry" stroke="#fff" strokeWidth={2.5} dot={false} name="Combined"/>}
        {/* Elasticity overlay — right axis, amber dashed */}
        {showElasticity&&elastData.length>0&&(
          <Line yAxisId="omega" type="monotone" dataKey="omega"
            stroke="#f5a623" strokeWidth={1} dot={false} strokeDasharray="3 2"
            name="omega" connectNulls/>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
});


// ── Editable — inline click-to-edit value (hoisted to avoid hooks-in-render) ──
function Editable({value,draft,setDraft,editing,setEditing,onCommit,suffix}) {
  if(editing) return (
    <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e=>{if(e.key==="Enter")onCommit();if(e.key==="Escape")setEditing(false);}}
      style={{width:36,background:"var(--bg2)",border:"1px solid var(--green)",color:"#fff",
        fontFamily:"var(--mono)",fontSize:9,padding:"1px 4px",textAlign:"center",outline:"none"}}/>
  );
  return (
    <span onClick={()=>{setDraft(String(value));setEditing(true);}} title="Click to edit"
      style={{cursor:"pointer",color:"#00e5a0",borderBottom:"1px dashed #00e5a0"}}
      onMouseEnter={e=>e.target.style.color="#fff"}
      onMouseLeave={e=>e.target.style.color="#00e5a0"}>
      {value}{suffix}
    </span>
  );
}

// ── IVScenarioTable ────────────────────────────────────────────────────────────

function IVScenarioTable({legs, spot0, spot, r, analysisDate, mode, ivShiftPct=0}) {
  // baseIV reflects current leg IV already shifted by ivShiftPct
  const baseIV = legs.length ? Math.round(((legs[0].iv||0.25))*100) : 25;
  const [ivStep,     setIvStep]    = useState(1);
  const [editIV,     setEditIV]    = useState(false);
  const [ivDraft,    setIvDraft]   = useState("1");
  const [priceStep,  setPriceStep] = useState(1);
  const [editPrice,  setEditPrice] = useState(false);
  const [priceDraft, setPriceDraft]= useState("1");

  const ROWS    = 7;  // 2*7+1 = 15 rows
  const ivCols   = [-4,-3,-2,-1,0,1,2,3,4].map(n=>baseIV+n*ivStep);
  const pricePct = Array.from({length:ROWS*2+1},(_,i)=>Math.round((i-ROWS)*priceStep*10)/10);
  const prices   = pricePct.map(p=>spot0*(1+p/100));

  if(!legs.length) return null;

  const cellVal=(S,ivAbsPct)=>{
    let total=0;
    legs.forEach(leg=>{
      if(!leg.strike) return;
      const holdSign=leg.dir==="long"?1:-1;
      const sign=leg.closing?-holdSign:holdSign;
      const iv=Math.max(0.01,ivAbsPct/100);
      let T=0.001;
      if(leg.expiry){ const days=Math.max(0,(new Date(leg.expiry+"T00:00:00")-new Date(analysisDate+"T00:00:00"))/(864e5)); T=Math.max(0.001,days/365); }
      else { T=Math.max(0.001,(leg.dte||30)/365); }
      const price=bsPrice(S,leg.strike,T,r,iv,leg.type);
      total+=mode==="pnl"?sign*(price-leg.entry)*100*leg.qty:price*100*leg.qty*(leg.dir==="long"?1:-1);
    });
    return total;
  };

  const allVals=prices.flatMap(S=>ivCols.map(iv=>cellVal(S,iv)));
  const maxAbs=Math.max(1,...allVals.map(Math.abs));
  const cellBg=v=>{const k=Math.min(1,Math.abs(v)/maxAbs);return mode==="pnl"?v>0?`rgba(0,229,160,${0.07+k*0.33})`:`rgba(255,77,109,${0.07+k*0.33})`:`rgba(77,168,255,${0.05+k*0.28})`;};
  const cellTxt=v=>{const a=Math.abs(v);const s=a>=10000?`$${(a/1000).toFixed(0)}k`:a>=1000?`$${(a/1000).toFixed(1)}k`:`$${a.toFixed(0)}`;return (mode==="pnl"?(v>=0?"+":"-"):"")+s;};


  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5,fontSize:9,color:"#888",flexWrap:"wrap"}}>
        <span>Base IV <b style={{color:"#e0e0e0"}}>{baseIV}%</b></span>
        <span style={{color:"#555"}}>·</span>
        <span>IV step: <Editable value={ivStep} draft={ivDraft} setDraft={setIvDraft} editing={editIV} setEditing={setEditIV} suffix="%" onCommit={()=>{const n=parseFloat(ivDraft);if(n>=0.5&&n<=20)setIvStep(n);setEditIV(false);}}/></span>
        <span style={{color:"#555"}}>·</span>
        <span>Price step: <Editable value={priceStep} draft={priceDraft} setDraft={setPriceDraft} editing={editPrice} setEditing={setEditPrice} suffix="%" onCommit={()=>{const n=parseFloat(priceDraft);if(n>=0.5&&n<=20)setPriceStep(n);setEditPrice(false);}}/></span>
        <span style={{color:"#555",marginLeft:"auto"}}>IV {ivCols[0]}%–{ivCols[ivCols.length-1]}% · ±{pricePct[pricePct.length-1]}%</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",fontSize:9,fontFamily:"var(--mono)",width:"100%"}}>
          <thead>
            <tr>
              <th style={{padding:"2px 6px",color:"#888",textAlign:"left",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",fontSize:8}}>
                {mode==="pnl"?"P&L":"VALUE"} ↕ / IV →
              </th>
              {ivCols.map((iv,ci)=>(
                <th key={ci} style={{padding:"2px 5px",textAlign:"center",borderBottom:"1px solid var(--border)",
                  whiteSpace:"nowrap",color:iv===baseIV?"#e0e0e0":"#777",
                  background:iv===baseIV?"rgba(255,255,255,0.04)":"none",fontSize:8}}>
                  {iv}%
                  {iv===baseIV&&<span style={{fontSize:7,color:"#555",display:"block"}}>now</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices.map((S,ri)=>{
              const pct=pricePct[ri];
              const isSpot=Math.abs(pct)<priceStep/2;
              return (
                <tr key={ri} style={{outline:isSpot?"1px solid rgba(255,255,255,0.08)":"none",background:isSpot?"rgba(255,255,255,0.02)":"none"}}>
                  <td style={{padding:"2px 6px",color:isSpot?"#e0e0e0":pct>0?"#00e5a0":"#ff4d6d",
                    borderRight:"1px solid var(--border)",fontWeight:isSpot?700:400,fontSize:8,whiteSpace:"nowrap"}}>
                    ${S.toFixed(2)}{isSpot?" ◀":""}
                  </td>
                  {ivCols.map((iv,ci)=>{const v=cellVal(S,iv);return (
                    <td key={ci} style={{padding:"2px 4px",textAlign:"right",background:cellBg(v),
                      color:mode==="pnl"?(v>=0?"#00e5a0":"#ff4d6d"):"#4da8ff",
                      fontWeight:isSpot?700:400,border:"1px solid rgba(255,255,255,0.02)",whiteSpace:"nowrap",fontSize:8}}>
                      {cellTxt(v)}
                    </td>
                  );})}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── LabPanel ──────────────────────────────────────────────────────────────────

function LabPanel({chainData, seedLegs, portData, onClose, chainExpiries=[], liveSpots={}}) {
  const spot0    = chainData?.spot      || 100;
  const dte0     = chainData?.dte       || 30;
  const r        = chainData?.risk_free || 0.04;
  const chain    = chainData?.chain     || [];
  const expiries = chainExpiries.length ? chainExpiries : (chainData?.expiries||[]);
  const ticker   = chainData?.ticker    || "";

  // ── Views ────────────────────────────────────────────────────────────────
  const [labView,    setLabView]   = useState("builder");
  const [chartMode,  setChartMode] = useState("simple");
  const [tableMode,  setTableMode] = useState("pnl");   // "pnl" | "value"

  // ── Leg state ─────────────────────────────────────────────────────────────
  const [legs,      setLegs]      = useState(()=>{
    if(seedLegs&&seedLegs.length) return seedLegs;
    const atm=chain.filter(c=>c.type==="call")
      .sort((a,b)=>Math.abs(a.strike-spot0)-Math.abs(b.strike-spot0))[0];
    return atm?[{id:1,type:"call",dir:"long",strike:atm.strike,iv:atm.iv||0.25,
                  qty:1,dte:dte0,expiry:chainData?.expiry||"",
                  entry:atm.mid||atm.ask||0,real:false}]:[];
  });
  const [nextLegId, setNextLegId] = useState(10);
  const [legVer,    setLegVer]    = useState(0);
  const bumpVer = useCallback(()=>setLegVer(v=>v+1),[]);

  // ── Date slider ───────────────────────────────────────────────────────────
  // Single calendar date that each leg uses to compute remaining T independently
  const todayStr = useMemo(()=>new Date().toISOString().slice(0,10),[]);
  const maxExpiry = useMemo(()=>{
    const dates=[...legs,...(portData?.positions||[])]
      .map(l=>l.expiry||"").filter(Boolean).sort();
    return dates.length?dates[dates.length-1]:
      // fallback: today + dte0 days
      new Date(Date.now()+dte0*864e5).toISOString().slice(0,10);
  },[legs,portData,dte0]);
  const [analysisDate, setAnalysisDate] = useState(todayStr);
  // Reset to today when chain changes
  useEffect(()=>setAnalysisDate(todayStr),[dte0]);

  // Per-leg T from analysisDate
  const legT = useCallback(leg=>{
    if(leg.expiry){
      const days=Math.max(0,(new Date(leg.expiry+"T00:00:00")-new Date(analysisDate+"T00:00:00"))/(864e5));
      return Math.max(0.001,days/365);
    }
    // Fallback: use leg.dte scaled from today ratio
    const elapsed = (new Date(analysisDate)-new Date(todayStr))/(864e5);
    return Math.max(0.001,((leg.dte||dte0)-elapsed)/365);
  },[analysisDate,todayStr,dte0]);

  // ── Spot + IV ─────────────────────────────────────────────────────────────
  const [spotAdj,  setSpotAdj]  = useState(0);
  const [ivShift,  setIvShift]  = useState(0);   // additive % shift on all IVs
  const [trackLive,setTrackLive]= useState(true); // auto-sync spot to live price

  // Live price for the primary ticker (from liveSpots or chainData.spot)
  const liveTicker = ticker || legs[0]?.ticker || "";
  const liveSpot0  = liveTicker
    ? (spotPrice(liveSpots[liveTicker]) || spot0)
    : spot0;

  // When trackLive is on, derive spotAdj to match liveSpot0
  // When off, use manual spotAdj
  const effectiveSpotAdj = trackLive
    ? (liveSpot0 > 0 ? ((liveSpot0/spot0)-1)*100 : 0)
    : spotAdj;

  const spot = spot0*(1+effectiveSpotAdj/100);

  const spotForLeg = useCallback(leg=>{
    if(!leg.real||!leg.ticker) return spot;
    const live=liveSpots[leg.ticker];
    // For real legs: always use their own live price (regardless of trackLive)
    if(live) return spotPrice(live);
    const pos=portData?.positions?.find(p=>p.ticker===leg.ticker);
    return pos?.mid||spot;
  },[spot,liveSpots,portData]);

  const strikes = useMemo(()=>[...new Set(chain.map(c=>c.strike))].sort((a,b)=>a-b),[chain]);

  // ── Clear legs when ticker changes ──────────────────────────────────────
  const prevTicker = useRef(ticker);
  useEffect(()=>{
    if(!ticker || ticker===prevTicker.current) return;
    prevTicker.current = ticker;
    // Full clear on ticker change — all legs (real and theoretical) are
    // ticker-specific (strikes, IVs, DTE all differ). User re-adds as needed.
    setLegs([]);
    setIvShift(0);
    setSpotAdj(0);
    setTrackLive(true);
    setAnalysisDate(new Date().toISOString().slice(0,10));
    bumpVer();
  },[ticker]);

  // ── Sync seedLegs ─────────────────────────────────────────────────────────
  // Sync seedLegs → internal legs whenever the seed changes
  // Use a version key instead of reference equality so fresh arrays always trigger
  const seedKey = seedLegs
    ? seedLegs.map(l=>`${l.ticker||""}_${l.strike}_${l.type}`).join("|")
    : "";
  const prevSeedKey = useRef("");
  useEffect(()=>{
    if(!seedLegs||!seedLegs.length) return;
    if(seedKey===prevSeedKey.current) return;  // exact same legs — skip
    prevSeedKey.current = seedKey;
    setLegs([...seedLegs]);
    bumpVer();
  },[seedKey]);

  // ── Leg helpers ───────────────────────────────────────────────────────────
  const updateLeg=useCallback((id,patch)=>{setLegs(p=>p.map(l=>l.id===id?{...l,...patch}:l));bumpVer();},[bumpVer]);
  const removeLeg=id=>{setLegs(p=>p.filter(l=>l.id!==id));bumpVer();};
  const addLeg=()=>{
    const atm=strikes.length?strikes.reduce((a,b)=>Math.abs(a-spot)<Math.abs(b-spot)?a:b):spot0;
    const row=chain.find(c=>c.strike===atm&&c.type==="call");
    setLegs(p=>[...p,{id:nextLegId,type:"call",dir:"long",strike:atm,
      iv:row?.iv||0.25,qty:1,dte:dte0,expiry:chainData?.expiry||"",
      entry:row?.mid||0,real:false}]);
    setNextLegId(n=>n+1);bumpVer();
  };
  const clearAll=()=>{setLegs([]);bumpVer();};

  // ── Position helpers ──────────────────────────────────────────────────────
  const allPositions=portData?.positions||[];
  const posToLeg=(p,id)=>({
    id,real:true,type:p.type||"call",dir:p.direction||"long",
    strike:parseFloat(p.strike)||0,iv:parseFloat(p.iv)||0.25,
    qty:parseInt(p.contracts)||1,dte:parseInt(p.dte)||dte0,
    expiry:p.expiry||"",entry:parseFloat(p.entry_price)||0,
    ticker:p.ticker,closing:false,
  });
  const addPosition=p=>{
    if(legs.find(l=>l.real&&l.ticker===p.ticker&&l.strike===parseFloat(p.strike)&&l.type===p.type))return;
    setLegs(prev=>[...prev,posToLeg(p,nextLegId)]);
    setNextLegId(n=>n+1);bumpVer();setLabView("builder");
  };
  const toggleClose=id=>{setLegs(p=>p.map(l=>l.id===id?{...l,closing:!l.closing}:l));bumpVer();};
  const exitAll   =()=>{setLegs(p=>p.map(l=>l.real?{...l,closing:true}:l));bumpVer();};
  const restoreAll=()=>{setLegs(p=>p.map(l=>({...l,closing:false})));bumpVer();};

  // ── Effective legs (IV only — no DTE here, each leg uses legT) ───────────
  const effectiveLegs=useMemo(()=>legs.map(l=>({
    ...l,
    iv: Math.max(0.01,(l.iv||0.25)+(ivShift/100)),
    closing: l.closing||false,
  })),[legVer,ivShift]);

  // ── Payoff (using analysisDate for T per leg) ─────────────────────────────
  const lo=spot0*0.75, hi=spot0*1.25, N=80;
  const spotRange=useMemo(()=>Array.from({length:N},(_,i)=>lo+(hi-lo)*i/(N-1)),[lo,hi]);

  const payoffData=useMemo(()=>{
    return spotRange.map(S=>{
      let pnl=0,expiry=0;
      effectiveLegs.forEach(leg=>{
        const baseSign=leg.dir==="long"?1:-1;
        const sign=leg.closing?-baseSign:baseSign;
        const T=legT(leg);
        pnl    +=sign*(bsPrice(S,leg.strike,T,      r,leg.iv,leg.type)-leg.entry)*100*leg.qty;
        expiry +=sign*(bsPrice(S,leg.strike,0.001,  r,leg.iv,leg.type)-leg.entry)*100*leg.qty;
      });
      return {S:parseFloat(S.toFixed(2)),pnl:parseFloat(pnl.toFixed(2)),expiry:parseFloat(expiry.toFixed(2))};
    });
  },[legVer,analysisDate,effectiveSpotAdj,ivShift]);

  // ── Greeks ────────────────────────────────────────────────────────────────
  const netGreeks=useMemo(()=>effectiveLegs.reduce((acc,l)=>{
    const holdSign = l.dir==="long"?1:-1;  // sign of what you HOLD
    const T  = legT(l);
    const S  = spotForLeg(l);
    const g  = bsGreeks(S,l.strike,T,r,l.iv,l.type);
    const cur = bsPrice(S,l.strike,T,r,l.iv,l.type);
    const m  = holdSign*100*l.qty;
    // Greeks always reflect the held position direction
    const delta = acc.delta+g.delta*m;
    const gamma = acc.gamma+g.gamma*m;
    const theta = acc.theta+g.theta*m;
    const vega  = acc.vega +g.vega*m;
    // P&L: closing = proceeds from sale minus cost; holding = current value minus cost
    const entryTotal = holdSign*l.entry*100*l.qty;
    const valueTotal = holdSign*cur*100*l.qty;
    const pnl = l.closing
      ? (l.entry - cur)*100*l.qty*Math.abs(holdSign)  // exit: receive current, paid entry
      : valueTotal - entryTotal;
    // Elasticity (Omega/Lambda): % change in option price per 1% change in underlying
    // Ω = Δ × (S / V)  — per leg; sum across legs weighted by dollar exposure
    const omega = cur > 0.001 ? g.delta * (S / cur) : 0;
    const omegaWt = Math.abs(holdSign * l.qty * cur * 100); // dollar exposure weight
    return {
      delta, gamma, theta, vega,
      value:   acc.value   + (l.closing ? (cur*100*l.qty) : valueTotal),
      cost:    acc.cost    + (l.entry*100*l.qty),
      pnl:     acc.pnl     + pnl,
      omegaNum: acc.omegaNum + omega * omegaWt,
      omegaDen: acc.omegaDen + omegaWt,
    };
  },{delta:0,gamma:0,theta:0,vega:0,value:0,cost:0,pnl:0,omegaNum:0,omegaDen:0}),
  [legVer,analysisDate,effectiveSpotAdj,ivShift,liveSpots]);

  // Use explicit pnl field so closing positions show exit P&L correctly
  const unrealizedPnl = netGreeks.pnl;
  // Net elasticity: exposure-weighted average omega across all legs
  const netOmega = netGreeks.omegaDen > 0
    ? netGreeks.omegaNum / netGreeks.omegaDen
    : 0;


  const legPnl=useCallback(l=>{
    const holdSign=l.dir==="long"?1:-1;
    const T=legT(l);
    const S=spotForLeg(l);
    const cur=bsPrice(S,l.strike,T,r,l.iv,l.type);
    // Closing: P&L = what we receive now minus what we paid (positive = profit from closing)
    // Holding: P&L = current value minus entry cost
    return l.closing
      ? (cur - l.entry)*100*l.qty  // always positive when in profit regardless of direction
      : holdSign*(cur - l.entry)*100*l.qty;
  },[legT,spotForLeg]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const expiryVals=payoffData.map(d=>d.expiry);
  const maxProfit =expiryVals.length?Math.max(...expiryVals):0;
  const maxLoss   =expiryVals.length?Math.min(...expiryVals):0;
  const breakevens=[];
  for(let i=1;i<payoffData.length;i++){
    const a=payoffData[i-1].expiry,b=payoffData[i].expiry;
    if((a<0&&b>=0)||(a>=0&&b<0))
      breakevens.push((payoffData[i-1].S+(payoffData[i].S-payoffData[i-1].S)*(0-a)/(b-a)).toFixed(2));
  }
  const allVals=payoffData.flatMap(d=>[d.pnl,d.expiry]);
  const yDom=allVals.length?[Math.min(Math.min(...allVals)*1.15,-100),Math.max(Math.max(...allVals)*1.15,100)]:[-100,100];

  // ── Shared inline panels ──────────────────────────────────────────────────
  const scenarioPanel=(
    <div style={{border:"1px solid var(--border)",padding:"8px 12px",background:"var(--bg1)"}}>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",marginBottom:7}}>
        <span style={{fontSize:9,color:"#777",letterSpacing:"0.1em",flex:1}}>SCENARIO</span>
        {/* Reset: only show when not tracking live and something is non-default */}
        {(!trackLive&&(spotAdj!==0||ivShift!==0||analysisDate!==todayStr))&&(
          <button
            onClick={()=>{ setSpotAdj(0); setIvShift(0); setAnalysisDate(todayStr); setTrackLive(true); }}
            style={{background:"none",border:"1px solid var(--border2)",color:"#777",
              fontFamily:"var(--mono)",fontSize:9,padding:"1px 8px",cursor:"pointer",transition:"all 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="#777";e.currentTarget.style.borderColor="var(--border2)";}}>
            ↺ reset
          </button>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <div>
          {/* UNDERLYING: LIVE toggle + optional manual slider */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,userSelect:"none"}}>
            <span style={{fontSize:9,color:"#777",letterSpacing:"0.08em",
              width:82,flexShrink:0,whiteSpace:"nowrap"}}>UNDERLYING</span>
            {/* LIVE toggle */}
            <button
              onClick={()=>{
                if(trackLive){
                  // Switch to manual: freeze current live offset
                  setSpotAdj(parseFloat(((liveSpot0/spot0-1)*100).toFixed(2)));
                  setTrackLive(false);
                } else {
                  setTrackLive(true);
                  setSpotAdj(0);
                }
              }}
              style={{
                background:trackLive?"rgba(0,229,160,0.10)":"none",
                border:`1px solid ${trackLive?"rgba(0,229,160,0.45)":"var(--border2)"}`,
                color:trackLive?"var(--green)":"#777",
                fontFamily:"var(--mono)",fontSize:9,padding:"1px 10px",cursor:"pointer",
                transition:"all 0.15s",flexShrink:0}}
              title={trackLive?"Tracking live price — click to set manual offset":"Manual offset — click to track live"}>
              {trackLive?"● LIVE":"○ LIVE"}
            </button>
            {/* Price display */}
            <span style={{fontSize:10,color:"#ccc",marginLeft:"auto"}}>
              ${fmt(spot)}
              {trackLive&&effectiveSpotAdj!==0&&(
                <span style={{fontSize:9,color:"#555",marginLeft:4}}>
                  {effectiveSpotAdj>=0?"+":""}{effectiveSpotAdj.toFixed(1)}% vs chain
                </span>
              )}
            </span>
          </div>
          {/* Manual slider — only when not tracking live */}
          {!trackLive&&(
            <SliderRow label="" value={spotAdj} min={-25} max={25} step={0.5}
              onChange={setSpotAdj}
              display={`${spotAdj>=0?"+":""}${spotAdj.toFixed(1)}%`}/>
          )}
          <SliderRow label="IV SHIFT" value={ivShift} min={-30} max={30} step={0.5}
            onChange={setIvShift}
            display={`${ivShift>=0?"+":""}${ivShift.toFixed(1)}%`}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",justifyContent:"center",gap:4}}>
          <span style={{fontSize:9,color:"#777",letterSpacing:"0.08em"}}>DATE</span>
          <input type="date"
            value={analysisDate}
            min={todayStr}
            max={maxExpiry}
            onChange={e=>setAnalysisDate(e.target.value)}
            style={{background:"var(--bg2)",border:"1px solid var(--border2)",
              color:"#ccc",fontFamily:"var(--mono)",fontSize:10,padding:"3px 8px",
              outline:"none",colorScheme:"dark",width:"100%"}}/>
          <span style={{fontSize:9,color:"#555"}}>
            {analysisDate===todayStr?"today (current)":analysisDate}
          </span>
        </div>
      </div>
    </div>
  );

  const chartPanel=(title,showElast=false)=>(
    <div style={{border:"1px solid var(--border)",padding:"8px 12px",background:"var(--bg1)"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:6}}>
        <span style={{fontSize:9,color:"#777",letterSpacing:"0.1em",flex:1}}>{title}</span>
        <div style={{display:"flex",gap:2}}>
          {["simple","multi"].map(m=>(
            <button key={m} onClick={()=>setChartMode(m)}
              style={{background:chartMode===m?"var(--green)":"none",
                border:"1px solid var(--border2)",color:chartMode===m?"#000":"#555",
                fontFamily:"var(--mono)",fontSize:9,padding:"2px 7px",cursor:"pointer"}}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <PayoffChart data={payoffData} legs={effectiveLegs}
        chartMode={chartMode} lo={lo} hi={hi} yDom={yDom} r={r} currentSpot={spot}/>
    </div>
  );

  const ivTable=(
    <div style={{border:"1px solid var(--border)",padding:"8px 12px",background:"var(--bg1)"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:9,color:"#777",letterSpacing:"0.1em",flex:1}}>
          IV SCENARIO TABLE — price × IV shift
        </span>
        <div style={{display:"flex",gap:2}}>
          {[["pnl","P&L"],["value","VALUE"]].map(([m,label])=>(
            <button key={m} onClick={()=>setTableMode(m)}
              style={{background:tableMode===m?"var(--green)":"none",
                border:"1px solid var(--border2)",color:tableMode===m?"#000":"#555",
                fontFamily:"var(--mono)",fontSize:9,padding:"2px 7px",cursor:"pointer"}}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <IVScenarioTable
        legs={effectiveLegs} spot0={spot0} spot={spot} r={r}
        analysisDate={analysisDate} mode={tableMode}
        ivShiftPct={ivShift}/>
    </div>
  );

  const greeksPanel=(
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <div style={{flex:2,minWidth:180,border:"1px solid var(--border)",padding:"8px 12px",background:"var(--bg1)"}}>
        <div style={{fontSize:9,color:"#777",letterSpacing:"0.1em",marginBottom:7}}>NET GREEKS</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 14px"}}>
          {[["Δ DELTA",netGreeks.delta.toFixed(3),netGreeks.delta>0?"#00e5a0":netGreeks.delta<0?"#ff4d6d":"#555"],
            ["Γ GAMMA",netGreeks.gamma.toFixed(4),"#4da8ff"],
            ["Θ THETA",`${netGreeks.theta.toFixed(2)}/d`,netGreeks.theta<0?"#ff4d6d":"#00e5a0"],
            ["V VEGA", netGreeks.vega.toFixed(3),"#9b6dff"],
            ["Ω ELAST",`${netOmega>=0?"+":""}${netOmega.toFixed(1)}×`,
              Math.abs(netOmega)>5?"#f5a623":"#ccc"],
            ["P&L NOW",`${unrealizedPnl>=0?"+":""}$${unrealizedPnl.toFixed(2)}`,pnlColor(unrealizedPnl)],
          ].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:9,color:"#777"}}>{l}</span>
              <span style={{fontSize:11,fontWeight:700,color:c}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{flex:1,minWidth:130,border:"1px solid var(--border)",padding:"8px 12px",background:"var(--bg1)"}}>
        <div style={{fontSize:9,color:"#777",letterSpacing:"0.1em",marginBottom:7}}>TRADE STATS</div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {[["MAX PROFIT",maxProfit>9998?"UNLIM":`+$${maxProfit.toFixed(0)}`,"#00e5a0"],
            ["MAX LOSS",  maxLoss<-9998?"UNLIM": `-$${Math.abs(maxLoss).toFixed(0)}`,"#ff4d6d"],
          ].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:9,color:"#777"}}>{l}</span>
              <span style={{fontSize:11,fontWeight:700,color:c}}>{v}</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <span style={{fontSize:9,color:"#777"}}>B/E</span>
            <span style={{fontSize:10,color:"#f5a623",textAlign:"right"}}>
              {breakevens.length?breakevens.map(b=>`$${b}`).join(" / "):"—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"8px 12px",
      overflow:"auto",flex:1}}>

      {/* Builder header */}
      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",
        borderBottom:"1px solid var(--border)",paddingBottom:8}}>
        <span style={{fontSize:9,color:"#888",letterSpacing:"0.1em"}}>⊕ BUILDER</span>
        <span style={{fontSize:10,color:"#777",marginLeft:4}}>
          {ticker&&<>{ticker} · </>}${fmt(spot)}
        </span>
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
            {legs.some(l=>l.real&&!l.closing)&&(
              <button onClick={exitAll}
                style={{background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.3)",
                  color:"#f5a623",fontFamily:"var(--mono)",fontSize:9,padding:"2px 8px",cursor:"pointer"}}>
                EXIT ALL
              </button>
            )}
            {legs.some(l=>l.closing)&&(
              <button onClick={restoreAll}
                style={{background:"none",border:"1px solid var(--border)",color:"#999",
                  fontFamily:"var(--mono)",fontSize:9,padding:"2px 8px",cursor:"pointer"}}>
                RESTORE
              </button>
            )}
            {legs.length>0&&(
              <button onClick={clearAll}
                style={{background:"none",border:"1px solid var(--border)",color:"#999",
                  fontFamily:"var(--mono)",fontSize:9,padding:"2px 8px",cursor:"pointer"}}
                onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}}
                onMouseLeave={e=>{e.currentTarget.style.color="#555";e.currentTarget.style.borderColor="var(--border)";}}>
                CLEAR
              </button>
            )}
            <button onClick={addLeg}
              style={{background:"var(--green)",border:"none",color:"#000",
                fontFamily:"var(--mono)",fontSize:10,fontWeight:700,
                padding:"3px 10px",cursor:"pointer"}}>
              + LEG
            </button>
        </div>
      </div>

      {/* BUILDER view */}
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {legs.some(l=>l.real)&&(
            <div style={{display:"flex",gap:10,fontSize:9,color:"#999"}}>
              <span><span style={{display:"inline-block",width:12,height:2,background:"#00e5a0",verticalAlign:"middle",marginRight:4}}/>Real</span>
              <span><span style={{display:"inline-block",width:12,height:2,background:"#4da8ff",verticalAlign:"middle",marginRight:4}}/>Theoretical</span>
              {legs.some(l=>l.closing)&&<span><span style={{display:"inline-block",width:12,height:2,background:"#f5a623",verticalAlign:"middle",marginRight:4}}/>Closing</span>}
            </div>
          )}
          {legs.length===0
            ?<div style={{padding:"16px",fontSize:10,color:"#666",textAlign:"center",
                border:"1px dashed var(--border2)"}}>
               Click <b style={{color:"#00e5a0"}}>+ LEG</b> to add a theoretical leg · or use <b style={{color:"#4da8ff"}}>+</b> in Portfolio to add real positions
             </div>
            :legs.map((leg,i)=>(
               <LegRow key={leg.id}
                 leg={leg} idx={i} editable={!leg.real}
                 pnl={legPnl(leg)}
                 onUpdate={updateLeg} strikes={strikes} chain={chain} expiries={expiries}
                 onToggleClose={leg.real?toggleClose:undefined}
                 onRemove={removeLeg}/>
             ))
          }
          {legs.length>0&&(
            <>
              {scenarioPanel}
              {greeksPanel}
              {ivTable}
              {chartPanel(legs.some(l=>l.real)?"COMBINED PAYOFF":"PAYOFF DIAGRAM",true)}
            </>
          )}
      </div>

    </div>
  );
}


// ── OptionAnalysis — rule-based analysis for a selected chain row ─────────────
function OptionAnalysis({row, chainData}) {
  if(!row||!chainData) return null;

  const {spot, iv_rank:ivRank, atm_iv:atmIV, dte} = chainData;
  const {strike, iv, delta, theta, gamma, vega, bid, ask, mid, type, volume, OI} = row;

  // ── Derived metrics ───────────────────────────────────────────────────────
  const spread     = (ask||0) - (bid||0);
  const spreadPct  = mid > 0.01 ? (spread/mid)*100 : null;
  const moneyness  = spot > 0 ? ((type==="call"?spot-strike:strike-spot)/spot)*100 : 0;
  const isITM      = type==="call" ? spot > strike : spot < strike;
  const isATM      = Math.abs(moneyness) < 2;
  const isOTM      = !isITM && !isATM;
  const absDelta   = Math.abs(delta||0);
  const omega      = (mid > 0.001 && delta != null)
    ? Math.abs(delta) * (spot / mid) : null;

  // ── Signal generation ─────────────────────────────────────────────────────
  const signals = [];
  const flags   = { vol:"neutral", liquidity:"neutral", timing:"neutral",
                    structure:"neutral", overall:"neutral" };

  // --- Vol environment ---
  if(ivRank != null){
    if(ivRank > 70){
      signals.push({cat:"VOL",tone:"warn",
        text:`IV Rank ${ivRank.toFixed(0)} is elevated (>70). Options are historically expensive. `
           + `Favour selling premium: CSP, covered call, or IC. `
           + `Buying here means paying above-average extrinsic value.`});
      flags.vol = "sell";
    } else if(ivRank < 30){
      signals.push({cat:"VOL",tone:"good",
        text:`IV Rank ${ivRank.toFixed(0)} is low (<30). Options are historically cheap. `
           + `Buying premium here captures the vol discount — debit spreads or long options have better risk/reward than usual.`});
      flags.vol = "buy";
    } else {
      signals.push({cat:"VOL",tone:"neutral",
        text:`IV Rank ${ivRank.toFixed(0)} is mid-range (30–70). No strong vol edge either way. `
           + `Strategy choice should be driven by directional conviction and DTE rather than vol.`});
    }
  }

  // --- Liquidity ---
  if(spreadPct != null){
    if(spreadPct > 15){
      signals.push({cat:"LIQUIDITY",tone:"warn",
        text:`Bid/ask spread is ${spreadPct.toFixed(0)}% of mid ($${spread.toFixed(2)}). `
           + `Wide spread — slippage will erode edge on entry and exit. `
           + `Consider a closer-to-ATM strike or a nearer expiry with tighter markets.`});
      flags.liquidity = "warn";
    } else if(spreadPct > 5){
      signals.push({cat:"LIQUIDITY",tone:"neutral",
        text:`Spread is ${spreadPct.toFixed(0)}% of mid ($${spread.toFixed(2)}). Acceptable but not tight. Use limit orders at mid.`});
    } else {
      signals.push({cat:"LIQUIDITY",tone:"good",
        text:`Spread is tight at ${spreadPct.toFixed(1)}% of mid. Good liquidity — fills near mid are realistic.`});
      flags.liquidity = "good";
    }
  }
  if(OI != null && OI < 100){
    signals.push({cat:"LIQUIDITY",tone:"warn",
      text:`Open interest is only ${OI}. Very thin — large position may move the market and make exit difficult.`});
    flags.liquidity = "warn";
  }

  // --- Delta / moneyness ---
  if(isOTM && absDelta < 0.15){
    signals.push({cat:"STRUCTURE",tone:"warn",
      text:`Delta ${(delta||0).toFixed(2)} — deep OTM. `
         + `Low probability of expiring ITM. High leverage (Ω ${omega?omega.toFixed(1)+"×":"N/A"}) `
         + `but requires a large move. Suited for lottery-style speculation, not core positioning.`});
    flags.structure = "spec";
  } else if(isATM){
    signals.push({cat:"STRUCTURE",tone:"neutral",
      text:`ATM option (Δ ${(delta||0).toFixed(2)}). Maximum extrinsic value and gamma exposure. `
         + `Highest sensitivity to both price movement and IV change.`
         + (omega ? ` Elasticity ${omega.toFixed(1)}× — a 1% move in ${chainData.ticker||"the underlying"} changes this option ~${omega.toFixed(1)}%.` : "")});
  } else if(absDelta > 0.6){
    signals.push({cat:"STRUCTURE",tone:"neutral",
      text:`Deep ITM (Δ ${(delta||0).toFixed(2)}). Behaves more like the underlying. `
         + `Low extrinsic value reduces theta drag but also limits leverage. `
         + (omega ? `Elasticity ${omega.toFixed(1)}× — relatively low leverage vs OTM options.` : "")});
  } else {
    signals.push({cat:"STRUCTURE",tone:"good",
      text:`Moderate delta (${(delta||0).toFixed(2)}) — balanced between directional exposure and cost. `
         + (omega ? `Elasticity ${omega.toFixed(1)}× means a 1% underlying move → ~${omega.toFixed(1)}% option move.` : "")});
  }

  // --- Theta / DTE ---
  if(theta != null && mid > 0.01){
    const thetaPct = Math.abs(theta)/mid*100;
    if(dte != null && dte < 21){
      signals.push({cat:"TIMING",tone:"warn",
        text:`${dte}d to expiry — gamma and theta both accelerate sharply in the final 3 weeks. `
           + `Theta decay is ${thetaPct.toFixed(1)}%/day of premium. `
           + `Long options lose value rapidly; short options benefit but face gap risk.`});
      flags.timing = "warn";
    } else if(dte != null && dte <= 45){
      signals.push({cat:"TIMING",tone:"good",
        text:`${dte}d DTE is the sweet spot for credit strategies (30–45d = maximum theta/vega ratio). `
           + `Theta: ${thetaPct.toFixed(1)}%/day of premium.`});
      flags.timing = "good";
    } else if(dte != null){
      signals.push({cat:"TIMING",tone:"neutral",
        text:`${dte}d to expiry — longer dated, lower theta burn (${thetaPct.toFixed(1)}%/day). `
           + `More time for thesis to play out. IV changes (vega) dominate over theta at this duration.`});
    }
  }

  // --- Overall verdict ---
  const buyScore  = (flags.vol==="buy"?1:0)  + (flags.liquidity==="good"?0.5:0) + (flags.timing==="good"?0.5:0);
  const sellScore = (flags.vol==="sell"?1:0) + (flags.timing==="good"?0.5:0);
  const warnCount = Object.values(flags).filter(v=>v==="warn").length;

  let verdict, verdictColor, verdictText;
  if(warnCount >= 2){
    verdict="CAUTION"; verdictColor="#f5a623";
    verdictText="Multiple risk factors present. Review liquidity and vol environment before trading.";
  } else if(flags.vol==="buy" && flags.liquidity!=="warn"){
    verdict="FAVOURABLE TO BUY"; verdictColor="#00e5a0";
    verdictText=`Low IV rank with good liquidity favours premium buyers. ${isOTM?"OTM options are cheap on a historical basis.":""}`;
  } else if(flags.vol==="sell" && flags.liquidity!=="warn" && dte!=null&&dte>=21&&dte<=60){
    verdict="FAVOURABLE TO SELL"; verdictColor="#4da8ff";
    verdictText="Elevated IV + suitable DTE = positive expected value for premium sellers.";
  } else {
    verdict="NEUTRAL"; verdictColor="#888";
    verdictText="No strong directional edge from vol or timing. Trade on conviction.";
  }

  const toneStyle = t => ({
    good:"#00e5a0", warn:"#f5a623", neutral:"#888"
  }[t]||"#888");

  return (
    <div style={{marginTop:6,padding:"10px 12px",
      border:"1px solid var(--border)",background:"var(--bg1)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
        <span style={{fontSize:9,color:"#777",letterSpacing:"0.1em"}}>OPTION ANALYSIS</span>
        <span style={{fontSize:9,color:"#555"}}>
          {chainData.ticker} {type?.toUpperCase()} ${strike} · {row.expiry||`${dte}d`}
        </span>
        <span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color:verdictColor,
          border:`1px solid ${verdictColor}44`,padding:"1px 8px",letterSpacing:"0.05em"}}>
          {verdict}
        </span>
      </div>
      <p style={{fontSize:9,color:"#aaa",margin:"0 0 8px",lineHeight:1.5}}>
        {verdictText}
      </p>
      {/* Signal bullets */}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {signals.map((s,i)=>(
          <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{fontSize:8,color:toneStyle(s.tone),
              fontFamily:"var(--mono)",letterSpacing:"0.08em",
              flexShrink:0,marginTop:1,width:70}}>{s.cat}</span>
            <span style={{fontSize:9,color:"#888",lineHeight:1.5}}>{s.text}</span>
          </div>
        ))}
      </div>
      {/* Key metrics footer */}
      <div style={{display:"flex",gap:14,marginTop:8,paddingTop:6,
        borderTop:"1px solid var(--border)",flexWrap:"wrap"}}>
        {[
          ["Ω ELAST", omega?`${omega.toFixed(1)}×`:"—", "#f5a623"],
          ["Δ",       (delta||0).toFixed(3), absDelta>0.5?"#00e5a0":"#ccc"],
          ["Θ/day",   theta?`$${Math.abs(theta*100).toFixed(2)}`:"—",
                      "#ff4d6d"],
          ["IV",      iv?`${(iv*100).toFixed(1)}%`:"—", "#4da8ff"],
          ["SPREAD",  spreadPct?`${spreadPct.toFixed(1)}%`:"—",
                      spreadPct>10?"#f5a623":"#888"],
          ["OI",      OI?OI.toLocaleString():"—",
                      OI<100?"#f5a623":"#888"],
        ].map(([l,v,c])=>(
          <div key={l} style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
            <span style={{fontSize:8,color:"#555",letterSpacing:"0.06em"}}>{l}</span>
            <span style={{fontSize:10,fontWeight:700,color:c}}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function Sidebar({open,serverStatus,onStop,portData,onOpenTicker,
                  view,setView,watchlist,setWatchlist,liveSpots,
                  settings,setSettings,recentTickers,fetchPortfolio,
                  splitMode=false,onOpenRight,setSideOpen}) {

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
  const [priceSource,setPriceSource] = useState("auto");

  // Load current price source on open
  useEffect(()=>{
    if(!open) return;
    fetch(`${API}/price-source`).then(r=>r.json()).then(d=>setPriceSource(d.source||"auto")).catch(()=>{});
  },[open]);

  const savePriceSource = async(src) => {
    try {
      await fetch(`${API}/price-source`,{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({source:src})});
      setPriceSource(src);
    } catch(e){ console.error("Failed to set price source:",e); }
  };

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
  const tradierOk      = serverStatus.tradier_active;
  const tradierSandbox = serverStatus.tradier_sandbox;
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
              <span style={{fontSize:9,color:"#999",letterSpacing:"0.1em"}}>
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
              {tradierSandbox&&<span style={{fontSize:8,color:"#f5a623",marginLeft:4,
                border:"1px solid rgba(245,166,35,0.4)",padding:"0 4px"}}>SANDBOX</span>}
            </span>
            <span style={{fontSize:9,padding:"2px 6px",border:"1px solid",
              borderColor:polyOk?"rgba(0,229,160,0.3)":"#1e1e1e",
              color:polyOk?"#00e5a0":"#333",letterSpacing:"0.06em"}}>
              {polyOk?"● ":"○ "}POLYGON
            </span>
            {serverStatus.data_source&&(
              <span style={{fontSize:9,color:"#777",padding:"2px 0"}}>{serverStatus.data_source}</span>
            )}
          </div>
          {/* Stop Session */}
          <div style={{display:"flex",gap:4}}>
            <button onClick={onStop} className="stop-btn"
              style={{flex:1,padding:"5px",fontSize:10}}>
              ■ STOP SESSION
            </button>
            <button onClick={()=>window.location.reload()}
              title="Refresh frontend"
              style={{background:"none",border:"1px solid var(--border2)",color:"var(--muted)",
                fontFamily:"var(--mono)",fontSize:10,padding:"5px 8px",cursor:"pointer",
                transition:"all 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
              onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";e.currentTarget.style.borderColor="var(--border2)";}}>
              ↺
            </button>
          </div>
        </div>

        {/* ── VIEWS ── */}
        <SideSection label="VIEWS" open={sections.views} onToggle={()=>toggle("views")}>
          {[["portfolio","▤ PORTFOLIO"],["chain","◫ CHAIN"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} className="side-nav-btn"
              style={{borderLeft:`2px solid ${view===v?"var(--green)":"transparent"}`,
                color:view===v?"var(--green)":"#999",
                background:view===v?"rgba(0,229,160,0.04)":"none",
                display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>{label}</span>
              {v==="portfolio"&&portData?.summary?.total_pnl!=null&&(
                <span style={{fontSize:9,
                  color:portData.summary.total_pnl>=0?"#00e5a0":"#ff4d6d",
                  fontWeight:600}}>
                  {portData.summary.total_pnl>=0?"+":""}{fmtUSD(portData.summary.total_pnl)}
                </span>
              )}
            </button>
          ))}
          {/* Strategy opens right analysis pane */}
          <button onClick={()=>{ if(onOpenRight) onOpenRight(); setSideOpen(false); }}
            className="side-nav-btn"
            style={{borderLeft:`2px solid ${splitMode?"var(--green)":"transparent"}`,
              color:splitMode?"var(--green)":"#999",
              background:splitMode?"rgba(0,229,160,0.04)":"none",
              display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>◆ STRATEGY / LAB</span>
            {splitMode&&<span style={{fontSize:9,color:"#00e5a0"}}>● open</span>}
          </button>
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
          {watchlist.length===0&&<div style={{padding:"6px 12px",fontSize:10,color:"#666"}}>No tickers</div>}
          {watchlist.map(t=>(
            <div key={t} className="watch-row" onClick={()=>onOpenTicker(t)}>
              <span style={{fontWeight:700,color:"#fff",fontSize:11,width:48}}>{t}</span>
              <span style={{color:"#00e5a0",fontSize:11,marginLeft:"auto"}}>
                {liveSpots[t]?`$${fmt(spotPrice(liveSpots[t]))}${spotIsAH(liveSpots[t])?" AH":""}`:"—"}
              </span>
              <button onClick={e=>{e.stopPropagation();removeWatch(t);}} className="remove-btn">×</button>
            </div>
          ))}
        </SideSection>

        {/* ── POSITIONS quick-view ── */}
        <SideSection label="POSITIONS" open={sections.positions} onToggle={()=>toggle("positions")}
          badge={portData?.alerts?.length||null}
          headerAction={<button onClick={()=>setView("portfolio")}
            style={{fontSize:9,color:"#00e5a0",background:"none",border:"none",
              cursor:"pointer",fontFamily:"var(--mono)",padding:"0 4px",letterSpacing:"0.06em"}}
            onMouseEnter={e=>e.target.style.color="#fff"}
            onMouseLeave={e=>e.target.style.color="#00e5a0"}>
            VIEW →
          </button>}>
          {(!portData?.positions?.length)
            ? <div style={{padding:"6px 12px",fontSize:10,color:"#666"}}>No positions</div>
            : portData.positions.map((p,i)=>(
              <div key={i} className="watch-row" onClick={()=>{onOpenTicker(p.ticker);setView("chain");}}>
                <span style={{fontWeight:700,color:"#fff",width:42,fontSize:10}}>{p.ticker}</span>
                <span style={{color:"#999",fontSize:9}}>{p.type[0].toUpperCase()} {fmt(p.strike)}</span>
                <span style={{marginLeft:"auto",color:pnlColor(p.pnl),fontWeight:600,fontSize:10}}>
                  {p.pnl>=0?"+":""}{fmtUSD(p.pnl)}</span>
                {p.alerts?.length>0&&<span style={{color:"#f5a623",fontSize:10}}>⚠</span>}
              </div>
            ))}

        </SideSection>

        {/* ── SETTINGS (contains API keys, portfolio import, brokers, display) ── */}
        <SideSection label="SETTINGS" open={sections.settings} onToggle={()=>toggle("settings")}>

          {/* Display */}
          <div style={{padding:"8px 14px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
            <div style={{fontSize:9,color:"#777",letterSpacing:"0.12em",marginBottom:8}}>DISPLAY</div>
            {[["Chain rows",settings.chainRows,[10,20,30,50],"chainRows"],
              ["Auto-refresh",settings.autoRefresh,["on","off"],"autoRefresh"]
            ].map(([label,val,opts,key])=>(
              <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:10,color:"#999"}}>{label}</span>
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
                <div style={{fontSize:9,color:"#777",marginBottom:3}}>POLYGON KEY</div>
                <div style={{display:"flex",gap:4}}>
                  <input type="password" value={polyKey} onChange={e=>setPolyKey(e.target.value)}
                    placeholder="polygon.io" className="side-input"/>
                  <button onClick={()=>{if(polyKey.trim()){saveKey({POLYGON_API_KEY:polyKey.trim()});setPolyKey("");}}}
                    className="side-add-btn">✓</button>
                </div>
              </div>
              <div>
                <div style={{fontSize:9,color:"#777",marginBottom:3}}>TRADIER TOKEN</div>
                <div style={{display:"flex",gap:4}}>
                  <input type="password" value={tradierKey} onChange={e=>setTradierKey(e.target.value)}
                    placeholder="tradier.com" className="side-input"/>
                  <button onClick={()=>{if(tradierKey.trim()){saveKey({TRADIER_TOKEN:tradierKey.trim()});setTradierKey("");}}}
                    className="side-add-btn">✓</button>
                </div>
              </div>
              {keyMsg&&<div style={{fontSize:10,color:"#00e5a0"}}>{keyMsg}</div>}

              {/* Price source selector */}
              <div>
                <div style={{fontSize:9,color:"#777",marginBottom:5,letterSpacing:"0.08em"}}>
                  PRICE SOURCE
                  <span style={{color:"#555",marginLeft:6,fontWeight:400}}>
                    (spot prices + AH)
                  </span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                  {[["auto","AUTO"],["tradier","TRADIER"],["polygon","POLYGON"],["yfinance","YFINANCE"]].map(([val,label])=>(
                    <button key={val} onClick={()=>savePriceSource(val)}
                      style={{
                        background:priceSource===val?"rgba(0,229,160,0.12)":"none",
                        border:`1px solid ${priceSource===val?"rgba(0,229,160,0.5)":"var(--border2)"}`,
                        color:priceSource===val?"var(--green)":"#777",
                        fontFamily:"var(--mono)",fontSize:9,padding:"2px 8px",cursor:"pointer",
                        transition:"all 0.15s"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--green)";e.currentTarget.style.color="var(--green)";}}
                      onMouseLeave={e=>{if(priceSource!==val){e.currentTarget.style.borderColor="var(--border2)";e.currentTarget.style.color="#777";}}}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{fontSize:9,color:"#555",marginTop:4}}>
                  {priceSource==="auto"&&"Tradier → Polygon → yfinance"}
                  {priceSource==="tradier"&&"Tradier only (reg hours; AH via yfinance)"}
                  {priceSource==="polygon"&&"Polygon only (Starter plan required)"}
                  {priceSource==="yfinance"&&"yfinance only — best for AH/overnight"}
                </div>
              </div>
            </div>
          </SideSection>

          {/* Portfolio Import sub-section */}
          <SideSection label="PORTFOLIO IMPORT" open={sections.settings_import} onToggle={()=>toggle("settings_import")} indent>
            <div style={{padding:"6px 14px",display:"flex",flexDirection:"column",gap:8}}>
              <label style={{display:"flex",flexDirection:"column",alignItems:"center",
                border:"1px dashed var(--border2)",padding:"10px 8px",cursor:"pointer",
                fontSize:10,color:"#999",gap:3,transition:"all 0.15s",textAlign:"center"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--green)";e.currentTarget.style.color="var(--green)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border2)";e.currentTarget.style.color="#555";}}>
                <span style={{fontSize:14}}>↑</span>
                <span>Robinhood CSV or positions.json</span>
                <input type="file" accept=".csv,.json" onChange={handleFile} style={{display:"none"}}/>
              </label>
              {importMsg&&<div style={{fontSize:10,color:"#00e5a0"}}>{importMsg}</div>}
              {positions.length>0&&(
                <>
                  <div style={{fontSize:10,color:"#999"}}>{positions.length} position{positions.length!==1?"s":""} ready</div>
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
              <div style={{fontSize:10,color:"#777",lineHeight:1.5,marginBottom:2}}>
                Robinhood: export via Account → Statements → CSV.
              </div>
              {[["Tastytrade","https://www.tastytrade.com/api"],
                ["Alpaca","https://alpaca.markets"],
                ["IBKR","https://www.interactivebrokers.com/en/trading/ib-api.php"],
                ["Schwab","https://developer.schwab.com"]
              ].map(([name,url])=>(
                <a key={name} href={url} target="_blank"
                  style={{display:"flex",justifyContent:"space-between",
                    fontSize:10,color:"#999",textDecoration:"none",padding:"3px 0",
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
          fontSize:9,color:"#666",letterSpacing:"0.06em",flexShrink:0}}>
          OPTFLOW v0.2 &nbsp;·&nbsp; {serverStatus.data_source||"—"}
        </div>
      </div>
    </div>
  );
}

// ── Pane ───────────────────────────────────────────────────────────────────────

function Pane({tabs,setTabs,nextId,setNextId,liveSpots,setLiveSpots,portData,
               fetchPortfolio,portLoading,recentTickers,setRecentTickers,
               view,setView,onOpenRight,onActiveTicker,serverStatus={},settings={},
               pendingTicker=null,onPendingClear}) {

  const [activeTabId,setActiveTabId] = useState(tabs[0]?.id||1);
  const [inputTicker,setInput]       = useState("");
  const [navStack,setNavStack]       = useState([]);
  const dragIdx = useRef(null);
  const wsRefs  = useRef({});

  const pushNav = useCallback((v,id)=>{
    setNavStack(prev=>[...prev.slice(-19),{view:v,tabId:id}]);
  },[]);
  const goBack = useCallback(()=>{
    setNavStack(prev=>{
      if(!prev.length) return prev;
      const stack=[...prev], last=stack.pop();
      setView(last.view); setActiveTabId(last.tabId);
      return stack;
    });
  },[]);

  const activeTab = tabs.find(t=>t.id===activeTabId)||tabs[0];
  const [selectedRow, setSelectedRow]   = useState(null);
  const [selectedKey, setSelectedKey]   = useState(null);   // for ChainPositions highlight
  // Reset selection when ticker changes
  const prevTickerRef = React.useRef(null);
  React.useEffect(()=>{
    if(activeTab?.ticker !== prevTickerRef.current){
      prevTickerRef.current = activeTab?.ticker;
      setSelectedRow(null);
      setSelectedKey(null);
    }
  },[activeTab?.ticker]);

  // Notify parent of active ticker for right pane sync
  useEffect(()=>{
    if(onActiveTicker&&activeTab?.ticker) onActiveTicker(activeTabId, activeTab.ticker);
  },[activeTab?.ticker, activeTabId]);

  // Handle external ticker request (from sidebar watchlist/positions)
  useEffect(()=>{
    if(!pendingTicker) return;
    openTicker(pendingTicker);
    if(onPendingClear) onPendingClear();
  },[pendingTicker]);

  const updateTab = useCallback((id,patch)=>{
    setTabs(p=>p.map(t=>t.id===id?{...t,...patch}:t));
  },[setTabs]);

  const fetchChain = useCallback(async(id,tkr,exp)=>{
    updateTab(id,{loading:true,error:null});
    try {
      const r=await fetch(`${API}/chain/${tkr}${exp?`?expiry=${exp}`:""}`);
      if(!r.ok) throw new Error((await r.json()).detail);
      const d=await r.json();
      // Also fetch enriched spot for AH pricing
      let liveData=null;
      try {
        const sr=await fetch(`${API}/spot/${tkr}`);
        if(sr.ok){ const sd=await sr.json(); liveData=sd; }
      } catch{}
      updateTab(id,{chainData:d,expiries:d.expiries||[],loading:false,
                    expiry:exp||d.expiry,
                    ...(liveData&&{livePrice:liveData.price,liveData})});
    } catch(e){ updateTab(id,{error:e.message,loading:false}); }
  },[updateTab]);

  // WS live price
  useEffect(()=>{
    const ticker=activeTab?.ticker;
    if(!ticker||wsRefs.current[ticker]) return;
    const ws=new WebSocket(`${WS}/stream?tickers=${ticker}`);
    ws.onmessage=e=>{
      const d=JSON.parse(e.data);
      const raw=d[ticker];
      const price=raw?(typeof raw==="object"?raw.price:raw):null;
      if(price) setTabs(prev=>prev.map(t=>t.ticker===ticker?{...t,livePrice:price,liveData:raw}:t));
      // Also update liveSpots for portfolio/lab use
      if(raw) setLiveSpots&&setLiveSpots(prev=>({...prev,[ticker]:raw}));
    };
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{delete wsRefs.current[ticker];};
    wsRefs.current[ticker]=ws;
  },[activeTab?.ticker]);

  // Auto-fetch chain whenever active tab changes and has no data yet
  useEffect(()=>{
    if(activeTab&&!activeTab.chainData&&!activeTab.loading&&view==="chain"){
      fetchChain(activeTab.id, activeTab.ticker, null);
    }
  },[activeTab?.id, view]);


  const openTicker = useCallback((tkr)=>{
    const ex=tabs.find(t=>t.ticker===tkr);
    if(ex){
      pushNav(view,activeTabId);
      setActiveTabId(ex.id); setView("chain");
      // Re-fetch if existing tab has stale or missing data
      if(!ex.chainData&&!ex.loading) fetchChain(ex.id,tkr,null);
      return;
    }
    pushNav(view,activeTabId);
    const id=nextId; setNextId(n=>n+1);
    setTabs(p=>[...p,{id,ticker:tkr,chainData:null,expiry:null,expiries:[],
                       loading:false,error:null,activeType:"call",livePrice:null}]);
    setActiveTabId(id); setView("chain");
    fetchChain(id,tkr,null);
    setRecentTickers(p=>{
      const n=[tkr,...p.filter(r=>r!==tkr)].slice(0,8);
      persist("optflow_recent",n); return n;
    });
  },[tabs,nextId,fetchChain,setTabs,setNextId,setRecentTickers,view,activeTabId,pushNav]);

  const closeTab = id=>{
    if(tabs.length===1) return;
    const idx=tabs.findIndex(t=>t.id===id);
    const rem=tabs.filter(t=>t.id!==id);
    setTabs(rem);
    if(activeTabId===id) setActiveTabId(rem[Math.max(0,idx-1)]?.id||rem[0]?.id);
  };

  const handleSearch = e=>{
    e.preventDefault();
    const t=inputTicker.trim().toUpperCase();
    if(!t) return;
    setInput(""); openTicker(t);
  };

  const livePrice = activeTab?.livePrice||activeTab?.chainData?.spot;
  const src = activeTab?.chainData?.source;

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minWidth:0,
      overflow:"hidden",borderRight:"1px solid var(--border)"}}>

      {/* Header: ticker tabs + view toggle + search */}
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 8px",
        background:"var(--bg1)",borderBottom:"1px solid var(--border)",
        flexShrink:0,flexWrap:"wrap",rowGap:3}}>

        {/* Ticker tabs */}
        <div style={{display:"flex",alignItems:"stretch",overflowX:"auto",flex:1,minWidth:0}}>
          {tabs.map(tab=>{
            const isOpen=tab.id===activeTabId;
            return (
              <div key={tab.id}
                className={clsx("ticker-tab",isOpen&&"active")}
                onClick={()=>{
                  setActiveTabId(tab.id);
                  setView("chain");
                  // Fetch immediately if tab has no chain data
                  if(!tab.chainData&&!tab.loading) fetchChain(tab.id,tab.ticker,null);
                }}
                style={{position:"relative",flexShrink:0}}>
                <span className="ticker-tab-name">{tab.ticker}</span>
                {(tab.livePrice||tab.chainData?.spot)&&(
                  <span className="ticker-tab-price">
                    ${fmt(tab.livePrice||tab.chainData?.spot)}
                    {tab.liveData&&spotIsAH(tab.liveData)&&(
                      <span style={{fontSize:7,color:"#f5a623",marginLeft:2,
                        verticalAlign:"middle"}}>AH</span>
                    )}
                  </span>
                )}
                {tab.loading&&<span style={{color:"var(--green)",fontSize:7,
                  animation:"blink 1s step-start infinite"}}>●</span>}
                {tabs.length>1&&(
                  <span onClick={e=>{e.stopPropagation();closeTab(tab.id);}}
                    style={{marginLeft:4,color:"#444",cursor:"pointer",fontSize:10,
                      lineHeight:1,transition:"color 0.15s"}}
                    onMouseEnter={e=>e.target.style.color="var(--red)"}
                    onMouseLeave={e=>e.target.style.color="#444"}>×</span>
                )}
              </div>
            );
          })}
        </div>

        {/* View toggle — portfolio or chain only */}
        <div style={{display:"flex",gap:2,flexShrink:0}}>
          {[["portfolio","▤"],["chain","◫"]].map(([v,icon])=>(
            <button key={v} onClick={()=>{if(v!==view){pushNav(view,activeTabId);}setView(v);}}
              title={v==="portfolio"?"Portfolio overview":"Options chain"}
              style={{background:view===v?"rgba(0,229,160,0.08)":"none",
                border:`1px solid ${view===v?"rgba(0,229,160,0.4)":"transparent"}`,
                color:view===v?"var(--green)":"var(--muted)",fontFamily:"var(--mono)",
                fontSize:12,padding:"2px 7px",cursor:"pointer",transition:"all 0.15s"}}>
              {icon}
            </button>
          ))}
        </div>

        {/* Back button */}
        {navStack.length>0&&(
          <button onClick={goBack}
            title={`Back to ${navStack[navStack.length-1].view}`}
            style={{background:"none",border:"1px solid var(--border2)",color:"var(--muted)",
              fontFamily:"var(--mono)",fontSize:10,padding:"2px 7px",cursor:"pointer",
              transition:"all 0.15s",flexShrink:0}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="var(--green)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";e.currentTarget.style.borderColor="var(--border2)";}}>
            ← {navStack[navStack.length-1].view}
          </button>
        )}

        {/* Search */}
        <form onSubmit={handleSearch} style={{display:"flex",flexShrink:0}}>
          <input value={inputTicker}
            onChange={e=>setInput(e.target.value.toUpperCase())}
            placeholder="TICKER" maxLength={6}
            className="ticker-input" style={{width:64}}/>
          <button type="submit" className="search-btn"
            style={{padding:"3px 8px",fontSize:10}}>+</button>
        </form>
      </div>

      {/* Error bar */}
      {activeTab?.error&&view==="chain"&&(
        <div className="error-bar">⚠ {activeTab.error}</div>
      )}

      {/* Recent tickers */}
      {recentTickers.length>0&&view==="chain"&&(
        <div style={{display:"flex",gap:4,padding:"4px 10px",flexWrap:"wrap",
          borderBottom:"1px solid var(--border)",background:"var(--bg1)",flexShrink:0}}>
          {recentTickers.slice(0,6).map(t=>{
            const isOpen=tabs.some(tb=>tb.ticker===t);
            return (
              <button key={t} onClick={()=>openTicker(t)}
                style={{background:"none",
                  border:`1px solid ${isOpen?"rgba(0,229,160,0.3)":"#1c1c1c"}`,
                  color:isOpen?"var(--green)":"#666",fontFamily:"var(--mono)",
                  fontSize:9,padding:"1px 7px",cursor:"pointer",transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.color="var(--green)";e.currentTarget.style.borderColor="rgba(0,229,160,0.3)";}}
                onMouseLeave={e=>{e.currentTarget.style.color=isOpen?"var(--green)":"#666";e.currentTarget.style.borderColor=isOpen?"rgba(0,229,160,0.3)":"#1c1c1c";}}>
                {t}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column"}}>

        {/* Portfolio view */}
        {view==="portfolio"&&(
          <>
            {portLoading&&<div className="loading-bar">LOADING…</div>}
            <PortfolioPanel data={portData} liveSpots={liveSpots}
              onTickerOpen={tkr=>{
                openTicker(tkr);
                if(onOpenRight) setTimeout(()=>onOpenRight(tkr), 0);
              }}
              onAddToBuilder={p=>{
                const leg={
                  id:Date.now(), real:true,
                  type:p.type||"call", dir:p.direction||"long",
                  strike:parseFloat(p.strike)||0, iv:parseFloat(p.iv)||0.25,
                  qty:parseInt(p.contracts)||1, dte:parseInt(p.dte)||30,
                  expiry:p.expiry||"", entry:parseFloat(p.entry_price)||0,
                  ticker:p.ticker, closing:false,
                };
                // Navigate left pane to ticker chain + seed right pane builder
                openTicker(p.ticker);
                if(onOpenRight) setTimeout(()=>onOpenRight(p.ticker,[leg],true),0);
              }}/>
          </>
        )}

        {/* Chain view */}
        {view==="chain"&&activeTab&&(
          <>
            {activeTab.loading&&<div className="loading-bar">FETCHING CHAIN…</div>}
            {!activeTab.chainData&&!activeTab.loading&&(
              <div className="panel-empty">
                <div style={{marginBottom:8}}>{activeTab.ticker}</div>
                <button onClick={()=>fetchChain(activeTab.id,activeTab.ticker,null)}
                  className="search-btn" style={{padding:"4px 16px",fontSize:10}}>
                  LOAD CHAIN
                </button>
              </div>
            )}
            {activeTab.chainData&&(
              <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:8}}>
                {/* Chain controls */}
                <div className="controls-row">
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span className="section-label">EXPIRY</span>
                    <select className="expiry-select" value={activeTab.expiry||""}
                      onChange={e=>{updateTab(activeTab.id,{expiry:e.target.value});
                        fetchChain(activeTab.id,activeTab.ticker,e.target.value);}}>
                      {activeTab.expiries.map(e=><option key={e} value={e}>{e}</option>)}
                    </select>
                    {activeTab.chainData&&<span className="dte-badge">{activeTab.chainData.dte}d</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span className="section-label">IV RANK</span>
                    <IVGauge rank={activeTab.chainData.iv_rank}/>
                    <span className="muted" style={{fontSize:10}}>
                      {fmt(activeTab.chainData.iv_rank,1)}
                    </span>
                    <span className="muted" style={{fontSize:9,color:"#555"}}>ATM IV</span>
                    <span style={{fontSize:10,color:"#4da8ff"}}>
                      {fmtPct(activeTab.chainData.atm_iv)}
                    </span>
                  </div>
                  <div style={{display:"flex",gap:0,marginLeft:"auto"}}>
                    {["call","put"].map(t=>(
                      <button key={t} className={clsx("type-btn",activeTab.activeType===t&&"active")}
                        onClick={()=>updateTab(activeTab.id,{activeType:t})}>
                        {t.toUpperCase()}S
                      </button>
                    ))}
                  </div>
                  <span style={{fontSize:10,
                    color:["tradier","polygon"].includes(src)?"#00e5a0":"#888"}}>
                    {src==="tradier"?"● LIVE":src==="polygon"?"● LIVE":"○ DELAYED"}
                  </span>
                </div>
                {/* Signals */}
                {activeTab.chainData.signals&&(
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {Object.values(activeTab.chainData.signals).map((s,i)=>(
                      <SignalChip key={i} action={s.action} reason={s.reason}/>
                    ))}
                  </div>
                )}
                {/* Chain table — row click opens analysis in right pane */}
                <ChainTable
                  chain={activeTab.chainData.chain}
                  spot={activeTab.chainData.spot}
                  activeType={activeTab.activeType}
                  limit={settings?.chainRows||20}
                  selectedStrike={selectedRow?.strike}
                  onSelectRow={row=>{
                    setSelectedRow(row);
                    setSelectedKey(null);
                  }}
                  onRowClick={row=>{
                    setSelectedRow(row);
                    setSelectedKey(null);
                    const leg={id:1,
                      ticker:activeTab.ticker,       // stamp ticker so prevTicker filter works
                      type:row.type,dir:"long",strike:row.strike,
                      iv:row.iv||0.25,qty:1,dte:activeTab.chainData.dte||30,
                      expiry:activeTab.expiry||"",entry:row.mid||row.ask||0};
                    if(onOpenRight) onOpenRight(activeTab.ticker,[leg]);
                  }}/>
                {/* Positions for this ticker */}
                {(()=>{
                  const ticker  = activeTab.ticker;
                  const positions = (portData?.positions||[]).filter(p=>p.ticker===ticker);
                  return (
                    <div style={{marginTop:4}}>
                      {/* Section header */}
                      <div style={{display:"flex",alignItems:"center",gap:8,
                        padding:"6px 0 4px",borderTop:"1px solid var(--border)"}}>
                        <span style={{fontSize:9,color:"#888",letterSpacing:"0.1em"}}>
                          POSITIONS — {ticker}
                        </span>
                        <span style={{fontSize:9,color:"#555"}}>
                          {positions.length===0?"none held":
                           positions.length===1?"1 position":
                           `${positions.length} positions`}
                        </span>
                      </div>

                      {positions.length===0?(
                        <div style={{padding:"8px 0",fontSize:10,color:"#444",
                          fontFamily:"var(--mono)",letterSpacing:"0.05em"}}>
                          — no positions held for {ticker}
                        </div>
                      ):(
                        <ChainPositions
                          positions={positions}
                          liveSpots={liveSpots}
                          selectedKey={selectedKey}
                          onSelectRow={(row, key)=>{
                            setSelectedRow(row);
                            setSelectedKey(key);
                          }}
                          onAddToBuilder={row=>{
                            const leg={
                              id:Date.now(), real:true,
                              type:row.type||"call", dir:row.direction||"long",
                              strike:parseFloat(row.strike)||0,
                              iv:parseFloat(row.iv)||0.25,
                              qty:parseInt(row.contracts)||1,
                              dte:parseInt(row.dte)||30,
                              expiry:row.expiry||"",
                              entry:parseFloat(row.entry_price)||0,
                              ticker:row.ticker, closing:false,
                            };
                            if(onOpenRight) onOpenRight(ticker,[leg],true);
                          }}/>
                      )}
                    </div>
                  );
                })()}
                {/* HV vs ATM IV chart — below positions */}
                <IVChart
                  ticker={activeTab.ticker}
                  atmIV={activeTab.chainData?.atm_iv||null}/>

                {/* Option analysis — shown when a row is selected */}
                <OptionAnalysis
                  row={selectedRow}
                  chainData={activeTab.chainData}/>

              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 12px",
        borderTop:"1px solid var(--border)",fontSize:10,
        background:"var(--bg1)",flexShrink:0}}>
        <span style={{color:src==="tradier"||serverStatus.tradier_active?"#00e5a0":
                           src==="polygon"||serverStatus.polygon_active?"#4da8ff":"#888"}}
          title={src==="tradier"?"Real-time (Tradier)":src==="polygon"?"Real-time (Polygon)":
                 !activeTab?.chainData&&serverStatus.tradier_active?"Tradier active":
                 "15-min delayed (yfinance)"}>
          {src==="tradier"?"● TRADIER":src==="polygon"?"● POLYGON":
           activeTab?.chainData?(serverStatus.tradier_active?"● TRADIER":"○ YFINANCE (DELAYED)"):
           serverStatus.tradier_active?"● TRADIER":"—"}
        </span>
        <span className="muted">·</span>
        <span style={{color:"#555"}}>{activeTab?.chainData?.fetched_at||""}</span>
        <span style={{marginLeft:"auto",color:"#555"}}>
          {tabs.length} tab{tabs.length!==1?"s":""}
        </span>
      </div>
    </div>
  );
}

function AnalysisPane({tabs, activeTabId, liveSpots,
                       labLegs, setLabLegs, onClose, portData, serverStatus={},
                       pinned=false, onTogglePin}) {

  // AnalysisPane is a pure reader — it never fetches chains independently.
  // All chain data comes from tabsA (left pane), preventing double-fetches
  // and the yfinance race condition.
  const activeTab = tabs.find(t=>t.id===activeTabId)||tabs[0];
  const [selectedRow, setSelectedRow]   = useState(null);
  const [selectedKey, setSelectedKey]   = useState(null);   // for ChainPositions highlight
  // Reset selection when ticker changes
  const prevTickerRef = React.useRef(null);
  React.useEffect(()=>{
    if(activeTab?.ticker !== prevTickerRef.current){
      prevTickerRef.current = activeTab?.ticker;
      setSelectedRow(null);
      setSelectedKey(null);
    }
  },[activeTab?.ticker]);
  const chainData = activeTab?.chainData;
  const livePrice = activeTab?.livePrice || chainData?.spot;
  const src       = chainData?.source;

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minWidth:0,
      overflow:"hidden",borderLeft:"1px solid var(--border)"}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 10px",
        background:"var(--bg1)",borderBottom:"1px solid var(--border)",flexShrink:0}}>

        <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
          {activeTab?.ticker&&(
            <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>
              {activeTab.ticker}
            </span>
          )}
          {livePrice&&(
            <span style={{fontSize:12,color:"#ccc"}}>
              ${fmt(livePrice)}
              {activeTab?.liveData&&spotIsAH(activeTab.liveData)&&(
                <span style={{fontSize:9,marginLeft:6,
                  color:spotAHPct(activeTab.liveData)>=0?"#00e5a0":"#ff4d6d",
                  fontWeight:600}}>
                  AH&nbsp;{spotAHPct(activeTab.liveData)>=0?"+":""}{spotAHPct(activeTab.liveData).toFixed(2)}%
                  <span style={{color:"#666",fontWeight:400,marginLeft:4}}>
                    close&nbsp;${fmt(spotClose(activeTab.liveData))}
                  </span>
                </span>
              )}
            </span>
          )}
          {activeTab?.loading&&(
            <span style={{color:"var(--green)",fontSize:8,
              animation:"blink 1s step-start infinite"}}>●</span>
          )}
                    {chainData&&(
            <span style={{fontSize:9,color:"#555",marginLeft:4,display:"flex",
              alignItems:"center",gap:4}}>
              <span>IV Rank&nbsp;<b style={{color:chainData.iv_rank<30?"#00e5a0":
                chainData.iv_rank>70?"#ff4d6d":"#f5a623"}}>{fmt(chainData.iv_rank,1)}</b></span>
              <span style={{color:"#333"}}>·</span>
              <span>{chainData.dte}d</span>
              <span style={{color:"#333"}}>·</span>
              <span>ATM IV&nbsp;<span style={{color:"#4da8ff"}}>{fmtPct(chainData.atm_iv)}</span></span>
            </span>
          )}
        </div>

        {/* Pin */}
        <button onClick={onTogglePin}
          title={pinned?"Unpin (follow left pane)":"Pin to current ticker"}
          style={{background:pinned?"rgba(245,166,35,0.1)":"none",
            border:`1px solid ${pinned?"rgba(245,166,35,0.4)":"var(--border2)"}`,
            color:pinned?"#f5a623":"var(--muted)",fontFamily:"var(--mono)",
            fontSize:9,padding:"2px 8px",cursor:"pointer",transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#f5a623";e.currentTarget.style.color="#f5a623";}}
          onMouseLeave={e=>{if(!pinned){e.currentTarget.style.borderColor="var(--border2)";e.currentTarget.style.color="var(--muted)";}}}>{pinned?"📌 PINNED":"○ PIN"}</button>

        {/* Close */}
        <button onClick={onClose}
          style={{background:"none",border:"1px solid var(--border2)",
            color:"var(--muted)",fontFamily:"var(--mono)",fontSize:10,
            padding:"2px 6px",cursor:"pointer",transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}}
          onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";e.currentTarget.style.borderColor="var(--border2)";}}>✕</button>
      </div>

      {/* Error */}
      {activeTab?.error&&<div className="error-bar">⚠ {activeTab.error}</div>}

      {/* Content */}
      <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column"}}>
        {!chainData&&activeTab?.loading&&(
          <div className="loading-bar">FETCHING CHAIN…</div>
        )}
        {!chainData&&!activeTab?.loading&&(
          <div className="panel-empty">Select a ticker in the left pane</div>
        )}
        {chainData&&(
          <div style={{display:"flex",flexDirection:"column",flex:1}}>
            <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",
              background:"var(--bg1)",flexShrink:0}}>
              <StrategyPanel chainData={chainData}
                onLabOpen={legs=>{setLabLegs(legs);}}/>
            </div>
            <LabPanel chainData={chainData} seedLegs={labLegs}
              portData={portData} onClose={null}
              chainExpiries={activeTab?.expiries||[]}
              liveSpots={liveSpots}/>
          </div>
        )}
      </div>

      {/* Footer — source derived solely from chainData.source (no independent fetch) */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 12px",
        borderTop:"1px solid var(--border)",fontSize:10,
        background:"var(--bg1)",flexShrink:0}}>
        <span style={{color:src==="tradier"?"#00e5a0":src==="polygon"?"#4da8ff":
                           !chainData&&serverStatus.tradier_active?"#00e5a0":"#888"}}
          title={src==="tradier"?"Real-time (Tradier)":src==="polygon"?"Real-time (Polygon)":
                 !chainData&&serverStatus.tradier_active?"Tradier active — load a chain":
                 "15-min delayed (yfinance)"}>
          {src==="tradier"?"● TRADIER":src==="polygon"?"● POLYGON":
           !chainData&&serverStatus.tradier_active?"● TRADIER":
           chainData?"○ YFINANCE":"—"}
        </span>
        <span className="muted">·</span>
        <span style={{color:"#555"}}>{chainData?.fetched_at||""}</span>
      </div>
    </div>
  );
}


// ── ErrorBoundary ─────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = {err:null,info:null}; }
  static getDerivedStateFromError(err) { return {err}; }
  componentDidCatch(err,info) { this.setState({info}); console.error("OPTFLOW crash:",err,info); }
  render() {
    if(this.state.err) return (
      <div style={{padding:24,fontFamily:"'IBM Plex Mono',monospace",background:"#0a0a0a",
        color:"#ff4d6d",height:"100%",overflow:"auto"}}>
        <div style={{fontSize:12,marginBottom:8,color:"#f5a623"}}>◈ OPTFLOW — RENDER ERROR</div>
        <div style={{fontSize:11,marginBottom:12,color:"#e0e0e0"}}>{String(this.state.err)}</div>
        <pre style={{fontSize:9,color:"#666",whiteSpace:"pre-wrap"}}>
          {this.state.info?.componentStack?.slice(0,600)}
        </pre>
        <button onClick={()=>this.setState({err:null,info:null})}
          style={{marginTop:16,background:"none",border:"1px solid #f5a623",color:"#f5a623",
            fontFamily:"inherit",fontSize:10,padding:"4px 14px",cursor:"pointer"}}>
          ↺ Try to recover
        </button>
      </div>
    );
    return this.props.children;
  }
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#080808;--bg1:#0d0d0d;--bg2:#131313;--bg3:#1a1a1a;
    --border:#1e1e1e;--border2:#282828;
    --text:#d0d0d0;--muted:#888;
    --t1:#e0e0e0;--t2:#bbb;--t3:#888;--t4:#666;
    --green:#00e5a0;--red:#ff4d6d;--blue:#4da8ff;--amber:#f5a623;
    --mono:'IBM Plex Mono',monospace;
  }
  body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:12px;overflow:hidden}
  .app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
  /* Sidebar utilities */
  .side-section-btn{display:flex;align-items:center;justify-content:space-between;width:100%;
    background:none;border:none;color:var(--t3);font-family:var(--mono);font-size:9px;
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
  /* Suppress default range input on all browsers — we use custom track */
  input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;width:100%}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:0;height:0}
  input[type=range]::-moz-range-thumb{width:0;height:0;border:none}
  /* Hide number input spinners — they overlap values in narrow inputs */
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
  input[type=number]{-moz-appearance:textfield;appearance:textfield}
`;

export default function App() {
  // Sidebar open state — persisted
  const [sideOpen,setSideOpen] = useState(()=>recall("optflow_sidebar_open",true));
  const toggleSide = () => { const n=!sideOpen; setSideOpen(n); persist("optflow_sidebar_open",n); };
  const closeSide  = () => { setSideOpen(false); persist("optflow_sidebar_open",false); };

  // Split pane
  const [splitMode,setSplitMode]   = useState(false);
  const [pendingTicker,setPendingTicker] = useState(null);
  const [splitPos,setSplitPos]     = useState(50);
  const [pinnedRight,setPinnedRight] = useState(false);
  const [leftActiveTabId,setLeftActiveTabId] = useState(1);
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
      // Only update state if values changed — prevents cascading re-renders every 5s
      setServerStatus(prev=>{
        const next={api:"up",...d};
        const changed=Object.keys(next).some(k=>prev[k]!==next[k]);
        return changed?next:prev;
      });
    } catch {
      setServerStatus(prev=>prev.api==="down"?prev:{...prev,api:"down"});
    }
    finally { statusPoll.current=false; }
  },[]);
  useEffect(()=>{ pollStatus(); const id=setInterval(pollStatus,5000); return ()=>clearInterval(id); },[pollStatus]);

  // Shared state
  const [nextId,setNextId]   = useState(3);
  const [liveSpots,setLiveSpots] = useState({});
  // Shared tabs — both panes reference the same tab list
  const [tabsA,setTabsA] = useState([{id:1,ticker:"SPY",chainData:null,expiry:null,expiries:[],loading:false,error:null,activeType:"call",livePrice:null}]);
  const [portData,setPortData]       = useState(null);
  const [portLoading,setPortLoading] = useState(false);
  const [watchlist,setWatchlist]     = useState(()=>recall("optflow_watchlist",["SPY","QQQ","NVDA"]));
  const [settings,setSettings]       = useState(()=>recall("optflow_settings",{chainRows:20,autoRefresh:"on"}));
  const [recentTickers,setRecentTickers] = useState(()=>recall("optflow_recent",["SPY","QQQ"]));
  const [view,setView]               = useState("portfolio");
  // Right pane state (independent)
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
      // POST shutdown then navigate to the goodbye page via fetch + blob URL
      // Avoids document.write which causes Firefox to hard-close
      const r=await fetch(`${API}/shutdown`,{method:"POST"});
      if (r.ok){
        const html = await r.text();
        const blob = new Blob([html], {type:"text/html"});
        const url  = URL.createObjectURL(blob);
        window.location.href = url;
      }
    } catch {}
  },[]);

  // Open right analysis pane (seeds lab legs if provided)
  const openInRight = useCallback((ticker, labLegs=[], append=false) => {
    if(labLegs.length){
      if(append){
        setLabLegsB(prev=>{
          const deduped=labLegs.filter(nl=>
            !prev.some(el=>el.ticker===nl.ticker&&el.strike===nl.strike&&el.type===nl.type)
          );
          return [...prev,...deduped];
        });
      } else {
        // Replace: use a fresh array object so prevSeed ref check always triggers
        setLabLegsB([...labLegs]);
      }
    } else {
      // No legs: clear seeds entirely so LabPanel starts fresh
      setLabLegsB([]);
    }
    setSplitMode(true);
  }, []);

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
            <button onClick={()=>{ if(!splitMode){setSplitMode(true);} else {setSplitMode(false);setPinnedRight(false);} }}
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
              setPendingTicker(t);
              setView("chain");
            }}
            view={view} setView={setView}
            watchlist={watchlist} setWatchlist={setWatchlist}
            liveSpots={liveSpots} settings={settings} setSettings={setSettings}
            recentTickers={recentTickers} fetchPortfolio={fetchPortfolio}
            splitMode={splitMode} onOpenRight={openInRight} setSideOpen={closeSide}/>

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
                view={view} setView={setView}
                serverStatus={serverStatus}
                settings={settings}
                onOpenRight={openInRight}
                setLiveSpots={setLiveSpots}
                pendingTicker={pendingTicker}
                onPendingClear={()=>setPendingTicker(null)}
                onActiveTicker={(tabId,ticker)=>{
                  // Clear builder seeds when ticker changes
                  if(tabId!==leftActiveTabId) setLabLegsB([]);
                  setLeftActiveTabId(tabId);
                }}/>
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
                  <ErrorBoundary>
                  <AnalysisPane
                    tabs={tabsA}
                    activeTabId={pinnedRight?null:leftActiveTabId}
                    liveSpots={liveSpots}
                    labLegs={labLegsB} setLabLegs={setLabLegsB}
                    portData={portData}
                    serverStatus={serverStatus}
                    pinned={pinnedRight} onTogglePin={()=>setPinnedRight(p=>!p)}
                    onClose={()=>{setSplitMode(false);setPinnedRight(false);}}/>
                  </ErrorBoundary>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

