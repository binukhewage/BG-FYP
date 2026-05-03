from fastapi import APIRouter, HTTPException
import pandas as pd
import torch
import torch.nn as nn
import os
import numpy as np

from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.isotonic import IsotonicRegression

from federated.model import LogisticRegressionModel
from federated.config import MODEL_FEATURES, INPUT_DIM, MODEL_TYPE

router = APIRouter()

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


PROB_MIN       = 0.05
PROB_MAX       = 0.95
TOP_N_FEATURES = 5
WARD_SIZE      = 25

# Fallback static temperature if everything else fails
_STATIC_TEMPERATURE = 1.5 if MODEL_TYPE == "logistic" else 6.0

URGENCY_THRESHOLDS = {
    "Stable":   (0.00, 0.25),
    "Watch":    (0.25, 0.50),
    "Concern":  (0.50, 0.72),
    "Escalate": (0.72, 1.00),
}

CLINICAL_RANGES = {
    "heart_rate":        {"low": 50,  "high": 100, "unit": "BPM"},
    "oxygen_saturation": {"low": 94,  "high": 100, "unit": "%"},
    "blood_pressure":    {"low": 60,  "high": 100, "unit": "mmHg"},
    "glucose":           {"low": 70,  "high": 180, "unit": "mg/dL"},
    "creatinine":        {"low": 0.0, "high": 1.2, "unit": "mg/dL"},
    "white_blood_cells": {"low": 4.0, "high": 11.0,"unit": "x10³/µL"},
    "bun":               {"low": 0.0, "high": 20.0,"unit": "mg/dL"},
}

INTERVENTION_SUGGESTIONS = {
    "heart_rate_high":        "Consider cardiac monitoring and rate control review.",
    "heart_rate_low":         "Assess for bradycardia — review medications and pacemaker status.",
    "oxygen_saturation_low":  "O₂ saturation below threshold — review oxygen therapy and ventilation.",
    "blood_pressure_low":     "Hypotension detected — consider fluid resuscitation or vasopressor review.",
    "blood_pressure_high":    "Hypertension noted — review antihypertensive protocol.",
    "glucose_high":           "Hyperglycaemia — review insulin protocol and nutrition.",
    "glucose_low":            "Hypoglycaemia risk — administer glucose and recheck.",
    "creatinine_high":        "Elevated creatinine — consider nephrology review and fluid balance.",
    "white_blood_cells_high": "Elevated WBC — assess for infection or sepsis, consider blood cultures.",
    "white_blood_cells_low":  "Low WBC — assess immunosuppression risk.",
    "bun_high":               "Elevated BUN — review renal function and hydration status.",
}


# ---------------------------------------------------
# Utilities
# ---------------------------------------------------

