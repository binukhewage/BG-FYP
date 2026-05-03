"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck, ArrowLeft, RefreshCw,
  AlertTriangle, TrendingUp, TrendingDown, LayoutGrid, User
} from "lucide-react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://127.0.0.1:8000";

const URGENCY = {
  Escalate: { color: "#ef4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.22)",  dot: "#ef4444" },
  Concern:  { color: "#f97316", bg: "rgba(249,115,22,0.07)", border: "rgba(249,115,22,0.2)",  dot: "#f97316" },
  Watch:    { color: "#f59e0b", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.18)", dot: "#f59e0b" },
  Stable:   { color: "#10b981", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.18)", dot: "#10b981" },
};

const SAMPLE_LABELS = {
  sickest: "Top Alert 25",
  random:  "Random",
  mixed:   "Mixed",
};

const fmt1  = (v) => (v == null ? "—" : Number(v).toFixed(1));
const fmtPP = (v) => {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}pp`;
};

export default function WardView() {
  const router = useRouter();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [sample,  setSample]  = useState("sickest");
  const [seed,    setSeed]    = useState(42);
  const [sortBy,  setSortBy]  = useState("risk");
  const [filter,  setFilter]  = useState("all");

  const fetchWard = async (sampleMode = sample, s = seed) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/clinician/ward?sample=${sampleMode}&seed=${s}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData(await res.json());
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchWard(); }, []);

  const handleRefresh = () => {
    const s = Math.floor(Math.random() * 9999);
    setSeed(s); setSample("random"); fetchWard("random", s);
  };

  const patients = data?.patients ?? [];
  const filtered = filter === "all" ? patients : patients.filter(p => p.urgency === filter);
  const sorted   = [...filtered].sort((a, b) => {
    if (sortBy === "news2")  return b.news2 - a.news2;
    if (sortBy === "vs_avg") return Math.abs(b.vs_avg_pp) - Math.abs(a.vs_avg_pp);
    return b.risk_pct - a.risk_pct;
  });

  const fairGood = data ? Math.abs(data.fairness.gap_pp) < 5 : true;

  return (
    <div className="min-h-screen bg-[#070c18] text-slate-100" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[rgba(7,12,24,0.97)] backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">

          {/* Left — brand + back links */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link href="/" className="flex items-center gap-2 no-underline">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}>
                <ShieldCheck size={14} color="#fff" strokeWidth={2.5} />
              </div>
              <span className="text-sm font-bold text-white tracking-tight">BiasGuard</span>
              <span className="text-xs text-slate-500">· Ward Overview</span>
            </Link>
          </div>

          {/* Centre — sample mode toggle */}
          <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] rounded-lg p-1 mx-auto">
            {Object.entries(SAMPLE_LABELS).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => { setSample(mode); fetchWard(mode, seed); }}
                disabled={loading}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  ${sample === mode
                    ? "bg-indigo-500/25 text-indigo-300"
                    : "text-slate-500 hover:text-slate-300"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Right — refresh */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh Ward
            </button>
            <button
              onClick={() => router.push("/clinician")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#a5b4fc" }}
            >
              <User size={12} />
              Patient View
            </button>
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#a5b4fc" }}
            >
              <LayoutGrid size={12} />
              Dashboard
            </button>
          </div>

        </div>
      </nav>

      {/* ── Content ────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-6">

        {error && (
          <div className="flex items-center gap-3 bg-red-950/30 border border-red-800/40 text-red-300 px-4 py-3 rounded-xl text-sm mb-5">
            <AlertTriangle size={14} className="flex-shrink-0" /> {error}
          </div>
        )}

        {loading && !data && <LoadingSkeleton />}

        {data && (
          <>
            {/* Summary cards */}
            <div className="grid gap-2.5 mb-5" style={{ gridTemplateColumns: "repeat(8,1fr)" }}>

              {["Escalate","Concern","Watch","Stable"].map(u => (
                <SummaryCard
                  key={u}
                  value={data.urgency_counts[u]}
                  label={u}
                  color={URGENCY[u].color}
                  onClick={() => setFilter(filter === u ? "all" : u)}
                  active={filter === u}
                />
              ))}

              {/* Ward avg */}
              <div className="col-span-2 rounded-xl p-3 cursor-default"
                style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(99,102,241,0.25)" }}>
                <div className="text-[10px] text-slate-500 mb-1">Ward avg risk</div>
                <div className="text-2xl font-bold text-indigo-400">{fmt1(data.ward_avg_risk_pct)}%</div>
                <div className="text-[10px] text-slate-600 mt-1">{data.total} patients</div>
              </div>

              {/* Fairness gap */}
              <div className="col-span-2 rounded-xl p-3 cursor-default"
                style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${fairGood?"rgba(16,185,129,0.25)":"rgba(249,115,22,0.25)"}` }}>
                <div className="text-[10px] text-slate-500 mb-1">Senior vs non-senior gap</div>
                <div className="text-2xl font-bold" style={{ color: fairGood ? "#10b981" : "#f97316" }}>
                  {fmtPP(data.fairness.gap_pp)}
                </div>
                <div className="text-[10px] text-slate-600 mt-1">
                  {data.fairness.senior_avg_risk_pct}% vs {data.fairness.non_senior_avg_risk_pct}%
                </div>
              </div>
            </div>

            {/* Fairness bar */}
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm mb-5 ${
              fairGood
                ? "bg-emerald-950/20 border border-emerald-800/25 text-emerald-400/80"
                : "bg-orange-950/20 border border-orange-800/25 text-orange-400/80"
            }`}>
              <ShieldCheck size={13} className="flex-shrink-0" />
              <span>{data.fairness.interpretation}</span>
              <span className="ml-auto text-[10px] text-slate-600 flex-shrink-0">
                Simulated ward · {SAMPLE_LABELS[data.sample_mode]}
              </span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-600">Sort by:</span>
              {[["risk","Risk %"],["vs_avg","|vs avg|"]].map(([key,label]) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border
                    ${sortBy === key
                      ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                      : "bg-transparent border-white/[0.08] text-slate-500 hover:text-slate-300"}`}
                >
                  {label}
                </button>
              ))}
              {filter !== "all" && (
                <button
                  onClick={() => setFilter("all")}
                  className="ml-auto px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-950/30 border border-red-800/30 text-red-400"
                >
                  Clear filter ×
                </button>
              )}
              <span className={`text-xs text-slate-600 ${filter === "all" ? "ml-auto" : ""}`}>
                {sorted.length} patient{sorted.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Table */}
            <div className="rounded-2xl overflow-hidden border border-white/[0.07]" style={{ background:"rgba(255,255,255,0.02)" }}>

              {/* Header */}
              <div className="grid px-4 py-2.5 bg-black/30 border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-widest text-slate-500"
                style={{ gridTemplateColumns:"40px 110px 80px 100px 50px 130px 90px 120px 60px 40px" }}>
                <span>#</span>
                <span>Patient</span>
                <span className="text-right">Risk %</span>
                <span>Urgency</span>
                <span className="text-right">Age</span>
                <span>Group</span>
                <span className="text-right">vs avg</span>
                <span>Top flag</span>
               
              </div>

              {sorted.length === 0 && (
                <div className="py-12 text-center text-slate-600 text-sm">
                  No patients in this urgency band
                </div>
              )}

              {sorted.map((p, i) => {
                const uc = URGENCY[p.urgency] || URGENCY.Stable;
                const vsColor =
                  p.vs_avg_pp > 10 ? "#ef4444" :
                  p.vs_avg_pp > 3  ? "#f97316" :
                  p.vs_avg_pp < -5 ? "#10b981" : "rgba(148,163,184,0.5)";

                return (
                  <div
                    key={p.patient_id}
                    onClick={() => router.push(`/clinician?id=${p.patient_id}`)}
                    className="grid px-4 py-2.5 border-b border-white/[0.04] cursor-pointer items-center transition-colors"
                    style={{
                      gridTemplateColumns: "40px 110px 80px 100px 50px 130px 90px 120px 60px 40px",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.06)"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)"}
                  >
                    {/* Rank */}
                    <span className="text-xs text-slate-600 font-medium">{i + 1}</span>

                    {/* Patient ID */}
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: uc.dot }} />
                      <span className="text-xs font-semibold text-slate-200 font-mono">#{p.patient_id}</span>
                    </div>

                    {/* Risk */}
                    <div className="text-right">
                      <span className="text-sm font-bold tabular-nums" style={{ color: uc.color }}>
                        {fmt1(p.risk_pct)}%
                      </span>
                    </div>

                    {/* Urgency */}
                    <div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wide"
                        style={{ background: uc.bg, border: `1px solid ${uc.border}`, color: uc.color }}>
                        {p.urgency}
                      </span>
                    </div>

                    {/* Age */}
                    <span className="text-right text-xs text-slate-500">{p.age}</span>

                    {/* Group */}
                    <span className="text-xs" style={{ color: p.is_senior ? "rgba(196,181,253,0.7)" : "rgba(147,197,253,0.7)" }}>
                      {p.group}
                    </span>

                    {/* vs avg */}
                    <div className="flex items-center justify-end gap-1">
                      {p.vs_avg_pp > 3  && <TrendingUp   size={10} color="#ef4444" />}
                      {p.vs_avg_pp < -3 && <TrendingDown size={10} color="#10b981" />}
                      <span className="text-xs font-semibold tabular-nums" style={{ color: vsColor }}>
                        {fmtPP(p.vs_avg_pp)}
                      </span>
                    </div>

                    {/* Top flag */}
                    <span className="text-[10px]"
                      style={{ color: p.top_flag ? "rgba(251,146,60,0.8)" : "rgba(148,163,184,0.2)", fontStyle: p.top_flag ? "normal" : "italic" }}>
                      {p.top_flag ?? "—"}
                    </span>

                    

                    {/* Arrow */}
                    <div className="text-right text-slate-700 text-base">›</div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-4 flex items-center justify-between text-[10px] text-slate-700">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={10} />
                BiasGuard Ward Overview · Research prototype · Click any patient to view full assessment
              </span>
              <span>vs avg = risk minus group average · NEWS2 = National Early Warning Score 2</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ value, label, color, onClick, active }) {
  return (
    <div
      onClick={onClick}
      className="rounded-xl p-3 cursor-pointer transition-all"
      style={{
        background: active ? `${color}10` : "rgba(255,255,255,0.02)",
        border: `1px solid ${active ? color : "rgba(255,255,255,0.07)"}`,
      }}
    >
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold leading-none" style={{ color }}>{value}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 opacity-40">
      <div className="grid gap-2.5" style={{ gridTemplateColumns:"repeat(8,1fr)" }}>
        {Array(8).fill(0).map((_,i) => (
          <div key={i} className="h-16 rounded-xl bg-white/[0.04]" />
        ))}
      </div>
      {Array(10).fill(0).map((_,i) => (
        <div key={i} className="h-11 rounded-lg bg-white/[0.03]" />
      ))}
    </div>
  );
}