"use client";

// ─────────────────────────────────────────────────────────────
// MetricCard — Enhanced with initial / baseline comparison
//
// Props:
//   title        — metric name
//   value        — current BiasGuard value (string)
//   subtitle     — context label
//   type         — "auc" | "dp" | "eo" | "nodes"
//   initialValue — round-1 value (before any training)
//   baselineValue— standard FedAvg final value
//   dark         — bool
// ─────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  auc: {
    accent:     "from-blue-500 to-blue-600",
    border:     "border-blue-500/20",
    valueColor: "text-blue-300",
    // For AUC: higher is better
    improvementGood: (current, reference) => parseFloat(current) >= parseFloat(reference),
    label: "Higher is better",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  dp: {
    accent:     "from-red-500 to-orange-500",
    border:     "border-red-500/20",
    valueColor: "text-red-300",
    // For DP: lower is better
    improvementGood: (current, reference) => parseFloat(current) <= parseFloat(reference),
    label: "Lower is fairer",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  eo: {
    accent:     "from-emerald-500 to-teal-500",
    border:     "border-emerald-500/20",
    valueColor: "text-emerald-300",
    improvementGood: (current, reference) => parseFloat(current) <= parseFloat(reference),
    label: "Lower is fairer",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
  },
  nodes: {
    accent:     "from-cyan-500 to-sky-500",
    border:     "border-cyan-500/20",
    valueColor: "text-cyan-300",
    improvementGood: () => true,
    label: "Active hospitals",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
};

export default function MetricCard({
  title,
  value,
  subtitle,
  type       = "default",
  initialValue   = null,   // round 1 value
  baselineValue  = null,   // standard FedAvg final
  dark       = false,
}) {
  const config = TYPE_CONFIG[type] ?? {
    accent: "from-slate-500 to-slate-600",
    border: "border-slate-500/20",
    valueColor: "text-white",
    improvementGood: () => true,
    label: "",
    icon: null,
  };

  // Reduction from initial value
  const hasInitial  = initialValue  !== null && initialValue  !== undefined;
  const hasBaseline = baselineValue !== null && baselineValue !== undefined;

  const initNum = hasInitial  ? parseFloat(initialValue)  : null;
  const baseNum = hasBaseline ? parseFloat(baselineValue) : null;
  const currNum = parseFloat(value);

  // % change from initial
  const initReduction = hasInitial && initNum !== 0
    ? ((initNum - currNum) / initNum * 100)
    : null;

  // % change vs baseline
  const vsBaseline = hasBaseline && baseNum !== 0
    ? ((baseNum - currNum) / baseNum * 100)
    : null;

  // Is current better than baseline?
  const betterThanBaseline = hasBaseline
    ? config.improvementGood(currNum, baseNum)
    : null;

  return (
    <div className={`
      relative rounded-2xl border shadow-lg overflow-hidden
      bg-slate-900/70 backdrop-blur-sm
      ${config.border}
      transition-all duration-300 hover:scale-[1.02] hover:shadow-xl
    `}>
      {/* Gradient top bar */}
      <div className={`h-0.5 w-full bg-gradient-to-r ${config.accent}`} />

      {/* Glow */}
      <div className="absolute top-3 right-3 opacity-10 pointer-events-none">
        <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${config.accent} blur-xl`} />
      </div>

      <div className="px-4 pt-4 pb-3 relative">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
            {title}
          </h3>
          {config.icon && (
            <div className="flex items-center justify-center w-7 h-7 rounded-lg opacity-50 text-slate-300">
              {config.icon}
            </div>
          )}
        </div>

        {/* Current value — big */}
        <div className="flex items-baseline gap-2 mb-3">
          <p className={`text-3xl font-bold tracking-tight font-mono ${config.valueColor}`}>
            {value}
          </p>
          {hasBaseline && betterThanBaseline !== null && (
            <span className={`text-sm font-bold ${betterThanBaseline ? "text-emerald-400" : "text-red-400"}`}>
              {betterThanBaseline ? "↓" : "↑"}
            </span>
          )}
        </div>

        {/* Comparison rows — only for dp/eo/auc, not nodes */}
        {type !== "nodes" && (hasInitial || hasBaseline) && (
          <div className="space-y-1.5 border-t border-slate-800/60 pt-2.5">

            

            {/* Baseline vs BiasGuard */}
            {hasBaseline && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">
                  vs Baseline
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {baselineValue}
                  </span>
                  {vsBaseline !== null && (
                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                      betterThanBaseline
                        ? "bg-blue-950/60 text-blue-400"
                        : "bg-red-950/60 text-red-400"
                    }`}>
                      {betterThanBaseline ? "↓" : "↑"}{Math.abs(vsBaseline).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Subtitle */}
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] text-slate-600 font-mono">{config.label}</p>
          {subtitle && (
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <span className={`w-1 h-1 rounded-full bg-gradient-to-br ${config.accent} inline-block`} />
              {subtitle}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}