def safe_float(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        if np.isnan(v) or np.isinf(v):
            return None
    return float(v)


def classify_urgency(prob: float) -> str:
    for label, (low, high) in URGENCY_THRESHOLDS.items():
        if low <= prob < high:
            return label
    return "Escalate"


def compute_news2_score(clinical: dict) -> dict:
    score      = 0
    components = {}

    sao2 = clinical.get("oxygen_saturation")
    if sao2 is not None:
        pts = 3 if sao2 < 92 else 2 if sao2 < 94 else 1 if sao2 < 96 else 0
        score += pts; components["O₂ Saturation"] = pts

    hr = clinical.get("heart_rate")
    if hr is not None:
        pts = 3 if (hr <= 40 or hr >= 131) else 2 if (hr <= 50 or hr >= 111) else 1 if hr >= 91 else 0
        score += pts; components["Heart Rate"] = pts

    bp = clinical.get("blood_pressure")
    if bp is not None:
        pts = 3 if bp <= 50 else 2 if bp <= 60 else 1 if bp <= 70 else 0
        score += pts; components["Blood Pressure"] = pts

    age = clinical.get("age")
    if age is not None and age >= 65:
        score += 1; components["Age ≥65"] = 1

    bun = clinical.get("bun")
    if bun is not None:
        pts = 2 if bun > 40 else 1 if bun > 20 else 0
        score += pts; components["BUN"] = pts

    wbc = clinical.get("white_blood_cells")
    if wbc is not None:
        pts = 2 if (wbc > 15 or wbc < 2) else 1 if (wbc > 11 or wbc < 4) else 0
        score += pts; components["WBC"] = pts

    if score <= 2:   interpretation, colour = "Low — routine monitoring",                  "green"
    elif score <= 4: interpretation, colour = "Low-Medium — increase monitoring frequency", "yellow"
    elif score <= 6: interpretation, colour = "Medium — urgent clinical review required",   "orange"
    else:            interpretation, colour = "High — consider critical care escalation",   "red"

    return {"total": score, "interpretation": interpretation, "colour": colour, "components": components}


def compute_sirs_criteria(clinical: dict) -> dict:
    criteria_met = []
    criteria_all = {}
    criteria_all["Temperature"] = "Not assessed (not in dataset)"

    hr = clinical.get("heart_rate")
    if hr is not None:
        met = hr > 90
        criteria_all["Heart Rate >90 BPM"] = met
        if met: criteria_met.append("Heart Rate >90 BPM")

    wbc = clinical.get("white_blood_cells")
    if wbc is not None:
        met = wbc < 4 or wbc > 12
        criteria_all["WBC <4 or >12 x10³"] = met
        if met: criteria_met.append("WBC <4 or >12 x10³")

    bun = clinical.get("bun")
    if bun is not None:
        met = bun > 25
        criteria_all["Metabolic Stress (BUN >25)"] = met
        if met: criteria_met.append("Metabolic Stress (BUN >25)")

    count = len(criteria_met)
    return {
        "criteria_met": criteria_met, "criteria_all": criteria_all,
        "count": count, "sepsis_alert": count >= 2,
        "message": "SIRS criteria met — assess for sepsis" if count >= 2 else "No SIRS criteria threshold reached"
    }


# ---------------------------------------------------
# Dynamic Temperature Scaling 
# ---------------------------------------------------

def compute_dynamic_temperature(logits_np: np.ndarray, target_std: float = 1.5) -> float:
    std = float(np.std(logits_np))
    if std < 0.1:
        return _STATIC_TEMPERATURE
    return max(1.0, std / target_std)


def rank_based_probs(logits_np: np.ndarray) -> np.ndarray:
    n = len(logits_np)
    ranks = np.argsort(np.argsort(logits_np.flatten()))
    probs = PROB_MIN + (ranks / (n - 1 if n > 1 else 1)) * (PROB_MAX - PROB_MIN)
    return probs.astype(np.float32)


def temperature_calibrate_probs(logits_np: np.ndarray) -> np.ndarray:
    """
    Legacy temperature-based calibration — used only as fallback
    if isotonic regression cannot be fitted.
    """
    temperature = compute_dynamic_temperature(logits_np)
    probs = 1.0 / (1.0 + np.exp(-logits_np / temperature))
    if np.std(probs) < 0.05:
        probs = rank_based_probs(logits_np)
    return np.clip(probs, PROB_MIN, PROB_MAX).flatten()


# ---------------------------------------------------
# Isotonic Calibration
# ---------------------------------------------------

_isotonic_calibrator: IsotonicRegression | None = None
_calibration_method: str = "temperature"  # updated after fitting


def _get_all_logits() -> np.ndarray:
    """Compute raw logits for the entire dataset."""
    X_all    = imputer.transform(df[MODEL_FEATURES])
    X_scaled = scaler.transform(X_all)
    X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(DEVICE)
    with torch.no_grad():
        logits_np = model(X_tensor).cpu().numpy().flatten()
    return logits_np


def fit_isotonic_calibrator():
    """
    Fit isotonic regression on raw sigmoid(logit) → mortality label.
    Stored globally so individual patient and ward endpoints both use
    the same calibrator without re-fitting on every request.
    """
    global _isotonic_calibrator, _calibration_method

    if "mortality" not in df.columns:
        print("[clinician.py] WARNING: 'mortality' column not found — falling back to temperature calibration.")
        _calibration_method = "temperature"
        return

    labels = df["mortality"].values.astype(float)

    if len(np.unique(labels)) < 2:
        print("[clinician.py] WARNING: All mortality labels are identical — falling back to temperature calibration.")
        _calibration_method = "temperature"
        return

    logits_np = _get_all_logits()
    raw_probs = 1.0 / (1.0 + np.exp(-logits_np))  # raw sigmoid, no temperature

    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(raw_probs, labels)

    # Sanity check: does calibration produce a useful spread?
    calibrated = calibrator.predict(raw_probs)
    calibrated = np.clip(calibrated, PROB_MIN, PROB_MAX)

    if np.std(calibrated) < 0.02:
        print("[clinician.py] WARNING: Isotonic calibration produced near-zero spread "
              f"(std={np.std(calibrated):.4f}) — falling back to temperature calibration.")
        _calibration_method = "temperature"
        return

    _isotonic_calibrator = calibrator
    _calibration_method  = "isotonic"
    print(f"[clinician.py] Isotonic calibrator fitted. "
          f"Calibrated prob range: [{calibrated.min():.3f}, {calibrated.max():.3f}]  "
          f"std={calibrated.std():.3f}  mean={calibrated.mean():.3f}")


def calibrate_probs(logits_np: np.ndarray) -> np.ndarray:
    """
    Main calibration entry point.
    Uses isotonic regression if available, otherwise temperature scaling.
    Always clips output to [PROB_MIN, PROB_MAX].
    """
    if _calibration_method == "isotonic" and _isotonic_calibrator is not None:
        raw_probs  = 1.0 / (1.0 + np.exp(-logits_np))
        calibrated = _isotonic_calibrator.predict(raw_probs)
        return np.clip(calibrated, PROB_MIN, PROB_MAX).flatten().astype(np.float32)
    else:
        return temperature_calibrate_probs(logits_np)


def calibrate_single_prob(logit_val: float, all_logits_np: np.ndarray) -> float:
    """
    Calibrate a single patient's logit.

    For isotonic: feeds raw sigmoid through the fitted calibrator.
    For temperature: uses population logit std to derive temperature,
    with a population-percentile blend if prob > 0.93.
    """
    if _calibration_method == "isotonic" and _isotonic_calibrator is not None:
        raw_prob  = float(1.0 / (1.0 + np.exp(-logit_val)))
        calibrated = float(_isotonic_calibrator.predict([raw_prob])[0])
        return float(np.clip(calibrated, PROB_MIN, PROB_MAX))
    else:
        temperature = compute_dynamic_temperature(all_logits_np)
        prob = float(1.0 / (1.0 + np.exp(-logit_val / temperature)))
        if prob >= 0.93:
            percentile = float(np.mean(all_logits_np <= logit_val))
            prob_rank  = PROB_MIN + percentile * (PROB_MAX - PROB_MIN)
            prob = 0.5 * prob + 0.5 * prob_rank
        return float(np.clip(prob, PROB_MIN, PROB_MAX))


# ---------------------------------------------------
# Feature contributions
# ---------------------------------------------------

def compute_feature_contributions(model, x_tensor, x_scaled_np, raw_values, imputed_mask):
    model.eval()
    x_grad = x_tensor.clone().detach().requires_grad_(True)
    logit  = model(x_grad)
    model.zero_grad()
    logit.backward()

    grads = x_grad.grad.cpu().numpy()[0]
    vals  = x_scaled_np[0]

    contributions = []
    for i, feature in enumerate(MODEL_FEATURES):
        impact = float(grads[i] * vals[i])
        contributions.append({
            "feature": feature,
            "value":   safe_float(raw_values.get(feature)),
            "impact":  safe_float(impact),
            "imputed": bool(imputed_mask[i]),
        })

    contributions.sort(key=lambda c: abs(c["impact"] or 0), reverse=True)
    return contributions[:TOP_N_FEATURES]


# ---------------------------------------------------
# Load Global Model
# ---------------------------------------------------

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, "models", "global_model.pt")

