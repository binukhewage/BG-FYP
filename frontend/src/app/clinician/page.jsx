"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck, User, AlertTriangle, Activity,
  TrendingUp, TrendingDown, Search, Building2,
  Clock, Brain, LayoutGrid, ArrowLeft,
} from "lucide-react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://127.0.0.1:8000";

const URGENCY = {
  Stable:   { color: "#10b981", bg: "rgba(16,185,129,0.07)",  border: "rgba(16,185,129,0.22)",  label: "Stable",   advice: ["Continue standard ICU monitoring protocol.", "Reassess vitals every 4 hours.", "No immediate escalation required — maintain current care plan."] },
  Watch:    { color: "#f59e0b", bg: "rgba(245,158,11,0.07)",  border: "rgba(245,158,11,0.22)",  label: "Watch",    advice: ["Increase monitoring frequency to every 2 hours.", "Alert the senior nurse and review current medications.", "Prepare for potential escalation if trend continues."] },
  Concern:  { color: "#f97316", bg: "rgba(249,115,22,0.07)",  border: "rgba(249,115,22,0.22)",  label: "Concern",  advice: ["Arrange urgent clinical review within 30 minutes.", "Reassess all active medications and fluid balance.", "Notify the attending physician and consider escalation pathway."] },
  Escalate: { color: "#ef4444", bg: "rgba(239,68,68,0.07)",   border: "rgba(239,68,68,0.28)",   label: "Escalate", advice: ["Escalate to critical care immediately — do not delay.", "Notify the attending physician and ICU consultant now.", "Initiate emergency response protocol and prepare for intervention."] },
};

const VITALS_META = {
  glucose:           { label: "Glucose",    unit: "mg/dL" },
  creatinine:        { label: "Creatinine", unit: "mg/dL" },
  white_blood_cells: { label: "WBC",        unit: "×10³"  },
  bun:               { label: "BUN",        unit: "mg/dL" },
};

const fmt1 = (v) => (v == null ? "—" : Number(v).toFixed(1));
const fmt0 = (v) => (v == null ? "—" : Math.round(Number(v)).toString());

function ClinicianInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [patientId, setPatientId] = useState("");
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) { setPatientId(id); fetchPatient(id); }
  }, [searchParams]);

  const fetchPatient = async (id) => {
    const pid = (id ?? patientId).toString().trim();
    if (!pid) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`${API_BASE}/clinician/patient/${pid}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        setError(err.detail || `Server error ${res.status}`);
      } else {
        setData(await res.json());
      }
    } catch {
      setError("Cannot reach the server. Ensure the backend is running.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#070c18] text-slate-100" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* ── Navbar ───────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[rgba(7,12,24,0.97)] backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">

          {/* Left — brand + back */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Brand */}
            <Link href="/" className="flex items-center gap-2 no-underline group">
              
              <span className="text-sm font-bold text-white tracking-tight">BiasGuard</span>
              <span className="text-xs text-slate-500 font-normal">· Clinical Portal</span>
            </Link>

            {/* Divider */}
            <div className="w-px h-4 bg-white/10" />

            
          </div>

          {/* Centre — search (takes remaining space) */}
          <div className="flex items-center gap-2 flex-1 max-w-md mx-auto">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Enter patient ID…"
                value={patientId}
                onChange={e => setPatientId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchPatient()}
                className="w-full bg-white/5 border border-white/[0.09] rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-indigo-500/50 focus:bg-white/[0.07] transition-all"
              />
            </div>
            <button
              onClick={() => fetchPatient()}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              style={{ background: loading ? "rgba(99,102,241,0.4)" : "#6366f1", border: "1px solid rgba(129,140,248,0.3)" }}
            >
              <Activity size={13} />
              {loading ? "Analysing…" : "Assess"}
            </button>
          </div>

          {/* Right — nav actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => router.push("/wardview")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#a5b4fc" }}
            >
              <LayoutGrid size={12} />
              Ward overview
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

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="flex items-center gap-3 bg-red-950/30 border border-red-800/40 text-red-300 px-4 py-3 rounded-xl text-sm mb-6">
            <AlertTriangle size={14} className="flex-shrink-0" /> {error}
          </div>
        )}
        {!data && !loading && !error && <EmptyState onWard={() => router.push("/wardview")} />}
        {data && <Dashboard data={data} />}
      </div>
    </div>
  );
}

export default function ClinicianDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#070c18] flex items-center justify-center">
        <span className="text-slate-600 text-sm">Loading…</span>
      </div>
    }>
      <ClinicianInner />
    </Suspense>
  );
}

function EmptyState({ onWard }) {
  return (
    <div className="text-center py-24">
      <div className="w-14 h-14 rounded-2xl bg-indigo-950/50 border border-indigo-800/30 flex items-center justify-center mx-auto mb-5">
        <ShieldCheck size={26} color="rgba(129,140,248,0.4)" />
      </div>
      <p className="text-slate-400 font-semibold text-base mb-2">Enter a patient ID to begin assessment</p>
      <p className="text-slate-600 text-sm mb-8">BiasGuard · Fairness-Aware ICU Deterioration Early Warning</p>
      <button
        onClick={onWard}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-indigo-300 transition-all"
        style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)" }}
      >
        <LayoutGrid size={14} />
        View ward overview instead
      </button>
    </div>
  );
}

function Dashboard({ data }) {
  const dw = data.deterioration_warning;
  const cs = data.clinical_summary;
  const uc = URGENCY[dw?.urgency_level] || URGENCY.Watch;

  return (
    <div className="flex flex-col gap-5">

      {/* Row 1 — Patient identity + Risk card */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "320px 1fr" }}>

        {/* Patient identity */}
        <div style={card()}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <User size={17} color="#818cf8" />
            </div>
            <div>
              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mb-0.5">Patient</div>
              <div className="text-xl font-bold text-white tracking-tight">#{data.patient_id}</div>
            </div>
            <div className="ml-auto text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider flex-shrink-0"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8" }}>
              {data.fairness_context?.patient_group}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <InfoCell icon={<User size={10} />}      label="Age"    value={cs.age ? `${fmt0(cs.age)} yrs` : "—"} />
            <InfoCell icon={<Building2 size={10} />} label="Unit"   value="ICU" />
            <InfoCell icon={<Clock size={10} />}     label="Status" value={cs.is_senior ? "Senior" : "Adult"} />
          </div>
        </div>

        {/* Risk + guidance */}
        <div className="relative overflow-hidden grid gap-6 items-center"
          style={{ ...card(), background: uc.bg, border: `1px solid ${uc.border}`, gridTemplateColumns: "auto 1fr" }}>
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: uc.color, opacity: 0.04, filter: "blur(40px)", transform: "translate(30%,-30%)" }} />

          {/* Risk number */}
          <div className="text-center min-w-[120px]">
            <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-widest mb-1">Deterioration Risk</div>
            <div className="text-5xl font-black tracking-tight leading-none" style={{ color: uc.color }}>
              {fmt0(dw.risk_percentage)}%
            </div>
            <span className="inline-block mt-2 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide"
              style={{ background: uc.color + "22", border: `1px solid ${uc.color}44`, color: uc.color }}>
              {uc.label}
            </span>
            <div className="mt-3 h-1 rounded-full bg-black/20 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${dw.risk_percentage}%`, background: uc.color }} />
            </div>
            <div className="text-[10px] text-slate-600 mt-1.5">Confidence {dw.confidence}%</div>
          </div>

          {/* Guidance */}
          <div>
            <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-widest mb-3">Clinical Guidance</div>
            <div className="flex flex-col gap-2">
              {uc.advice.map((line, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5"
                    style={{ background: uc.color + "18", border: `1px solid ${uc.color}33`, color: uc.color }}>
                    {i + 1}
                  </div>
                  <span className="text-sm text-slate-300 leading-snug">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — Explainability + Lab values */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 300px" }}>

        {/* Feature contributions */}
        <div className="relative overflow-hidden" style={{ ...card(), border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.04)" }}>
          <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
            style={{ background: "linear-gradient(90deg,#6366f1,#818cf8,#6366f1)" }} />

          <div className="flex items-center justify-between mb-2 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}>
                <Brain size={13} color="#818cf8" />
              </div>
              <div>
                <div className="text-sm font-bold text-indigo-200">Why This Prediction?</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Feature contributions driving the risk score</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-600 px-2.5 py-1 rounded-md"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              Top {data.explanation?.length} factors
            </div>
          </div>

          <div className="flex gap-4 mb-5 mt-3">
            {[["#ef4444","Increases risk"],["#10b981","Reduces risk"]].map(([c,l]) => (
              <div key={l} className="flex items-center gap-1.5">
                <div className="w-6 h-1 rounded-full" style={{ background: c }} />
                <span className="text-[10px] text-slate-500">{l}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-5">
            {(data.explanation || []).map((e, i) => {
              const isPos = e.impact > 0;
              const max   = Math.max(...(data.explanation||[]).map(x=>Math.abs(x.impact)),0.001);
              const barW  = (Math.abs(e.impact)/max)*46;
              const rc    = i===0?"#818cf8":i===1?"rgba(129,140,248,0.6)":"rgba(148,163,184,0.3)";
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-[5px] flex-shrink-0 flex items-center justify-center text-[9px] font-black"
                        style={{ background: i===0?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.04)", border: `1px solid ${rc}`, color: rc }}>
                        {i+1}
                      </div>
                      <span className="text-sm font-semibold text-slate-200 capitalize">{e.feature.replace(/_/g," ")}</span>
                      {e.imputed && <span className="text-[9px] text-slate-600 px-1.5 py-0.5 rounded" style={{border:"1px solid rgba(255,255,255,0.08)"}}>estimated</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.value!=null && <span className="text-xs text-slate-500 px-2 py-0.5 rounded font-mono" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)"}}>{Number(e.value).toFixed(1)}</span>}
                      <div className="flex items-center gap-1">
                        {isPos?<TrendingUp size={11} color="#f87171"/>:<TrendingDown size={11} color="#34d399"/>}
                        <span className="text-xs font-bold font-mono" style={{color:isPos?"#f87171":"#34d399"}}>{isPos?"+":""}{e.impact.toFixed(3)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="relative h-2 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.05)"}}>
                    <div className="absolute top-0 h-full rounded-full transition-all duration-700"
                      style={{ background:isPos?"linear-gradient(90deg,#ef444433,#ef4444)":"linear-gradient(270deg,#10b98133,#10b981)", width:`${barW}%`, left:isPos?"50%":`${50-barW}%` }} />
                    <div className="absolute top-0 bottom-0 w-px" style={{left:"50%",background:"rgba(255,255,255,0.15)"}} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 px-3.5 py-2.5 rounded-xl text-[11px] text-slate-500 italic leading-relaxed"
            style={{background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.15)"}}>
            Factor contributions are derived from the model's learned weights applied to this patient's scaled values.
          </div>
        </div>

        {/* Right column — Lab values + NEWS2 */}
        <div className="flex flex-col gap-3">
          <div style={card()}>
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mb-4">Lab Values</div>
            <div className="flex flex-col gap-2.5">
              {Object.entries(VITALS_META).map(([key,meta]) => {
                const val=cs[key], flags=data.reference_flags||{}, alert=flags[`${key}_high`]||flags[`${key}_low`];
                return (
                  <div key={key} className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                    style={{background:alert?"rgba(239,68,68,0.07)":"rgba(255,255,255,0.03)",border:alert?"1px solid rgba(239,68,68,0.22)":"1px solid rgba(255,255,255,0.07)"}}>
                    <div className="flex items-center gap-2">
                      {alert&&<AlertTriangle size={11} color="#f87171" className="flex-shrink-0"/>}
                      <span className="text-xs font-medium" style={{color:alert?"#fca5a5":"rgba(148,163,184,0.65)"}}>{meta.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold" style={{color:alert?"#fca5a5":"#e2e8f0"}}>{fmt1(val)}</span>
                      <span className="text-[10px] text-slate-600 ml-1">{meta.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Fairness context */}
      

      <div className="flex items-center justify-center gap-2 pt-2 pb-1 text-slate-700 text-[11px]">
        <ShieldCheck size={10} />
        BiasGuard — Fairness-Aware Federated ICU Deterioration Early Warning · Research Prototype
      </div>
    </div>
  );
}

function InfoCell({ icon, label, value }) {
  return (
    <div className="rounded-xl p-2.5" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-1 mb-1.5 text-slate-600">
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-sm font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function card() {
  return { background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:"20px 22px" };
}