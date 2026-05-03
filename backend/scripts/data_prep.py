import pandas as pd
import numpy as np
import os
import json

# PATH SETUP

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)

DATA_DIR      = os.path.join(BACKEND_DIR, "data")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
HOSPITALS_DIR = os.path.join(DATA_DIR, "hospitals")
HOLDOUT_DIR   = os.path.join(DATA_DIR, "holdout")
REGISTRY_DIR  = os.path.join(DATA_DIR, "registry")

os.makedirs(HOSPITALS_DIR, exist_ok=True)
os.makedirs(HOLDOUT_DIR,   exist_ok=True)
os.makedirs(REGISTRY_DIR,  exist_ok=True)

print("BiasGuard Dataset Preparation — Non-IID Distribution")
print("No feature values modified. Bias from demographic skew only.\n")

# LOAD DATA

df = pd.read_csv(os.path.join(PROCESSED_DIR, "merged_dataset.csv"))
df = df.replace([np.inf, -np.inf], np.nan)

# FIX 1 — Verify is_senior consistency before overwriting
if "is_senior" in df.columns:
    recomputed = (df["age"] >= 65).astype(int)
    mismatch   = (df["is_senior"] != recomputed).sum()
    print(f"is_senior mismatch check: {mismatch} rows differ from age>=65 rule")
    if mismatch > 0:
        print("Overwriting is_senior to match age>=65 threshold")


df["is_senior"] = (df["age"] >= 65).astype(int)

print(f"Dataset loaded: {len(df)} patients")
print(f"  Senior (≥65):  {df.is_senior.sum()} ({df.is_senior.mean()*100:.1f}%)")
print(f"  Mortality:     {df.mortality.sum()} ({df.mortality.mean()*100:.1f}%)")
print(f"  Senior mort.:  {df[df.is_senior==1].mortality.mean()*100:.1f}%")
print(f"  Non-sr mort.:  {df[df.is_senior==0].mortality.mean()*100:.1f}%")

# GLOBAL TEST SET — strict holdout before any hospital splits

global_test = df.sample(frac=0.15, random_state=42)
global_test.to_csv(os.path.join(HOLDOUT_DIR, "global_test.csv"), index=False)

train_pool = df.drop(global_test.index).reset_index(drop=True)
print(f"\nTrain pool: {len(train_pool)} | Global test holdout: {len(global_test)}")

train_pool = df.drop(global_test.index).reset_index(drop=True)
print(f"\nTrain pool: {len(train_pool)} | Global test holdout: {len(global_test)}")

# SAVE CENTRALIZED TRAINING DATASET 

CENTRALIZED_PATH = os.path.join(HOLDOUT_DIR, "centralized_train.csv")

train_pool_clean = train_pool.copy()
train_pool_clean = train_pool_clean.replace([np.inf, -np.inf], np.nan)
train_pool_clean = train_pool_clean.fillna(train_pool_clean.median(numeric_only=True))
train_pool_clean.to_csv(CENTRALIZED_PATH, index=False)

print(f"\nCentralized training dataset saved: {CENTRALIZED_PATH}")
print(f"   Samples: {len(train_pool_clean)}")

# SEPARATE DEMOGRAPHIC POOLS
senior_pool    = train_pool[train_pool.is_senior == 1].sample(frac=1, random_state=42).reset_index(drop=True)
nonsenior_pool = train_pool[train_pool.is_senior == 0].sample(frac=1, random_state=42).reset_index(drop=True)

print(f"Senior pool:     {len(senior_pool)} patients")
print(f"Non-senior pool: {len(nonsenior_pool)} patients")


# HOSPITAL CONFIG — Non-IID senior ratios
#
#  hospital_1 (0.85): Geriatric / elderly specialist ICU
#  hospital_2 (0.15): General ICU, younger patient mix
#  hospital_3 (0.60): Mixed ICU, senior-leaning
#  hospital_4 (0.75): Senior-majority medical ICU
#  hospital_5 (0.25): Younger-majority surgical ICU
#  hospital_onboarding (0.50): Balanced community hospital

HOSPITAL_CONFIG = {
    "hospital_1":          {"senior_ratio": 0.85, "label": "Geriatric ICU"},
    "hospital_2":          {"senior_ratio": 0.15, "label": "General/mixed"},
    "hospital_3":          {"senior_ratio": 0.60, "label": "Senior-leaning"},
    "hospital_4":          {"senior_ratio": 0.75, "label": "Senior-majority"},
    "hospital_5":          {"senior_ratio": 0.25, "label": "Young-majority"},
    "hospital_onboarding": {"senior_ratio": 0.50, "label": "Community hospital"},
}

TARGET = 1496