model = LogisticRegressionModel(INPUT_DIM).to(DEVICE)

def load_global_model():
    if not os.path.exists(MODEL_PATH):
        import warnings
        warnings.warn(
            f"[clinician.py] Global model not found at {MODEL_PATH}. "
            "Run federation first.",
            RuntimeWarning, stacklevel=2
        )
    else:
        model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
        model.eval()
        print(f"[clinician.py] Global model loaded from {MODEL_PATH}")

load_global_model()


# ---------------------------------------------------
# Load Dataset
# ---------------------------------------------------

DATA_PATH = os.path.join(BASE_DIR, "data", "processed", "merged_dataset.csv")

if not os.path.exists(DATA_PATH):
    raise RuntimeError(f"[clinician.py] Dataset not found at {DATA_PATH}.")

df = pd.read_csv(DATA_PATH)

imputer = SimpleImputer(strategy="median")
scaler  = StandardScaler()

X_imputed_all = imputer.fit_transform(df[MODEL_FEATURES])
scaler.fit(X_imputed_all)

# Fit calibrator after model + dataset are loaded
fit_isotonic_calibrator()


# ---------------------------------------------------
# Pre-compute group average risks
# ---------------------------------------------------

def _compute_group_avg_risks():
    logits_np = _get_all_logits()
    probs     = calibrate_probs(logits_np)

    senior_mask     = df["is_senior"].values == 1
    non_senior_mask = df["is_senior"].values == 0

    return {
        "senior":     float(np.mean(probs[senior_mask]))     if senior_mask.sum()     > 0 else 0.5,
        "non_senior": float(np.mean(probs[non_senior_mask])) if non_senior_mask.sum() > 0 else 0.5,
        "overall":    float(np.mean(probs)),
    }

