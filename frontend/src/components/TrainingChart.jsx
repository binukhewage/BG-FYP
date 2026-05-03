"use client";

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  const bgDP   = payload.find(p => p.dataKey === "avg_dp")?.value;
  const bgAUC  = payload.find(p => p.dataKey === "avg_auc")?.value;
  const bgEO   = payload.find(p => p.dataKey === "avg_eo")?.value;
  const baseDP = payload.find(p => p.dataKey === "baseline_dp")?.value;
  const baseAUC= payload.find(p => p.dataKey === "baseline_auc")?.value;
  const baseEO = payload.find(p => p.dataKey === "baseline_eo")?.value;

  const severity =
    bgDP > 0.3  ? { label: "CRITICAL", cls: "text-red-400 bg-red-950/60 border-red-800"        } :
    bgDP > 0.1  ? { label: "HIGH",     cls: "text-orange-400 bg-orange-950/60 border-orange-800"} :
    bgDP > 0.05 ? { label: "MODERATE", cls: "text-yellow-400 bg-yellow-950/60 border-yellow-800"} :
                  { label: "LOW",      cls: "text-emerald-400 bg-emerald-950/60 border-emerald-800"};

  const dpDiff  = baseDP  !== undefined && bgDP  !== undefined ? ((baseDP  - bgDP)  / baseDP  * 100).toFixed(1) : null;
  const aucDiff = baseAUC !== undefined && bgAUC !== undefined ? ((bgAUC   - baseAUC) / baseAUC * 100).toFixed(1) : null;
  const eoDiff  = baseEO  !== undefined && bgEO  !== undefined ? ((baseEO  - bgEO)  / baseEO  * 100).toFixed(1) : null;

  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl p-4 min-w-[220px] backdrop-blur">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-700/60">
        <p className="text-slate-300 text-sm font-semibold">Round {label}</p>
        {bgDP !== undefined && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${severity.cls}`}>
            {severity.label}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: entry.color, opacity: entry.strokeDasharray ? 0.55 : 1 }} />
              <span className="text-slate-400 text-xs">{entry.name}</span>
            </div>
            <span className="font-mono text-white text-xs font-bold">
              {entry.value?.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
      {(dpDiff !== null || aucDiff !== null || eoDiff !== null) && (
        <div className="mt-3 pt-2 border-t border-slate-700/60 space-y-1">
          {dpDiff  !== null && <p className={`text-[11px] font-semibold ${parseFloat(dpDiff)  >= 0 ? "text-emerald-400" : "text-red-400"}`}>DP  {parseFloat(dpDiff)  >= 0 ? "↓" : "↑"} {Math.abs(parseFloat(dpDiff))}% vs Baseline</p>}
          {eoDiff  !== null && <p className={`text-[11px] font-semibold ${parseFloat(eoDiff)  >= 0 ? "text-emerald-400" : "text-red-400"}`}>EO  {parseFloat(eoDiff)  >= 0 ? "↓" : "↑"} {Math.abs(parseFloat(eoDiff))}% vs Baseline</p>}
          {aucDiff !== null && <p className={`text-[11px] font-semibold ${parseFloat(aucDiff) >= 0 ? "text-blue-400"   : "text-red-400"}`}>AUC {parseFloat(aucDiff) >= 0 ? "↑" : "↓"} {Math.abs(parseFloat(aucDiff))}% vs Baseline</p>}
        </div>
      )}
    </div>
  );
};

const CustomLegend = ({ payload }) => (
  <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-2">
    {payload?.map((entry, i) => (
      <div key={i} className="flex items-center gap-2">
        <div className="w-6 h-0.5 rounded-full"
          style={{ backgroundColor: entry.color, opacity: entry.payload?.strokeDasharray ? 0.5 : 1 }} />
        <span className={`text-xs ${entry.payload?.strokeDasharray ? "text-slate-500" : "text-slate-400"}`}>
          {entry.value}
        </span>
      </div>
    ))}
  </div>
);

export default function TrainingChart({
  data         = [],
  baselineData = [],
  mode         = "bias",
  currentRound,
  totalRounds,
  loading,
  progressPercent,
}) {
  const showBaseline = mode === "bias" && baselineData.length > 0;

  // Carry forward last known baseline values so dashed lines
  // continue across all post-onboarding rounds
  const lastBaseline = baselineData.length > 0
    ? baselineData[baselineData.length - 1]
    : null;

  const mergedData = data.map((r, i) => ({
    ...r,
    baseline_dp:  baselineData[i]?.avg_dp  ?? lastBaseline?.avg_dp  ?? null,
    baseline_auc: baselineData[i]?.avg_auc ?? lastBaseline?.avg_auc ?? null,  // ← NEW
    baseline_eo:  baselineData[i]?.avg_eo  ?? lastBaseline?.avg_eo  ?? null,  // ← NEW
  }));

  const latestRound  = data[data.length - 1];
  const latestBase   = lastBaseline;

  // ── Badge: DP reduction vs Baseline (not vs initial) ──────
  const dpVsBaseline = latestRound && latestBase && latestBase.avg_dp > 0
    ? ((latestBase.avg_dp - latestRound.avg_dp) / latestBase.avg_dp * 100).toFixed(1)
    : null;

  const aucVsBaseline = latestRound && latestBase && latestBase.avg_auc > 0
    ? ((latestRound.avg_auc - latestBase.avg_auc) / latestBase.avg_auc * 100).toFixed(2)
    : null;

  // Best advantage round
  let bestAdvantageRound = null;
  let bestAdvantage      = -Infinity;
  mergedData.forEach(r => {
    if (r.baseline_dp !== null) {
      const adv = r.baseline_dp - r.avg_dp;
      if (adv > bestAdvantage) { bestAdvantage = adv; bestAdvantageRound = r; }
    }
  });

  return (
    <div className="bg-slate-900/60 backdrop-blur-sm rounded-2xl border border-slate-800/70 shadow-xl overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between px-6 py-5 border-b border-slate-800/60 bg-slate-950/30">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-900/40 border border-blue-500/30 shadow-lg flex-shrink-0">
            <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-white">Federated Training Progress</h2>
              {loading && (
                <span className="text-[11px] font-semibold bg-emerald-900/50 text-emerald-400 px-2.5 py-1 rounded-full animate-pulse border border-emerald-800/60 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                  ROUND {currentRound}/{totalRounds}
                </span>
              )}
              {!loading && data.length > 0 && (
                <span className="text-[11px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full border border-slate-700">
                  {totalRounds} rounds complete
                </span>
              )}
            </div>
            <p className="text-slate-500 text-xs mt-1 font-mono">
              AUC · Demographic Parity · Equal Opportunity
              {showBaseline && " — BiasGuard vs Standard FedAvg overlay"}
            </p>
          </div>
        </div>

        {/* ── Badge: vs Baseline ─────────────────────────────── */}
        <div className="mt-4 md:mt-0 bg-slate-950/60 px-4 py-3 rounded-xl border border-slate-800/80 text-right flex-shrink-0 min-w-[160px]">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">
            DP Reduced vs Baseline
          </p>
          {dpVsBaseline !== null ? (
            <div>
              <p className="font-bold text-2xl text-emerald-400 font-mono">
                ↓{dpVsBaseline}%
              </p>
              {latestBase && latestRound && (
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {latestBase.avg_dp?.toFixed(3)} → {latestRound.avg_dp?.toFixed(3)}
                </p>
              )}
              {aucVsBaseline !== null && (
                <p className="text-[10px] text-slate-600 font-mono mt-0.5">
                  AUC cost {parseFloat(aucVsBaseline) >= 0 ? "+" : ""}{aucVsBaseline}%
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-600 text-sm font-mono">Awaiting data</p>
          )}
        </div>
      </div>

      {/* ── Progress bar ────────────────────────────────────── */}
      {loading && (
        <div className="px-6 pt-4">
          <div className="flex justify-between text-[11px] text-slate-400 mb-1.5 font-mono">
            <span>Aggregating weights · Computing fairness penalties · Updating global model</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-1.5 border border-slate-800 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(6,182,212,0.6)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Chart ───────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-2">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={mergedData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>

            <ReferenceArea y1={0.3}  y2={1.0}  fill="#ef444410" fillOpacity={1} />
            <ReferenceArea y1={0.1}  y2={0.3}  fill="#f9731610" fillOpacity={1} />
            <ReferenceArea y1={0.05} y2={0.1}  fill="#eab30810" fillOpacity={1} />
            <ReferenceArea y1={0.0}  y2={0.05} fill="#10b98110" fillOpacity={1} />

            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.8} />

            <XAxis
              dataKey="round"
              stroke="#475569"
              tick={{ fill: "#64748b", fontSize: 11, fontFamily: "monospace" }}
              tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }}
              label={{ value: "Federation Round", position: "insideBottom", offset: -10, fill: "#475569", fontSize: 11 }}
            />
            <YAxis
              stroke="#475569"
              tick={{ fill: "#64748b", fontSize: 11, fontFamily: "monospace" }}
              tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }}
              domain={[0, 1]}
              tickFormatter={v => v.toFixed(1)}
            />

            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} verticalAlign="top" height={40} />

            {currentRound > 0 && (
              <ReferenceLine x={currentRound} stroke="#60a5fa" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `R${currentRound}`, position: "top", fill: "#60a5fa", fontSize: 10, fontFamily: "monospace" }} />
            )}

            <ReferenceLine y={0.05} stroke="#10b981" strokeDasharray="6 3" strokeWidth={1}
              label={{ value: "5% fairness target", position: "insideTopLeft", fill: "#10b981", fontSize: 10, fontFamily: "monospace" }} />

            {bestAdvantageRound && mode === "bias" && (
              <ReferenceLine x={bestAdvantageRound.round} stroke="#a78bfa" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `★ R${bestAdvantageRound.round}`, position: "top", fill: "#a78bfa", fontSize: 10, fontFamily: "monospace" }} />
            )}

            {/* ── Baseline dashed lines (all three) ─────────── */}
            {showBaseline && (
              <>
                <Line type="monotone" dataKey="baseline_dp"
                  name="Baseline DP"
                  stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3"
                  dot={false} opacity={0.45}
                  activeDot={{ r: 4, fill: "#ef4444", stroke: "#fff", strokeWidth: 1 }} />
                <Line type="monotone" dataKey="baseline_eo"
                  name="Baseline EO"
                  stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 3"
                  dot={false} opacity={0.45}
                  activeDot={{ r: 4, fill: "#10b981", stroke: "#fff", strokeWidth: 1 }} />
                <Line type="monotone" dataKey="baseline_auc"
                  name="Baseline AUC"
                  stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 3"
                  dot={false} opacity={0.45}
                  activeDot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 1 }} />
              </>
            )}

            {/* ── BiasGuard solid lines ──────────────────────── */}
            <Line type="monotone" dataKey="avg_auc"
              name="BiasGuard AUC"
              stroke="#3b82f6" strokeWidth={2.5} dot={false}
              activeDot={{ r: 5, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }} />
            <Line type="monotone" dataKey="avg_dp"
              name="BiasGuard DP"
              stroke="#ef4444" strokeWidth={2.5} dot={false}
              activeDot={{ r: 5, fill: "#ef4444", stroke: "#fff", strokeWidth: 2 }} />
            <Line type="monotone" dataKey="avg_eo"
              name="BiasGuard EO"
              stroke="#10b981" strokeWidth={2.5} dot={false}
              activeDot={{ r: 5, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }} />

          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Zone legend ─────────────────────────────────────── */}
      <div className="px-6 pb-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Zones:</span>
        {[
          { color: "bg-red-500/25",    label: "Critical >30%" },
          { color: "bg-orange-500/25", label: "High 10–30%"   },
          { color: "bg-yellow-500/25", label: "Moderate 5–10%"},
          { color: "bg-emerald-500/25",label: "Low <5%"       },
        ].map((z, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${z.color}`} />
            <span className="text-[10px] text-slate-500 font-mono">{z.label}</span>
          </div>
        ))}
        {showBaseline && (
          <span className="ml-auto text-[10px] text-slate-500 font-mono">
            — — Baseline &nbsp;|&nbsp; —— BiasGuard
          </span>
        )}
      </div>

    </div>
  );
}