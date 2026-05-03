"use client";

import { useState, useEffect } from "react";
import { startFederation } from "../lib/api";
import { useRouter } from "next/navigation";
import { Bed } from "lucide-react";

import MetricCard from "../components/MetricCard";
import TrainingChart from "../components/TrainingChart";
import HospitalTable from "../components/HospitalTable";
import OnboardHospital from "../components/OnboardHospital";
import BiasDetectionFeed from "../components/BiasDetectionFeed";
import MortalityFairnessPanel from "../components/MortalityFairnessPanel";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("bias");
  const [visibleRounds, setVisibleRounds] = useState([]);
  const [visibleBaselineRounds, setVisibleBaselineRounds] = useState([]); // ← NEW
  const [currentRound, setCurrentRound] = useState(0);
  const router = useRouter();

  // -----------------------------------------
  // Restore state when navigating back from /clinician
  // -----------------------------------------
  useEffect(() => {
    const cameFromClinician = sessionStorage.getItem("navigating_to_clinician");

    if (cameFromClinician) {
      sessionStorage.removeItem("navigating_to_clinician");

      const saved = sessionStorage.getItem("biasguard_state");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setData(parsed);
          setVisibleRounds(parsed.bias_aware?.round_history || []);
          setVisibleBaselineRounds(parsed.baseline?.round_history || []); // ← NEW
          setCurrentRound(parsed.bias_aware?.round_history?.length || 0);
        } catch {
          sessionStorage.removeItem("biasguard_state");
        }
      }
    } else {
      sessionStorage.removeItem("biasguard_state");
    }
  }, []);

  // -----------------------------------------
  // Start Federation
  // -----------------------------------------
  const handleStart = async () => {
    sessionStorage.removeItem("biasguard_state");

    setData(null);
    setVisibleRounds([]);
    setVisibleBaselineRounds([]); // ← NEW
    setCurrentRound(0);
    setMode("bias");
    setLoading(true);

    try {
      const result = await startFederation();

      sessionStorage.setItem("biasguard_state", JSON.stringify(result));
      setData(result);

      const rounds = result.bias_aware.round_history;
      const baselineRounds = result.baseline.round_history; // ← NEW
      let i = 0;

      const interval = setInterval(() => {
        setVisibleRounds((prev) => [...prev, rounds[i]]);
        // Animate baseline in lockstep — if baseline has fewer rounds
        // than BiasGuard (shouldn't happen with lockstep server) fall
        // back to the last known baseline value
        setVisibleBaselineRounds((prev) => [
          // ← NEW
          ...prev,
          baselineRounds[i] ?? baselineRounds[baselineRounds.length - 1],
        ]);
        setCurrentRound(i + 1);
        i++;

        if (i >= rounds.length) {
          clearInterval(interval);
          setLoading(false);
        }
      }, 800);
    } catch (err) {
      console.error("Federation failed:", err);
      sessionStorage.removeItem("biasguard_state");
      setData(null);
      setLoading(false);
    }
  };

  // -----------------------------------------
  // Refresh after onboarding — animate new rounds in lockstep
  // -----------------------------------------
  const refreshDashboard = (update) => {
    if (!update) return;

    setData((prev) => {
      const updated = {
        ...prev,
        bias_aware: {
          ...prev.bias_aware,
          round_history: update.round_history,
          hospital_metrics: update.hospital_metrics,
          first_round_hospital_metrics: update.first_round_hospital_metrics,
        },
        // Update baseline with post-onboard rounds
        baseline: {
          ...prev.baseline,
          round_history:
            update.baseline_round_history ?? prev.baseline?.round_history,
        },
        active_hospitals: update.active_hospitals,
      };

      sessionStorage.setItem("biasguard_state", JSON.stringify(updated));
      return updated;
    });

    // Only animate the NEW rounds (slice from current position)
    const oldLength = visibleRounds.length;
    const newRounds = update.round_history.slice(oldLength);
    const newBaselineRounds = (update.baseline_round_history ?? []).slice(
      oldLength,
    ); // ← NEW

    let i = 0;

    const interval = setInterval(() => {
      setVisibleRounds((prev) => [...prev, newRounds[i]]);
      setVisibleBaselineRounds((prev) => [
        // ← NEW
        ...prev,
        newBaselineRounds[i] ?? newBaselineRounds[newBaselineRounds.length - 1],
      ]);
      setCurrentRound(oldLength + i + 1);
      i++;

      if (i >= newRounds.length) {
        clearInterval(interval);
      }
    }, 800);
  };

  // ==========================================
  // LANDING PAGE
  // ==========================================
  if (!data) {
    return (
      <div className="min-h-screen bg-[#070c18] flex items-center justify-center p-6 relative overflow-hidden">
        {/* Background glows */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/8 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-cyan-600/6 rounded-full blur-[100px]" />
          <div className="absolute top-1/4 left-1/4 w-[200px] h-[200px] bg-blue-600/5 rounded-full blur-[80px]" />
        </div>

        {/* Subtle grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative z-10 w-full max-w-2xl">
          {/* Brand lockup */}
          <div className="text-center mb-12">
            {/* Icon */}
            

            {/* Title */}
            <h1
              className="text-5xl font-bold text-white tracking-tight mb-3"
              style={{ letterSpacing: "-0.03em" }}
            >
              BiasGuard
            </h1>

            <p className="text-lg text-slate-400 font-light mb-2">
              Federated ICU Bias Monitoring System
            </p>

            <p className="text-xs text-indigo-400/70 font-mono tracking-widest uppercase">
             Privacy Preserved Bias-Aware Federated Learning Framework
            </p>
          </div>

          {/* Info cards row */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              {
                icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
                label: "Multi Hospital",
                sub: "5 Core federation nodes",
              },
              {
                icon: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
                label: "Bias-Aware",
                sub: "Bias Detection and Correction",
              },
              {
                icon: "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z",
                label: "DP Enabled",
                sub: "Differential Privacy Enabled",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl px-4 py-3.5 text-center"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex justify-center mb-2">
                  <svg
                    className="w-4 h-4 text-indigo-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                      d={item.icon}
                    />
                  </svg>
                </div>
                <div className="text-sm font-semibold text-slate-200">
                  {item.label}
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {item.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Main card */}
          <div
            className="rounded-2xl p-6 mb-5"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="flex items-start gap-3 mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0 animate-pulse" />
              <div>
                <p className="text-sm font-semibold text-slate-200 mb-1">
                  Ready to initialise
                </p>
                <p className="text-xs text-slate-500 leading-relaxed font-mono">
                  Launching federation trains both Standard FedAvg and BiasGuard
                  in parallel
                </p>
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={loading}
              className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
              style={{
                background: loading
                  ? "rgba(99,102,241,0.4)"
                  : "linear-gradient(135deg, #6366f1, #4f46e5)",
                border: "1px solid rgba(129,140,248,0.4)",
                boxShadow: loading ? "none" : "0 0 28px rgba(99,102,241,0.25)",
              }}
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin w-4 h-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Establishing secure connections…
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Initialise Secure Federation
                </>
              )}
            </button>
          </div>

          {/* Footer note */}
          <p className="text-center text-[11px] text-slate-600 font-mono">
            BiasGuard · W1953792 
          </p>
        </div>
      </div>
    );
  }

  // ==========================================
  // DASHBOARD MATH & STATE
  // ==========================================
  const selected = mode === "baseline" ? data.baseline : data.bias_aware;
  const currentIndex = visibleRounds.length > 0 ? visibleRounds.length - 1 : 0;

  const baselineHistory = data?.baseline?.round_history || [];
  const biasHistory = data?.bias_aware?.round_history || [];

  const baselineFinal = baselineHistory[baselineHistory.length - 1] || {
    avg_dp: 0,
    avg_eo: 0,
  };

  const biasAwareCurrent = biasHistory[currentIndex] ||
    biasHistory[biasHistory.length - 1] || { avg_dp: 0, avg_eo: 0 };
  const biasAwarePrevious =
    currentIndex > 0
      ? biasHistory[currentIndex - 1] || biasAwareCurrent
      : biasAwareCurrent;

  const currentDpMitigated = baselineFinal.avg_dp - biasAwareCurrent.avg_dp;
  const prevDpMitigated = baselineFinal.avg_dp - biasAwarePrevious.avg_dp;
  const dpRoundDelta = currentDpMitigated - prevDpMitigated;

  const currentEoMitigated = baselineFinal.avg_eo - biasAwareCurrent.avg_eo;
  const prevEoMitigated = baselineFinal.avg_eo - biasAwarePrevious.avg_eo;
  const eoRoundDelta = currentEoMitigated - prevEoMitigated;

  const biasReductionPercent =
    baselineFinal.avg_dp > 0
      ? (currentDpMitigated / baselineFinal.avg_dp) * 100
      : 0;
  const biasStatus =
    currentDpMitigated >= 0
      ? `Bias Reduced by ${biasReductionPercent.toFixed(1)}%`
      : "Bias Increasing ⚠";
  const biasStatusColor =
    currentDpMitigated >= 0 ? "text-emerald-400" : "text-red-400";

  const totalRounds = selected.round_history.length;
  const progressPercent = (currentRound / totalRounds) * 100;

  const currentRoundData = mode === "bias" ? biasAwareCurrent : baselineFinal;

  const privacy = data.privacy || {
    enabled: false,
    noise_scale: 0,
    clip_value: 0,
  };

  // Safe baseline values for MetricCards
  const baseF =
    baselineHistory.length > 0
      ? baselineHistory[baselineHistory.length - 1]
      : null;
  const baseAUC =
    baseF?.avg_auc != null ? Number(baseF.avg_auc).toFixed(3) : null;
  const baseDP = baseF?.avg_dp != null ? Number(baseF.avg_dp).toFixed(3) : null;
  const baseEO = baseF?.avg_eo != null ? Number(baseF.avg_eo).toFixed(3) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-6 md:p-8 selection:bg-cyan-500/30">
      <div className="max-w-7xl mx-auto">
        {/* ── Navbar ───────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8 pb-5 border-b border-slate-800/50">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent tracking-tight">
                BiasGuard
              </h1>
              <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">
                Federated ICU Bias Framework
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-full border border-slate-700/50">
              <span className="relative flex h-2 w-2">
                {loading && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${loading ? "bg-emerald-500" : "bg-slate-600"}`}
                />
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {loading ? "FEDERATING" : "COMPLETE"}
              </span>
            </div>

            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-2 bg-orange-800 hover:bg-slate-700/80 text-slate-300 hover:text-white px-4 py-2 rounded-xl text-xs font-semibold border border-slate-700/60 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {loading ? "Training..." : "Restart"}
            </button>

            <button
              onClick={() => {
                sessionStorage.setItem("navigating_to_clinician", "true");
                router.push("/wardview");
              }}
              className="flex items-center gap-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 hover:text-cyan-200 px-4 py-2 rounded-xl text-xs font-semibold border border-cyan-500/40 hover:border-cyan-400/60 transition-all"
            >
              <Bed className="w-3.5 h-3.5" />
              Ward View
            </button>
          </div>
        </div>

        {/* ── Mode toggle + Onboard ────────────────────────── */}
        <div className="flex items-center gap-3 mb-6 justify-between">
          <div className="flex gap-1 bg-slate-900/70 p-1 rounded-xl border border-slate-800/60 backdrop-blur-sm">
            <button
              onClick={() => setMode("baseline")}
              disabled={loading}
              className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all duration-300 ${
                mode === "baseline"
                  ? "bg-slate-700 text-white shadow border border-slate-600"
                  : "text-slate-400 hover:text-slate-200"
              } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Standard FedAvg
            </button>
            <button
              onClick={() => setMode("bias")}
              disabled={loading}
              className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all duration-300 ${
                mode === "bias"
                  ? "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.25)] border border-cyan-500/50"
                  : "text-slate-400 hover:text-slate-200"
              } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              BiasGuard
            </button>
          </div>

          <OnboardHospital refreshDashboard={refreshDashboard} />
        </div>

        {/* ── Metric Cards ─────────────────────────────────── */}
        {(() => {
          const bgR1 = data?.bias_aware?.round_history?.[0];
          const baseR1 = data?.baseline?.round_history?.[0];

          const initAUC =
            mode === "bias"
              ? bgR1?.avg_auc?.toFixed(3)
              : baseR1?.avg_auc?.toFixed(3);
          const initDP =
            mode === "bias"
              ? bgR1?.avg_dp?.toFixed(3)
              : baseR1?.avg_dp?.toFixed(3);
          const initEO =
            mode === "bias"
              ? bgR1?.avg_eo?.toFixed(3)
              : baseR1?.avg_eo?.toFixed(3);

          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <MetricCard
                title="Global AUC"
                value={currentRoundData.avg_auc.toFixed(3)}
                subtitle="Predictive Utility"
                type="auc"
                initialValue={initAUC}
                baselineValue={mode === "bias" ? baseAUC : null}
                dark
              />
              <MetricCard
                title="DP Gap"
                value={currentRoundData.avg_dp.toFixed(3)}
                subtitle="Demographic Parity"
                type="dp"
                initialValue={initDP}
                baselineValue={mode === "bias" ? baseDP : null}
                dark
              />
              <MetricCard
                title="EO Gap"
                value={currentRoundData.avg_eo.toFixed(3)}
                subtitle="Equal Opportunity"
                type="eo"
                initialValue={initEO}
                baselineValue={mode === "bias" ? baseEO : null}
                dark
              />
              <MetricCard
                title="Active Nodes"
                value={data.active_hospitals}
                subtitle="Hospital Participants"
                type="nodes"
                dark
              />
            </div>
          );
        })()}

        {/* ── Training Chart ───────────────────────────────── */}
        <TrainingChart
          data={
            mode === "bias"
              ? visibleRounds.length > 0
                ? visibleRounds
                : data.bias_aware.round_history
              : data.baseline.round_history
          }
          baselineData={
            // KEY FIX: use visibleBaselineRounds so the dashed line
            // animates round-by-round in lockstep with BiasGuard,
            // both during initial training and after onboarding.
            // Falls back to full history only when no animation active.
            mode === "bias"
              ? visibleBaselineRounds.length > 0
                ? visibleBaselineRounds
                : data.baseline?.round_history || []
              : []
          }
          currentRound={currentRound}
          totalRounds={totalRounds}
          loading={loading}
          progressPercent={progressPercent}
          mode={mode}
        />

        {/* ── Bias Detection Feed ──────────────────────────── */}
        {mode === "bias" && (
          <div className="mt-6">
            <BiasDetectionFeed
              roundHistory={
                visibleRounds.length > 0
                  ? visibleRounds
                  : data.bias_aware.round_history
              }
              hospitalMetrics={data.bias_aware.hospital_metrics}
              baselineHistory={
                visibleBaselineRounds.length > 0
                  ? visibleBaselineRounds
                  : data.baseline?.round_history || []
              }
              loading={loading}
              mode={mode}
            />
          </div>
        )}

        {/* ── Mortality Fairness Panel ────────────────────────── */}
        {mode === "bias" && !loading && data && (
          <MortalityFairnessPanel
            baselineLastRound={data.baseline.round_history.at(-1)}
            biasAwareLastRound={data.bias_aware.round_history.at(-1)}
            baselineHospitals={data.baseline.hospital_metrics}
            biasAwareHospitals={data.bias_aware.hospital_metrics}
            visible={mode === "bias" && !loading && !!data}
          />
        )}

        {/* ── Hospital Table ───────────────────────────────── */}
        {mode === "bias" && !loading && (
          <div className="mt-6 bg-slate-900/70 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-slate-800/70">
            <HospitalTable
              hospitals={selected.hospital_metrics}
              firstRoundHospitals={
                data.bias_aware?.first_round_hospital_metrics || []
              }
              mode={mode}
            />
          </div>
        )}
      </div>
    </div>
  );
}
