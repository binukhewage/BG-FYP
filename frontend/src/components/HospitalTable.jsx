"use client";

// ─────────────────────────────────────────────────────────────
// HospitalTable — Institutional Bias Governance Panel
// ─────────────────────────────────────────────────────────────

export default function HospitalTable({
  hospitals,
  firstRoundHospitals = [],   // NEW: server.first_round_hospital_metrics
  mode = "bias",
}) {
  if (!hospitals || hospitals.length === 0) return null;

  // Build a lookup from first-round data by hospital filename
  const firstRoundMap = {};
  firstRoundHospitals.forEach(h => { firstRoundMap[h.hospital] = h; });

  const sorted = [...hospitals].sort((a, b) => {
    // Sort by first-round DP descending (most originally biased first)
    const aFirst = firstRoundMap[a.hospital]?.dp ?? a.dp;
    const bFirst = firstRoundMap[b.hospital]?.dp ?? b.dp;
    return bFirst - aFirst;
  });

  // ── Bias level thresholds ──────────────────────────────────
  const getBiasLevel = (dp) =>
    dp < 0.05 ? { label: "Low",      dot: "bg-emerald-400", text: "text-emerald-300", badge: "bg-emerald-950/50 border-emerald-800/60 text-emerald-300" } :
    dp < 0.15 ? { label: "Moderate", dot: "bg-yellow-400",  text: "text-yellow-300",  badge: "bg-yellow-950/50 border-yellow-800/60 text-yellow-300"   } :
                { label: "High",     dot: "bg-red-400",     text: "text-red-300",     badge: "bg-red-950/50 border-red-800/60 text-red-300"             };

  // ── Bias direction — always use raw dp_direction value ─────
  // FIX: removed the dp < 0.05 → "Equitable" short-circuit so
  // direction is always derived from the actual signed gap,
  // even when overall DP is low at late rounds.
  const getDirection = (dpDir) => {
    if (dpDir > 0.01)  return { label: "Senior ↑ ",     badge: "bg-orange-950/40 border-orange-800/50 text-orange-300" };
    if (dpDir < -0.01) return { label: "Non-senior ↑ ", badge: "bg-red-950/40 border-red-800/50 text-red-300"          };
    return                    { label: "Balanced",                badge: "bg-emerald-950/40 border-emerald-800/50 text-emerald-300" };
  };

  // ── Aggregation weight colour ──────────────────────────────
  const weightColor = (w) =>
    w === 0   ? "bg-red-500"    :
    w < 0.15  ? "bg-orange-500" :
    w < 0.25  ? "bg-yellow-500" :
                "bg-emerald-500";

  // ── Reduction badge ────────────────────────────────────────
  const reductionColor = (pct) =>
    pct >= 80 ? "text-emerald-400" :
    pct >= 50 ? "text-yellow-400"  :
                "text-orange-400";

  const totalRejected = hospitals.filter(h => h.rejected).length;
  const hasFirstRound = firstRoundHospitals.length > 0;

  return (
    <div className="bg-slate-900/60 backdrop-blur-sm rounded-2xl border border-slate-800/70 shadow-xl overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-6 py-5 border-b border-slate-800/60 bg-slate-950/30">
        <div>
          <h2 className="text-base font-bold text-slate-200 flex items-center gap-3 uppercase">
            <span className="w-1.5 h-5 bg-blue-500 rounded-full" />
            Institutional Bias Governance Panel
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            Per-node fairness audit · BiasGuard aggregation weights · Round 1 → current reduction
          </p>
        </div>
        {mode === "bias" && totalRejected > 0 && (
          <span className="text-[11px] font-semibold bg-red-950/50 text-red-300 border border-red-800/60 px-3 py-1 rounded-full flex items-center gap-1.5">
            ⛔ {totalRejected} node{totalRejected > 1 ? "s" : ""} rejected
          </span>
        )}
      </div>

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-800/60 text-slate-500 text-[10px] uppercase tracking-wider">
              <th className="px-4 py-3">Rank</th>
              <th className="px-3 py-3">Hospital</th>
              <th className="px-3 py-3 text-right">AUC</th>

              {/* DP: before → now → peak → reduction */}
              {hasFirstRound && (
                <th className="px-3 py-3 text-right text-slate-600">R1 DP</th>
              )}
              <th className="px-3 py-3 text-right">DP now</th>
              <th className="px-3 py-3 text-right">Peak DP</th>
              {hasFirstRound && (
                <th className="px-3 py-3 text-right text-emerald-600">DP reduction</th>
              )}

              {/* EO */}
              {hasFirstRound && (
                <th className="px-3 py-3 text-right text-slate-600">R1 EO</th>
              )}
              <th className="px-3 py-3 text-right">EO now</th>

              {/* Rates */}
              <th className="px-3 py-3 text-right">Senior rate</th>
              <th className="px-3 py-3 text-right">Non-sen rate</th>

              

              {/* Direction + level */}
              <th className="px-3 py-3">Direction</th>
              <th className="px-3 py-3">Bias level</th>
              <th className="px-3 py-3 text-right">Samples</th>
            </tr>
          </thead>

          <tbody>
            {sorted.map((h, i) => {
              const first     = firstRoundMap[h.hospital] ?? null;
              const biasLevel = getBiasLevel(h.dp);
              const direction = getDirection(h.dp_direction);
              const isWorst   = i === 0 && (first?.dp ?? h.dp) >= 0.05;
              const rejected  = h.rejected || false;
              const weight    = h.fairness_weight ?? null;
              const peakDp    = h.peak_dp ?? h.dp;

              // DP reduction from round 1 → now
              const dpReduction = first && first.dp > 0
                ? ((first.dp - h.dp) / first.dp * 100)
                : null;

              // EO from round 1
              const firstEO = first?.eo ?? null;

              return (
                <tr
                  key={i}
                  className={`border-b border-slate-800/40 transition-colors ${
                    rejected ? "bg-red-950/20" :
                    isWorst  ? "bg-orange-950/10" :
                               "hover:bg-slate-800/20"
                  }`}
                >
                  {/* Rank */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        first ? getBiasLevel(first.dp).dot : biasLevel.dot
                      }`} />
                      <span className="text-slate-400">#{i + 1}</span>
                    </div>
                  </td>

                  {/* Hospital name */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-200 font-semibold">
                        {h.hospital?.replace(".csv", "")}
                      </span>
                      {rejected && (
                        <span className="text-[9px] text-red-400 border border-red-800/60 px-1.5 py-0.5 rounded font-bold">
                          REJECTED
                        </span>
                      )}
                      {isWorst && !rejected && (
                        <span className="text-[9px] text-orange-400 border border-orange-800/60 px-1.5 py-0.5 rounded">
                          most biased
                        </span>
                      )}
                    </div>
                  </td>

                  {/* AUC */}
                  <td className="px-3 py-3 text-right text-blue-300 font-bold">
                    {h.auc.toFixed(3)}
                  </td>

                  {/* R1 DP */}
                  {hasFirstRound && (
                    <td className={`px-3 py-3 text-right text-[10px] ${
                      first ? getBiasLevel(first.dp).text : "text-slate-600"
                    }`}>
                      {first ? first.dp.toFixed(4) : "—"}
                    </td>
                  )}

                  {/* DP now */}
                  <td className={`px-3 py-3 text-right font-bold ${biasLevel.text}`}>
                    {h.dp.toFixed(4)}
                  </td>

                  {/* Peak DP */}
                  <td className={`px-3 py-3 text-right text-[10px] ${getBiasLevel(peakDp).text}`}>
                    {peakDp.toFixed(4)}
                  </td>

                  {/* DP reduction */}
                  {hasFirstRound && (
                    <td className="px-3 py-3 text-right">
                      {dpReduction !== null ? (
                        <span className={`font-bold text-[11px] ${reductionColor(dpReduction)}`}>
                          ↓{dpReduction.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  )}

                  {/* R1 EO */}
                  {hasFirstRound && (
                    <td className="px-3 py-3 text-right text-[10px] text-slate-500">
                      {firstEO !== null ? firstEO.toFixed(4) : "—"}
                    </td>
                  )}

                  {/* EO now */}
                  <td className="px-3 py-3 text-right text-slate-400">
                    {h.eo.toFixed(4)}
                  </td>

                  {/* Senior prediction rate */}
                  <td className="px-3 py-3 text-right text-cyan-400">
                    {h.senior_rate !== undefined
                      ? h.senior_rate.toFixed(4)
                      : "—"}
                  </td>

                  {/* Non-senior prediction rate */}
                  <td className="px-3 py-3 text-right text-blue-300">
                    {h.non_senior_rate !== undefined
                      ? h.non_senior_rate.toFixed(4)
                      : "—"}
                  </td>

                  

                  {/* Bias direction — fixed to always use dp_direction */}
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${direction.badge}`}>
                      {direction.label}
                    </span>
                  </td>

                  {/* Bias level — based on current DP */}
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${biasLevel.badge}`}>
                      {biasLevel.label}
                    </span>
                  </td>

                  {/* Samples */}
                  <td className="px-3 py-3 text-right text-slate-500">
                    {h.samples?.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div className="px-6 py-3 border-t border-slate-800/40 bg-slate-950/20 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-slate-600 font-mono">
          Bias thresholds: Low &lt;0.05 · Moderate 0.05–0.15 · High &gt;0.15 &nbsp;|&nbsp;
          {mode === "bias"
            ? "Agg. weight = 1 / (1 + λ × DP) · Peak DP = highest bias seen across all rounds"
            : "Baseline: Standard FedAvg — equal weight regardless of bias"}
        </p>
        <div className="flex items-center gap-4 text-[10px] font-mono text-slate-600">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Low</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Moderate</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> High</span>
        </div>
      </div>
    </div>
  );
}