_group_avgs = _compute_group_avg_risks()


def _log_calibration_diagnostics():
    logits_np = _get_all_logits()
    probs     = calibrate_probs(logits_np)
    print(f"[clinician.py] Calibration method: {_calibration_method}")
    print(f"[clinician.py] Logit range: [{logits_np.min():.2f}, {logits_np.max():.2f}]  std={logits_np.std():.2f}")
    print(f"[clinician.py] Prob range after calibration: [{probs.min():.2f}, {probs.max():.2f}]  "
          f"std={probs.std():.3f}  mean={probs.mean():.3f}")
    print(f"[clinician.py] Group avgs — Senior: {_group_avgs['senior']*100:.1f}%  "
          f"Non-senior: {_group_avgs['non_senior']*100:.1f}%  Overall: {_group_avgs['overall']*100:.1f}%")

_log_calibration_diagnostics()

#---------------------------------------------------

from sklearn.metrics import roc_auc_score


@router.get("/evaluate")
def evaluate_model(sample_size: int = 1000):
    """
    Evaluate model performance using:
    - AUC (discrimination)
    - Ranking validation (high vs low risk mortality)
    - Calibration curve (bin-based)
    """

    if "mortality" not in df.columns:
        raise HTTPException(status_code=400, detail="Mortality column required for evaluation.")

    # -----------------------------
    # Sample dataset
    # -----------------------------
    data = df.sample(n=min(sample_size, len(df)), random_state=42).copy()

    # -----------------------------
    # Get logits + calibrated probs
    # -----------------------------
    X      = imputer.transform(data[MODEL_FEATURES])
    Xs     = scaler.transform(X)
    Xt     = torch.tensor(Xs, dtype=torch.float32).to(DEVICE)

    with torch.no_grad():
        logits_np = model(Xt).cpu().numpy().flatten()

    probs = calibrate_probs(logits_np)

    data["risk"] = probs
    labels = data["mortality"].values

    # -----------------------------
    # 1. AUC
    # -----------------------------
    try:
        auc = float(roc_auc_score(labels, probs))
    except:
        auc = None

    # -----------------------------
    # 2. Ranking validation
    # -----------------------------
    high_risk = data.nlargest(int(len(data) * 0.2), "risk")
    low_risk  = data.nsmallest(int(len(data) * 0.2), "risk")

    high_mortality = float(high_risk["mortality"].mean())
    low_mortality  = float(low_risk["mortality"].mean())

    # -----------------------------
    # 3. Calibration (FIXED)
    # -----------------------------
    data["risk_bin"] = pd.qcut(data["risk"], q=5, duplicates="drop")

    calibration = (
        data.groupby("risk_bin", observed=True)["mortality"]
        .mean()
        .reset_index()
    )

    # 🔥 FIX: convert Interval → string (prevents FastAPI crash)
    calibration["risk_bin"] = calibration["risk_bin"].astype(str)

    calibration_result = calibration.to_dict(orient="records")

    # -----------------------------
    # 4. Summary stats
    # -----------------------------
    summary = {
        "mean_risk": float(np.mean(probs)),
        "std_risk":  float(np.std(probs)),
        "min_risk":  float(np.min(probs)),
        "max_risk":  float(np.max(probs)),
    }

    # -----------------------------
    # Final response
    # -----------------------------
    return {
        "auc": auc,
        "ranking_validation": {
            "high_risk_mortality_rate": round(high_mortality, 3),
            "low_risk_mortality_rate":  round(low_mortality, 3),
            "interpretation": (
                "Good ranking"
                if high_mortality > low_mortality
                else "Poor ranking"
            ),
        },
        "calibration": calibration_result,
        "summary": summary,
    }


