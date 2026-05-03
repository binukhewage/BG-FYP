"use client";

import React, { useEffect, useRef, useState } from "react";

export default function BiasDetectionFeed({
  roundHistory    = [],
  baselineHistory = [],
  hospitalMetrics = [],
  loading         = false,
  mode            = "bias",
}) {
  const feedRef    = useRef(null);
  const [events, setEvents] = useState([]);
  const prevLenRef = useRef(0);

  useEffect(() => {
    if (!roundHistory || roundHistory.length === 0) {
      setEvents([]); prevLenRef.current = 0; return;
    }
    const newRounds = roundHistory.slice(prevLenRef.current);
    if (newRounds.length === 0) return;

    setEvents((prev) => {
      let idx = prev.length;
      const newEvents = newRounds.flatMap((r) => {
        const evts = [];
        const severity =
          r.avg_dp > 0.3  ? "critical" :
          r.avg_dp > 0.1  ? "high"     :
          r.avg_dp > 0.05 ? "moderate" : "low";

        evts.push({
          id: `r${r.round}-start-${idx++}`, type: "round", round: r.round,
          message: `Round ${r.round} complete`,
          detail: `AUC ${r.avg_auc?.toFixed(3)} · DP ${r.avg_dp?.toFixed(4)} · EO ${r.avg_eo?.toFixed(4)}`,
          dp: r.avg_dp, severity,
        });

        if (r.rejected_count > 0) {
          evts.push({
            id: `r${r.round}-reject-${idx++}`, type: "rejection", round: r.round,
            message: `${r.rejected_count} node${r.rejected_count > 1 ? "s" : ""} hard-rejected`,
            detail: `Bias exceeded threshold — excluded from aggregation`,
            dp: r.avg_dp,
          });
        }

        evts.push({
          id: `r${r.round}-detect-${idx++}`, type: "detection", round: r.round,
          message: `Bias ${severity.toUpperCase()} — correction applied`,
          detail: `DP ${r.avg_dp?.toFixed(4)} · EO ${r.avg_eo?.toFixed(4)} · Inverse penalty active`,
          dp: r.avg_dp, severity,
        });

        return evts;
      });
      return [...prev, ...newEvents];
    });

    prevLenRef.current = roundHistory.length;
  }, [roundHistory]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (loading && roundHistory.length === 0) { setEvents([]); prevLenRef.current = 0; }
  }, [loading, roundHistory.length]);

  // ── Stats ──────────────────────────────────────────────────
  const totalRejections = roundHistory.reduce((s, r) => s + (r.rejected_count || 0), 0);
  const firstDP         = roundHistory[0]?.avg_dp ?? null;
  const latestDP        = roundHistory[roundHistory.length - 1]?.avg_dp ?? null;
  const dpReduction     = firstDP && latestDP
    ? ((firstDP - latestDP) / firstDP * 100).toFixed(1) : null;

  // ── Baseline lookup by round number ───────────────────────
  // keyed by round so post-onboard baseline rounds slot in
  // automatically as baselineHistory grows
  const baselineByRound = {};
  baselineHistory.forEach(r => { baselineByRound[r.round] = r; });

  // find the round number where onboarding happened
  // = first BiasGuard round that has no matching baseline entry
  // but a previous round does (i.e. baseline was shorter at that point)
  const onboardRound = (() => {
    let found = null;
    for (let i = 1; i < roundHistory.length; i++) {
      const prev = baselineByRound[roundHistory[i - 1]?.round];
      const curr = baselineByRound[roundHistory[i]?.round];
      if (prev && !curr) { found = roundHistory[i].round; break; }
    }
    return found;
  })();

  let lastKnownBaseline = null;
  const comparisonData = roundHistory.map((r) => {
    const base = baselineByRound[r.round] ?? null;
    if (base) lastKnownBaseline = base;
    const effectiveBase  = base ?? lastKnownBaseline;
    // isPostOnboard = no exact baseline match but baseline existed before
    const isPostOnboard  = !base && lastKnownBaseline !== null;
    // hasLiveBaseline = baseline actually ran this round (not carried forward)
    const hasLiveBaseline = !!base;

    return {
      round: r.round,
      bgDP:  r.avg_dp,   bgEO:  r.avg_eo,  bgAUC: r.avg_auc,
      baseDP:  effectiveBase?.avg_dp  ?? null,
      baseEO:  effectiveBase?.avg_eo  ?? null,
      baseAUC: effectiveBase?.avg_auc ?? null,
      diffDP:  effectiveBase ? effectiveBase.avg_dp - r.avg_dp : null,
      diffEO:  effectiveBase ? effectiveBase.avg_eo - r.avg_eo : null,
      rejected: r.rejected_count || 0,
      isPostOnboard,
      hasLiveBaseline,
    };
  });

  const bestDiffRound = comparisonData.reduce((best, r) =>
    r.diffDP !== null && r.diffDP > (best?.diffDP ?? -Infinity) ? r : best, null);

  // ── Privacy engine stats ───────────────────────────────────
  const noiseScale    = 0.5;
  const clipValue     = 1.0;
  const delta         = 1e-5;
  const totalRounds   = roundHistory.length;
  const approxEpsilon = totalRounds > 0
    ? (Math.sqrt(2 * totalRounds * Math.log(1 / delta)) / (clipValue / noiseScale)).toFixed(2)
    : "—";

  // ── Colour helpers ─────────────────────────────────────────
  const dpColor = (dp) => dp > 0.3 ? "text-red-400" : dp > 0.1 ? "text-orange-400" : dp > 0.05 ? "text-yellow-400" : "text-emerald-400";
  const eoColor = (eo) => eo > 0.3 ? "text-red-400" : eo > 0.15 ? "text-orange-400" : eo > 0.05 ? "text-yellow-400" : "text-emerald-400";
  const dpBadge = (dp) => dp > 0.3 ? "bg-red-900/60 text-red-300" : dp > 0.1 ? "bg-orange-900/60 text-orange-300" : dp > 0.05 ? "bg-yellow-900/60 text-yellow-300" : "bg-emerald-900/60 text-emerald-300";
  const sevText = (s)  => s === "critical" ? "text-red-300" : s === "high" ? "text-orange-300" : s === "moderate" ? "text-yellow-300" : "text-emerald-300";
  const sevBg   = (s)  => s === "critical" ? "bg-red-950/50 border-red-900/60" : s === "high" ? "bg-orange-950/40 border-orange-900/50" : s === "moderate" ? "bg-yellow-950/30 border-yellow-900/40" : "bg-emerald-950/20 border-emerald-900/30";

  if (mode !== "bias") return null;

  return (
    <div className="bg-slate-900/70 backdrop-blur-sm rounded-2xl border border-slate-800/70 shadow-xl overflow-hidden">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            {loading && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${loading ? "bg-red-500" : "bg-slate-600"}`} />
          </div>
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Live Bias Detection &amp; Correction Engine
          </h3>
          {loading && (
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-900/30 px-2 py-0.5 rounded border border-cyan-800/50 animate-pulse">ACTIVE</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-900/50 px-3 py-1 rounded-full">
            <span className="text-red-400">⛔</span>
            <span className="text-red-300 font-bold">{totalRejections}</span>
            <span className="text-slate-500">rejections</span>
          </div>
          
          
          {bestDiffRound && (
            <div className="flex items-center gap-1.5 bg-blue-950/40 border border-blue-900/50 px-3 py-1 rounded-full">
              <span className="text-blue-400">★</span>
              <span className="text-blue-300 font-bold">R{bestDiffRound.round}</span>
              <span className="text-slate-500">peak separation</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Three panels ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/60">

        {/* Panel 1 — Detection log */}
        <div className="flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-800/40 bg-slate-950/20">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Detection Log</p>
          </div>
          <div ref={feedRef} className="h-72 overflow-y-auto px-4 py-3 space-y-1.5" style={{fontFamily:"monospace"}}>
            {events.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 text-xs text-center px-4">
                {loading ? "Waiting for round 1..." : "Run federation to see live detection events"}
              </div>
            ) : (
              events.map((evt) => (
                <div key={evt.id} className={`flex items-start gap-2 py-1.5 px-2.5 rounded-lg text-xs border ${
                  evt.type === "rejection" ? "bg-red-950/40 border-red-900/50" :
                  evt.severity ? sevBg(evt.severity) : "bg-slate-800/30 border-slate-700/30"
                }`}>
                  <span className="flex-shrink-0 mt-0.5">
                    {evt.type === "rejection" ? "⛔" :
                     evt.severity === "low" ? "✅" : evt.severity === "moderate" ? "🟡" :
                     evt.severity === "high" ? "🟠" : evt.severity === "critical" ? "🔴" : "📡"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-slate-500 text-[10px]">R{evt.round}</span>
                      <span className={`font-semibold text-[11px] ${evt.type === "rejection" ? "text-red-300" : evt.severity ? sevText(evt.severity) : "text-slate-300"}`}>
                        {evt.message}
                      </span>
                    </div>
                    <p className="text-slate-500 text-[10px] truncate">{evt.detail}</p>
                  </div>
                  {evt.dp !== undefined && (
                    <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono ${dpBadge(evt.dp)}`}>
                      {evt.dp.toFixed(4)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Panel 2 — BiasGuard vs Baseline */}
        <div className="flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-800/40 bg-slate-950/20 flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">BiasGuard vs Baseline</p>
            <div className="flex gap-3 text-[9px] font-mono">
              <span className="text-red-400">● DP</span>
              <span className="text-emerald-400">● EO</span>
              {onboardRound && (
                <span className="text-cyan-600">+ = post-onboard (live baseline)</span>
              )}
            </div>
          </div>
          <div className="h-72 overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-slate-950/90 backdrop-blur">
                <tr className="text-slate-500 text-[9px]">
                  <th className="text-left px-3 py-2">Rnd</th>
                  <th className="text-right px-1 py-2 text-red-500">Base DP</th>
                  <th className="text-right px-1 py-2 text-red-400">BG DP</th>
                  <th className="text-right px-1 py-2 text-emerald-500">Base EO</th>
                  <th className="text-right px-1 py-2 text-emerald-400">BG EO</th>
                  <th className="text-right px-3 py-2">Act</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-600 py-8 text-[11px]">
                      No data yet
                    </td>
                  </tr>
                ) : (
                  comparisonData.map((r, i) => {
                    const dpBetter = r.diffDP !== null && r.diffDP > 0.001;
                    const eoBetter = r.diffEO !== null && r.diffEO > 0.001;

                    // Insert a separator row just before the first post-onboard round
                    const isFirstPostOnboard = r.isPostOnboard &&
                      (i === 0 || !comparisonData[i - 1].isPostOnboard);

                    return (
                      <React.Fragment key={`frag-${r.round}-${i}`}>
                        {/* ── Onboarding separator ─────────── */}
                        {isFirstPostOnboard && (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 py-1 text-[9px] font-mono text-cyan-500 bg-cyan-950/30 border-y border-cyan-900/40"
                            >
                              ── Hospital onboarded · Baseline now running with {
                                r.hasLiveBaseline ? "live" : "continued"
                              } data from R{r.round} ──
                            </td>
                          </tr>
                        )}

                        <tr
                          key={`row-${r.round}-${i}`}
                          className={`border-b border-slate-800/30 transition-colors ${
                            r.isPostOnboard
                              ? "bg-cyan-950/5 hover:bg-cyan-950/10"
                              : "hover:bg-slate-800/20"
                          }`}
                        >
                          <td className="px-3 py-1.5 text-[10px]">
                            <span className={r.isPostOnboard ? "text-cyan-400" : "text-slate-400"}>
                              {r.round}
                            </span>
                            {r.round === bestDiffRound?.round && (
                              <span className="ml-0.5 text-blue-400 text-[8px]">★</span>
                            )}
                            {r.isPostOnboard && (
                              <span
                                className="ml-0.5 text-cyan-500 text-[8px]"
                                title={r.hasLiveBaseline ? "baseline live this round" : "baseline continued"}
                              >
                                {r.hasLiveBaseline ? "+" : "~"}
                              </span>
                            )}
                          </td>

                          {/* Base DP — bright if live, muted if carried forward */}
                          <td className={`text-right px-1 py-1.5 text-[10px] ${
                            r.baseDP !== null
                              ? r.isPostOnboard && !r.hasLiveBaseline
                                ? "text-slate-600"          // carried forward — dim it
                                : dpColor(r.baseDP)         // live value — normal colour
                              : "text-slate-600"
                          }`}>
                            {r.baseDP !== null ? (
                              <>
                                {r.isPostOnboard && !r.hasLiveBaseline && (
                                  <span className="text-slate-700 mr-0.5">~</span>
                                )}
                                {r.baseDP.toFixed(4)}
                              </>
                            ) : "—"}
                          </td>

                          {/* BG DP */}
                          <td className={`text-right px-1 py-1.5 text-[10px] font-bold ${dpColor(r.bgDP)}`}>
                            <span className="flex items-center justify-end gap-0.5">
                              {dpBetter && <span className="text-emerald-400 text-[8px]">↓</span>}
                              {r.bgDP.toFixed(4)}
                            </span>
                          </td>

                          {/* Base EO */}
                          <td className={`text-right px-1 py-1.5 text-[10px] ${
                            r.baseEO !== null
                              ? r.isPostOnboard && !r.hasLiveBaseline
                                ? "text-slate-600"
                                : eoColor(r.baseEO)
                              : "text-slate-600"
                          }`}>
                            {r.baseEO !== null ? (
                              <>
                                {r.isPostOnboard && !r.hasLiveBaseline && (
                                  <span className="text-slate-700 mr-0.5">~</span>
                                )}
                                {r.baseEO.toFixed(4)}
                              </>
                            ) : "—"}
                          </td>

                          {/* BG EO */}
                          <td className={`text-right px-1 py-1.5 text-[10px] font-bold ${eoColor(r.bgEO)}`}>
                            <span className="flex items-center justify-end gap-0.5">
                              {eoBetter && <span className="text-emerald-400 text-[8px]">↓</span>}
                              {r.bgEO.toFixed(4)}
                            </span>
                          </td>

                          {/* Action */}
                          <td className="text-right px-3 py-1.5">
                            {r.rejected > 0 ? (
                              <span className="text-red-400 text-[9px]">⛔{r.rejected}</span>
                            ) : r.bgDP > 0.05 ? (
                              <span className="text-orange-400 text-[9px]">⚖</span>
                            ) : (
                              <span className="text-emerald-600 text-[9px]">✓</span>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel 3 — Privacy Engine */}
        <div className="flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-800/40 bg-slate-950/20">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
              🔐 Differential Privacy Engine
            </p>
          </div>
          <div className="h-72 px-4 py-4 overflow-y-auto space-y-4">
            <div>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider font-mono mb-2">Configuration</p>
              <div className="space-y-2">
                {[
                  { label: "Mechanism",       value: "Gaussian Noise",   color: "text-cyan-300"   },
                  { label: "Noise Scale σ",   value: `${noiseScale}`,    color: "text-yellow-300" },
                  { label: "Gradient Clip C", value: `${clipValue}`,     color: "text-blue-300"   },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-mono">{item.label}</span>
                    <span className={`text-[10px] font-mono font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="px-6 py-2.5 border-t border-slate-800/40 bg-slate-950/30 flex items-center justify-between">
        <p className="text-[10px] text-slate-500 font-mono">
          Two-layer correction: gradient-level fairness loss + round-level aggregation penalty · DP via Gaussian mechanism
          {onboardRound && ` · + live baseline · ~ carried forward`}
        </p>
        <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500">
          <span>✅ Low &lt;0.05</span>
          <span>🟡 Moderate 0.05–0.10</span>
          <span>🟠 High 0.10–0.30</span>
          <span>🔴 Critical &gt;0.30</span>
        </div>
      </div>
    </div>
  );
}