# Verify pool capacity before building any hospital
total_senior_demand    = sum(int(TARGET * cfg["senior_ratio"]) for cfg in HOSPITAL_CONFIG.values())
total_nonsenior_demand = sum(TARGET - int(TARGET * cfg["senior_ratio"]) for cfg in HOSPITAL_CONFIG.values())

assert total_senior_demand    <= len(senior_pool),    \
    f"Senior pool too small: need {total_senior_demand}, have {len(senior_pool)}"
assert total_nonsenior_demand <= len(nonsenior_pool),  \
    f"Non-senior pool too small: need {total_nonsenior_demand}, have {len(nonsenior_pool)}"

print(f"\nTARGET={TARGET} per hospital | {TARGET*6} total ({TARGET*6/len(train_pool)*100:.1f}% of pool)")
print(f"Senior demand:    {total_senior_demand}/{len(senior_pool)} ✓")
print(f"Non-senior demand:{total_nonsenior_demand}/{len(nonsenior_pool)} ✓")


# BUILD HOSPITALS

senior_idx    = 0
nonsenior_idx = 0

hospitals = []
seen_ids  = set()

print(f"\n{'Hospital':<22} {'n':>6} {'Senior%':>8} {'Sr mort':>8} {'NS mort':>8} {'DP gap':>7}")
print("─" * 68)

for i, (name, cfg) in enumerate(HOSPITAL_CONFIG.items()):

    n_senior    = int(TARGET * cfg["senior_ratio"])
    n_nonsenior = TARGET - n_senior

    # Non-overlapping slice from each demographic pool
    s_slice  = senior_pool.iloc[senior_idx    : senior_idx    + n_senior].copy()
    ns_slice = nonsenior_pool.iloc[nonsenior_idx : nonsenior_idx + n_nonsenior].copy()

    senior_idx    += n_senior
    nonsenior_idx += n_nonsenior

    hospital_df = pd.concat([s_slice, ns_slice])

    # Zero cross-hospital patient overlap check
    new_ids = set(hospital_df["patientunitstayid"].tolist())
    overlap = new_ids & seen_ids
    assert len(overlap) == 0, \
        f"DATA LEAKAGE in {name}: {len(overlap)} duplicate patients"
    seen_ids |= new_ids

    # NaN cleanup — no feature modification
    hospital_df = hospital_df.replace([np.inf, -np.inf], np.nan)
    hospital_df = hospital_df.fillna(hospital_df.median(numeric_only=True))

    # FIX 3 — unique shuffle seed per hospital
    hospital_df = hospital_df.sample(frac=1, random_state=42 + i).reset_index(drop=True)

    # Observed metrics
    senior_mort = hospital_df[hospital_df.is_senior == 1]["mortality"].mean()
    young_mort  = hospital_df[hospital_df.is_senior == 0]["mortality"].mean()
    dp_gap      = abs(senior_mort - young_mort)
    senior_pct  = hospital_df.is_senior.mean() * 100
    avg_age     = hospital_df["age"].mean()

    # Save
    if name == "hospital_onboarding":
        path = os.path.join(HOLDOUT_DIR, name + ".csv")
    else:
        path = os.path.join(HOSPITALS_DIR, name + ".csv")
        hospitals.append({
            "id":         len(hospitals) + 1,
            "file":       name + ".csv",
            "patients":   len(hospital_df),
            "avg_age":    round(avg_age, 2),
            "senior_pct": round(senior_pct, 1),
            "label":      cfg["label"],
            "active":     True,
            "type":       "core",
        })

    hospital_df.to_csv(path, index=False)

    print(
        f"{name.ljust(22)} {len(hospital_df):>6} "
        f"{senior_pct:>7.1f}% "
        f"{senior_mort:>8.3f} "
        f"{young_mort:>8.3f} "
        f"{dp_gap:>7.3f}"
    )

# REGISTRY

registry = {"hospitals": hospitals}
with open(os.path.join(REGISTRY_DIR, "hospitals.json"), "w") as f:
    json.dump(registry, f, indent=4)

print(f"\n{'─'*68}")
print(f"Unique patients assigned: {len(seen_ids)}")
print(f"Pool remaining — senior: {len(senior_pool)-senior_idx} | non-senior: {len(nonsenior_pool)-nonsenior_idx}")
print(f"\nDataset ready")
print(f"   {TARGET} patients per hospital × 6 hospitals = {TARGET*6} total")
print(f"   Non-IID distribution. All MIMIC-III feature values unmodified.")
print(f"\n   Output directories:")
print(f"   Hospitals  → {HOSPITALS_DIR}")
print(f"   Holdout    → {HOLDOUT_DIR}")
print(f"   Registry   → {REGISTRY_DIR}")