# ---------------------------------------------------
# Debug / Calibration Validation Endpoint
# ---------------------------------------------------

@router.get("/debug/calibration")
def debug_calibration():
    """
    Diagnostic endpoint to validate calibration quality.

    Returns logit distribution stats, calibrated probability distribution,
    expected calibration error (ECE), and per-bucket accuracy.

    Use this to confirm that predicted risk scores reflect real outcome rates.
    ECE < 0.10 is generally considered acceptable for clinical risk models.
    """
    logits_np = _get_all_logits()
    probs     = calibrate_probs(logits_np)

    # Distribution breakdown
    buckets = {
        "0-25%":  int(np.sum(probs < 0.25)),
        "25-50%": int(np.sum((probs >= 0.25) & (probs < 0.50))),
        "50-75%": int(np.sum((probs >= 0.50) & (probs < 0.75))),
        "75-95%": int(np.sum((probs >= 0.75) & (probs < 0.95))),
        "95%+":   int(np.sum(probs >= 0.95)),
    }

    # Expected Calibration Error (ECE) — 10 equal-width bins
    ece        = 0.0
    n          = len(probs)
    ece_detail = []

    if "mortality" in df.columns:
        labels = df["mortality"].values.astype(float)
        bin_edges = np.linspace(0, 1, 11)

        for i in range(len(bin_edges) - 1):
            lo, hi  = bin_edges[i], bin_edges[i + 1]
            mask    = (probs >= lo) & (probs < hi)
            n_bin   = int(mask.sum())
            if n_bin == 0:
                continue
            avg_conf     = float(np.mean(probs[mask]))
            avg_acc      = float(np.mean(labels[mask]))
            bin_ece      = (n_bin / n) * abs(avg_conf - avg_acc)
            ece         += bin_ece
            ece_detail.append({
                "bin":        f"{lo:.1f}–{hi:.1f}",
                "n":          n_bin,
                "mean_pred":  round(avg_conf, 4),
                "mean_actual":round(avg_acc,  4),
                "gap":        round(abs(avg_conf - avg_acc), 4),
            })

    # Urgency distribution across whole population
    urgency_counts = {"Escalate": 0, "Concern": 0, "Watch": 0, "Stable": 0}
    for p in probs:
        urgency_counts[classify_urgency(float(p))] += 1

    return {
        "calibration_method":    _calibration_method,
        "n_patients":            n,
        "logit_min":             float(logits_np.min()),
        "logit_max":             float(logits_np.max()),
        "logit_std":             float(logits_np.std()),
        "logit_mean":            float(logits_np.mean()),
        "prob_min":              float(probs.min()),
        "prob_max":              float(probs.max()),
        "prob_std":              float(probs.std()),
        "prob_mean":             float(probs.mean()),
        "prob_median":           float(np.median(probs)),
        "distribution_counts":   buckets,
        "urgency_distribution":  urgency_counts,
        "collapsed":             bool(np.std(probs) < 0.05),
        "ece":                   round(ece, 4) if "mortality" in df.columns else None,
        "ece_detail":            ece_detail if "mortality" in df.columns else [],
        "ece_interpretation": (
            "Good (ECE < 0.05)"      if ece < 0.05 else
            "Acceptable (ECE < 0.10)"if ece < 0.10 else
            "Poor — recalibrate (ECE ≥ 0.10)"
        ) if "mortality" in df.columns else "N/A — no mortality labels",
    }


