"use client";

import { useState } from "react";
import { onboardHospital, resetFederation } from "../lib/api";

// ─────────────────────────────────────────────────────────────
// OnboardHospital — Multi-step hospital admission workflow
//
// Step 1: Upload CSV → preview bias summary locally
// Step 2: Show pre-admission bias report → user reviews
// Step 3: User approves → sends to federation training
// ─────────────────────────────────────────────────────────────

const STEPS = ["upload", "review", "onboarding", "done"];

export default function OnboardHospital({ refreshDashboard }) {
  const [step,      setStep]      = useState("upload");
  const [file,      setFile]      = useState(null);
  const [preview,   setPreview]   = useState(null);   // local CSV stats
  const [result,    setResult]    = useState(null);   // server response
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState(null);
  const [open,      setOpen]      = useState(false);

  // ── Step 1: Parse CSV locally for preview ─────────────────
  const parseCSVPreview = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const lines  = e.target.result.split("\n").filter(Boolean);
          const header = lines[0].split(",").map(s => s.trim().replace(/"/g, ""));
          const rows   = lines.slice(1).map(l =>
            l.split(",").reduce((acc, v, i) => {
              acc[header[i]] = v.trim().replace(/"/g, "");
              return acc;
            }, {})
          ).filter(r => Object.keys(r).length > 3);

          const total      = rows.length;
          const seniors    = rows.filter(r => r.is_senior === "1" || r.is_senior === "1.0").length;
          const nonSeniors = rows.filter(r => r.is_senior === "0" || r.is_senior === "0.0").length;
          const mortality  = rows.filter(r => r.mortality === "1").length;

          // Estimate bias risk from senior skew
          const seniorRatio = seniors / total;
          const biasRisk =
            seniorRatio > 0.75 || seniorRatio < 0.25 ? "High"    :
            seniorRatio > 0.65 || seniorRatio < 0.35 ? "Moderate": "Low";

          const biasColor =
            biasRisk === "High"     ? "text-red-400"    :
            biasRisk === "Moderate" ? "text-yellow-400" : "text-emerald-400";

          resolve({
            total, seniors, nonSeniors,
            seniorRatio: (seniorRatio * 100).toFixed(1),
            mortality,
            mortalityRate: ((mortality / total) * 100).toFixed(1),
            biasRisk, biasColor,
            features: header.filter(h =>
              ["mean_heartrate","mean_sao2","mean_bp","glucose","creatinine","BUN","WBC x 1000"].includes(h)
            ).length,
          });
        } catch {
          resolve(null);
        }
      };
      reader.readAsText(file);
    });
  };

  const handleFileChange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError(null);
    const stats = await parseCSVPreview(f);
    setPreview(stats);
    setStep("review");
  };

  // ── Step 3: Approve → send to server ──────────────────────
  const handleApprove = async () => {
    setStep("onboarding");
    setUploading(true);
    setError(null);
    try {
      const res = await onboardHospital(file);
      setResult(res);
      if (res.status === "approved") {
        setStep("done");
        refreshDashboard(res.federation_update);
      } else {
        setError(`Rejected: ${res.reason}`);
        setStep("review");
      }
    } catch {
      setError("Onboarding failed — check server connection");
      setStep("review");
    }
    setUploading(false);
  };

  const handleReset = async () => {
    await resetFederation();
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    refreshDashboard();
  };

  const handleRestart = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="relative">
      {/* ── Trigger button ──────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-200 ${
          open
            ? "bg-cyan-600/20 border-cyan-500/50 text-cyan-300"
            : "bg-slate-800/80 border-slate-700/60 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        Onboard Hospital
        {step === "done" && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
      </button>

      {/* ── Dropdown panel ──────────────────────────────────── */}
      {open && (
        <div className="absolute right-0 top-12 w-[420px] bg-slate-900/95 backdrop-blur-xl border border-slate-700/70 rounded-2xl shadow-2xl z-50 overflow-hidden">

          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/60 bg-slate-950/40">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Hospital Admission Workflow</h3>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                {step === "upload"    && "Step 1 of 3 — Upload hospital dataset"}
                {step === "review"   && "Step 2 of 3 — Review pre-admission bias report"}
                {step === "onboarding"&& "Step 3 of 3 — Federating with network..."}
                {step === "done"     && "Onboarding complete"}
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
          </div>

          {/* Step progress */}
          <div className="flex px-5 py-3 gap-1.5 border-b border-slate-800/40">
            {["Upload", "Review", "Federate"].map((s, i) => {
              const stepIdx = step === "upload" ? 0 : step === "review" ? 1 : 2;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full h-1 rounded-full ${
                    i < stepIdx  ? "bg-emerald-500" :
                    i === stepIdx? "bg-cyan-500"    : "bg-slate-700"
                  }`} />
                  <span className={`text-[9px] font-mono ${
                    i === stepIdx ? "text-cyan-400" : i < stepIdx ? "text-emerald-400" : "text-slate-600"
                  }`}>{s}</span>
                </div>
              );
            })}
          </div>

          <div className="p-5">

            {/* ── STEP 1: Upload ──────────────────────────── */}
            {step === "upload" && (
              <div>
                <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                  Upload a hospital CSV file. BiasGuard will analyse the dataset
                  for demographic composition and bias risk before admission to the federation.
                </p>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-cyan-500/60 hover:bg-cyan-500/5 transition-all group">
                  <svg className="w-8 h-8 text-slate-600 group-hover:text-cyan-500 mb-2 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-xs text-slate-500 group-hover:text-cyan-400">Click to upload hospital CSV</span>
                  <span className="text-[10px] text-slate-600 mt-1">Must include is_senior, mortality columns</span>
                  <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                </label>
              </div>
            )}

            {/* ── STEP 2: Review ──────────────────────────── */}
            {step === "review" && preview && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-300 font-semibold">
                    {file?.name}
                  </p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    preview.biasRisk === "High"     ? "bg-red-950/50 border-red-800 text-red-300"      :
                    preview.biasRisk === "Moderate" ? "bg-yellow-950/50 border-yellow-800 text-yellow-300":
                                                      "bg-emerald-950/50 border-emerald-800 text-emerald-300"
                  }`}>
                    {preview.biasRisk} Bias Risk
                  </span>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Total Patients",    value: preview.total,                color: "text-slate-200" },
                    { label: "Senior Patients",   value: `${preview.seniors} (${preview.seniorRatio}%)`, color: "text-cyan-400"    },
                    { label: "Non-Senior",        value: preview.nonSeniors,           color: "text-blue-400"  },
                    { label: "Mortality Rate",    value: `${preview.mortalityRate}%`,  color: "text-red-400"   },
                    { label: "Model Features",    value: `${preview.features} / 7`,    color: "text-emerald-400"},
                    { label: "Senior Ratio",      value: `${preview.seniorRatio}%`,    color: preview.biasColor},
                  ].map((s, i) => (
                    <div key={i} className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/40">
                      <p className="text-[9px] text-slate-500 font-mono uppercase">{s.label}</p>
                      <p className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Bias warning */}
                <div className={`rounded-xl px-4 py-3 border text-xs leading-relaxed ${
                  preview.biasRisk === "High"
                    ? "bg-red-950/30 border-red-800/50 text-red-300"
                    : preview.biasRisk === "Moderate"
                    ? "bg-yellow-950/30 border-yellow-800/50 text-yellow-300"
                    : "bg-emerald-950/30 border-emerald-800/50 text-emerald-300"
                }`}>
                  {preview.biasRisk === "High" && (
                    <><span className="font-bold">⚠ High demographic skew detected.</span> Senior ratio {preview.seniorRatio}% deviates significantly from 50%. BiasGuard's inverse penalty weighting will reduce this hospital's aggregation influence proportionally.</>
                  )}
                  {preview.biasRisk === "Moderate" && (
                    <><span className="font-bold">⚡ Moderate demographic skew.</span> Senior ratio {preview.seniorRatio}%. BiasGuard will apply fairness regularisation during local training and penalise aggregation weight if DP exceeds threshold.</>
                  )}
                  {preview.biasRisk === "Low" && (
                    <><span className="font-bold">✓ Balanced demographic distribution.</span> Senior ratio {preview.seniorRatio}%. This hospital is expected to receive near-full aggregation weight in the federation.</>
                  )}
                </div>

                {error && (
                  <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleRestart}
                    className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all"
                  >
                    ← Change file
                  </button>
                  <button
                    onClick={handleApprove}
                    className="flex-1 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white border border-cyan-500/50 hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all"
                  >
                    Approve &amp; Federate →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Onboarding in progress ──────────── */}
            {step === "onboarding" && (
              <div className="flex flex-col items-center py-6 gap-4">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-cyan-400 animate-spin" />
                  <div className="absolute inset-2 rounded-full border border-blue-500/20 animate-ping" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-200">Federating hospital...</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-1">
                    Running 20 additional rounds with new node
                  </p>
                </div>
                <div className="w-full space-y-1.5 text-[10px] font-mono text-slate-500">
                  {["Validating dataset schema", "Computing local model weights", "Running bias-aware aggregation", "Updating global federation model"].map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-cyan-500 animate-pulse">▸</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 4: Done ────────────────────────────── */}
            {step === "done" && result && (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-4 gap-3">
                  <div className="w-14 h-14 rounded-full bg-emerald-950/50 border border-emerald-500/40 flex items-center justify-center">
                    <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-emerald-300">Hospital {result.hospital?.id} Onboarded</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">Successfully federated with network</p>
                  </div>
                </div>

                {result.federation_update && (
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    {[
                      { label: "Final AUC",  value: result.federation_update.bias_aware?.round_history?.slice(-1)?.[0]?.avg_auc?.toFixed(3) },
                      { label: "Final DP",   value: result.federation_update.bias_aware?.round_history?.slice(-1)?.[0]?.avg_dp?.toFixed(3)  },
                      { label: "Total rounds", value: result.federation_update.bias_aware?.round_history?.length },
                      { label: "Active nodes", value: result.federation_update.active_hospitals },
                    ].map((s, i) => s.value && (
                      <div key={i} className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/40">
                        <p className="text-[9px] text-slate-500 uppercase">{s.label}</p>
                        <p className="text-sm font-bold text-slate-200">{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleRestart}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 transition-all"
                >
                  Onboard another hospital
                </button>
              </div>
            )}

          </div>

          {/* Reset federation footer */}
          <div className="px-5 pb-4 border-t border-slate-800/40 pt-3">
            <button
              onClick={handleReset}
              className="w-full text-[10px] font-mono text-slate-600 hover:text-red-400 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset federation to 5 core hospitals
            </button>
          </div>
        </div>
      )}
    </div>
  );
}