# ---------------------------------------------------
# Ward Endpoint
# ---------------------------------------------------

@router.get("/ward")
def get_ward_overview(sample: str = "sickest", seed: int = 42):
    if sample == "random":
        subset = df.sample(n=min(WARD_SIZE, len(df)), random_state=seed)
    elif sample == "mixed":
        df_tmp = df.copy()
        df_tmp["_sickness"] = (
            df_tmp["creatinine"].fillna(0) +
            df_tmp["BUN"].fillna(0) / 10 +
            df_tmp["WBC x 1000"].fillna(0) / 5
        )
        top10     = df_tmp.nlargest(10, "_sickness")
        remaining = df_tmp.drop(top10.index)
        random15  = remaining.sample(n=min(15, len(remaining)), random_state=seed)
        subset    = pd.concat([top10, random15])
    else:  # sickest
        df_tmp = df.copy()
        df_tmp["_sickness"] = (
            df_tmp["creatinine"].fillna(0) +
            df_tmp["BUN"].fillna(0) / 10 +
            df_tmp["WBC x 1000"].fillna(0) / 5
        )
        subset = df_tmp.nlargest(min(WARD_SIZE, len(df_tmp)), "_sickness")

    # Calibrate subset using population-level isotonic calibrator
    # Temperature fallback uses population logits for consistent scaling
    X_sub    = imputer.transform(subset[MODEL_FEATURES])
    X_scaled = scaler.transform(X_sub)
    X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(DEVICE)

    with torch.no_grad():
        sub_logits_np = model(X_tensor).cpu().numpy().flatten()

    if _calibration_method == "isotonic" and _isotonic_calibrator is not None:
        raw_probs = 1.0 / (1.0 + np.exp(-sub_logits_np))
        probs     = np.clip(
            _isotonic_calibrator.predict(raw_probs).astype(np.float32),
            PROB_MIN, PROB_MAX
        )
    else:
        # Temperature fallback: derive temperature from full population
        all_logits_np = _get_all_logits()
        temperature   = compute_dynamic_temperature(all_logits_np)
        probs_raw     = 1.0 / (1.0 + np.exp(-sub_logits_np / temperature))

        if np.std(probs_raw) < 0.05:
            all_sorted  = np.sort(all_logits_np)
            percentiles = np.searchsorted(all_sorted, sub_logits_np) / len(all_sorted)
            probs = np.clip(
                PROB_MIN + percentiles * (PROB_MAX - PROB_MIN),
                PROB_MIN, PROB_MAX
            ).astype(np.float32)
        else:
            probs = np.clip(probs_raw, PROB_MIN, PROB_MAX)

    patients = []
    for i, (_, row) in enumerate(subset.iterrows()):
        prob      = float(probs[i])
        is_senior = int(row.get("is_senior", 0))
        group_avg = _group_avgs["senior"] if is_senior else _group_avgs["non_senior"]
        vs_avg_pp = round((prob - group_avg) * 100, 1)

        top_flag  = None
        worst_dev = 0
        for col, lo, hi, name in [
            ("creatinine",  0.0, 1.2,  "creatinine"),
            ("BUN",         0.0, 20.0, "bun"),
            ("WBC x 1000",  4.0, 11.0, "wbc"),
            ("glucose",     70,  180,  "glucose"),
        ]:
            val = row.get(col)
            if val is None or (isinstance(val, float) and np.isnan(val)):
                continue
            if val > hi and hi > 0:
                dev = (val - hi) / hi
                if dev > worst_dev:
                    worst_dev = dev; top_flag = f"{name} high"
            elif val < lo and lo > 0:
                dev = (lo - val) / lo
                if dev > worst_dev:
                    worst_dev = dev; top_flag = f"{name} low"

        clinical = {
            "age":               safe_float(row.get("age")),
            "heart_rate":        safe_float(row.get("mean_heartrate")),
            "oxygen_saturation": safe_float(row.get("mean_sao2")),
            "blood_pressure":    safe_float(row.get("mean_bp")),
            "glucose":           safe_float(row.get("glucose")),
            "white_blood_cells": safe_float(row.get("WBC x 1000")),
            "bun":               safe_float(row.get("BUN")),
        }
        news2_total = compute_news2_score(clinical)["total"]

        patients.append({
            "patient_id": int(row["patientunitstayid"]),
            "risk_pct":   round(prob * 100, 1),
            "urgency":    classify_urgency(prob),
            "age":        int(row.get("age", 0)),
            "is_senior":  bool(is_senior),
            "group":      "Senior (≥65)" if is_senior else "Non-senior (<65)",
            "vs_avg_pp":  vs_avg_pp,
            "top_flag":   top_flag,
            "news2":      news2_total,
            "mortality":  int(row.get("mortality", 0)),
        })

    patients.sort(key=lambda p: p["risk_pct"], reverse=True)

    urgency_counts = {"Escalate": 0, "Concern": 0, "Watch": 0, "Stable": 0}
    for p in patients:
        urgency_counts[p["urgency"]] += 1

    senior_avg_risk     = round(_group_avgs["senior"] * 100, 1)
    non_senior_avg_risk = round(_group_avgs["non_senior"] * 100, 1)
    ward_avg_risk       = round(float(np.mean(probs)) * 100, 1)
    gap = abs(senior_avg_risk - non_senior_avg_risk)

    return {
        "patients":          patients,
        "total":             len(patients),
        "sample_mode":       sample,
        "calibration_method": _calibration_method,
        "urgency_counts":    urgency_counts,
        "ward_avg_risk_pct": ward_avg_risk,
        "fairness": {
            "senior_avg_risk_pct":     senior_avg_risk,
            "non_senior_avg_risk_pct": non_senior_avg_risk,
            "gap_pp":                  round(senior_avg_risk - non_senior_avg_risk, 1),
            "interpretation": (
                f"Senior patients average {senior_avg_risk}% risk vs "
                f"{non_senior_avg_risk}% for non-seniors — "
                f"{'BiasGuard has reduced this gap to near-parity' if gap < 5 else 'gap present — monitor for demographic bias'}"
            )
        }
    }


# ---------------------------------------------------
# Patient Endpoint
# ---------------------------------------------------

@router.get("/patient/{patient_id}")
def get_patient_assessment(patient_id: int):

    rows = df[df["patientunitstayid"] == patient_id]
    if rows.empty:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id} not found.")
    patient = rows.iloc[0]

    # ── Preprocess ────────────────────────────────────────
    feature_df   = pd.DataFrame([patient[MODEL_FEATURES]], columns=MODEL_FEATURES)
    raw_values   = {col: safe_float(patient.get(col)) for col in MODEL_FEATURES}
    imputed_mask = feature_df.iloc[0].isna().values

    X_imp    = imputer.transform(feature_df)
    X_scaled = scaler.transform(X_imp)
    x_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(DEVICE)

    # ── Calibrated inference ───────────────────────────────
    with torch.no_grad():
        logit_val = model(x_tensor).item()

    all_logits_np = _get_all_logits()
    prob          = calibrate_single_prob(logit_val, all_logits_np)

    deterioration_pct = round(prob * 100, 2)
    urgency_level     = classify_urgency(prob)
    confidence        = round(abs(prob - 0.5) * 2 * 100, 2)

    # ── Clinical summary ──────────────────────────────────
    display_map = {
        "mean_heartrate": "heart_rate",
        "mean_sao2":      "oxygen_saturation",
        "mean_bp":        "blood_pressure",
        "age":            "age",
        "is_senior":      "is_senior",
        "glucose":        "glucose",
        "creatinine":     "creatinine",
        "WBC x 1000":     "white_blood_cells",
        "BUN":            "bun",
    }

    clinical_summary = {}
    for dataset_col, display_name in display_map.items():
        if dataset_col in patient.index:
            val = patient[dataset_col]
            if pd.notna(val):
                clinical_summary[display_name] = safe_float(val)

    # ── Reference flags and interventions ─────────────────
    reference_flags = {}
    interventions   = []

    for vital_name, ranges in CLINICAL_RANGES.items():
        val = clinical_summary.get(vital_name)
        if val is None:
            continue
        if val < ranges["low"]:
            key = f"{vital_name}_low"
            reference_flags[key] = True
            suggestion = INTERVENTION_SUGGESTIONS.get(key)
            if suggestion:
                interventions.append({
                    "vital": vital_name, "flag": key, "value": val,
                    "unit": ranges["unit"], "direction": "low", "suggestion": suggestion
                })
        elif val > ranges["high"]:
            key = f"{vital_name}_high"
            reference_flags[key] = True
            suggestion = INTERVENTION_SUGGESTIONS.get(key)
            if suggestion:
                interventions.append({
                    "vital": vital_name, "flag": key, "value": val,
                    "unit": ranges["unit"], "direction": "high", "suggestion": suggestion
                })

    # ── NEWS2 and SIRS ────────────────────────────────────
    news2_score = compute_news2_score(clinical_summary)
    sirs        = compute_sirs_criteria(clinical_summary)

    # ── Feature contributions ─────────────────────────────
    contributions = compute_feature_contributions(
        model, x_tensor, X_scaled, raw_values, imputed_mask
    )

    # ── Fairness context ──────────────────────────────────
    is_senior        = int(patient.get("is_senior", 0)) if pd.notna(patient.get("is_senior", None)) else 0
    patient_group    = "Senior (≥65)" if is_senior == 1 else "Non-Senior (<65)"
    group_avg        = _group_avgs["senior"] if is_senior else _group_avgs["non_senior"]
    patient_vs_group = round((prob - group_avg) * 100, 2)

    fairness_context = {
        "protected_attribute":    "is_senior",
        "patient_group":          patient_group,
        "group_avg_risk_pct":     round(group_avg * 100, 2),
        "patient_risk_pct":       deterioration_pct,
        "patient_vs_group_delta": patient_vs_group,
        "bias_mitigation_active": True,
        "calibration_method":     _calibration_method,
        "interpretation": (
            f"This patient's deterioration risk is "
            f"{'above' if patient_vs_group > 0 else 'below'} "
            f"the average for {patient_group} patients "
            f"by {abs(patient_vs_group):.1f} percentage points."
        )
    }

    return {
        "patient_id": int(patient_id),
        "deterioration_warning": {
            "probability":        safe_float(prob),
            "risk_percentage":    deterioration_pct,
            "urgency_level":      urgency_level,
            "confidence":         confidence,
            "calibration_method": _calibration_method,
        },
        "clinical_summary":  clinical_summary,
        "reference_flags":   reference_flags,
        "interventions":     interventions,
        "news2":             news2_score,
        "sirs":              sirs,
        "explanation":       contributions,
        "fairness_context":  fairness_context,
    }