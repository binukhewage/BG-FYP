import pandas as pd
import numpy as np
import os

# ---------------------------------------------------
# PATH SETUP
# ---------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)

MIMIC_DIR = os.path.join(BACKEND_DIR, "mimic_data")
OUTPUT_DIR = os.path.join(BACKEND_DIR, "data", "processed")

os.makedirs(OUTPUT_DIR, exist_ok=True)

print("\n MIMIC → BiasGuard Data Pipeline\n")

# ---------------------------------------------------
# PINNED MIMIC-III ITEMIDs
#
# WBC  51301 — "White Blood Cells" (hematology, K/uL)
# Cr   50912 — "Creatinine" (chemistry, mg/dL)
# BUN  51006 — "Urea Nitrogen" (chemistry, mg/dL)
# Gluc 50931 — "Glucose" (chemistry, mg/dL)
#      50809 — "Glucose" (whole blood, mg/dL)
# ---------------------------------------------------

GLUCOSE_ITEMIDS    = [50931, 50809]
CREATININE_ITEMIDS = [50912]
WBC_ITEMIDS        = [51301]
BUN_ITEMIDS        = [51006]

ALL_ITEMIDS = GLUCOSE_ITEMIDS + CREATININE_ITEMIDS + WBC_ITEMIDS + BUN_ITEMIDS

# FIX 1 — Tightened WBC upper bound: 200 → 100 K/uL
# Real WBC rarely exceeds 100 K/uL even in extreme leukemia.
# Values above 100 are almost certainly unit errors (cells/µL not divided by 1000).
OUTLIER_BOUNDS = {
    "glucose":     (20,  1000),
    "creatinine":  (0.1,   40.0),
    "WBC x 1000":  (0.1,  50.0),   # ← was 200.0
    "BUN":         (1.0,  300.0),
}

# ---------------------------------------------------
# LOAD DATA
# ---------------------------------------------------

print("Loading datasets...")

patients   = pd.read_csv(os.path.join(MIMIC_DIR, "PATIENTS_sorted.csv"))
admissions = pd.read_csv(os.path.join(MIMIC_DIR, "ADMISSIONS_sorted.csv"))
icu        = pd.read_csv(os.path.join(MIMIC_DIR, "ICUSTAYS_sorted.csv"))
labs       = pd.read_csv(os.path.join(MIMIC_DIR, "LABEVENTS_sorted.csv"))

print("Datasets loaded")

# ---------------------------------------------------
# STANDARDIZE COLUMN NAMES
# ---------------------------------------------------

patients.columns   = patients.columns.str.upper()
admissions.columns = admissions.columns.str.upper()
icu.columns        = icu.columns.str.upper()
labs.columns       = labs.columns.str.upper()

# ---------------------------------------------------
# MERGE ICU DATA
# ---------------------------------------------------

print("\nMerging ICU stays...")

df = admissions.merge(patients, on="SUBJECT_ID")
df = df.merge(icu, on="HADM_ID")

print("Merged ICU stays:", df.shape)

# ---------------------------------------------------
# AGE CALCULATION (SAFE FOR MIMIC)
# ---------------------------------------------------

print("Calculating age...")

df["DOB"]      = pd.to_datetime(df["DOB"],      errors="coerce")
df["ADMITTIME"]= pd.to_datetime(df["ADMITTIME"], errors="coerce")

df["age"] = df["ADMITTIME"].dt.year - df["DOB"].dt.year

# MIMIC-III anonymizes patients older than 89 by shifting their DOB — cap at 90.
df.loc[df["age"] > 89, "age"] = 90
df = df[(df["age"] > 0) & (df["age"] < 120)]

df["is_senior"] = (df["age"] >= 65).astype(int)

print(f"Age range: {df['age'].min()}–{df['age'].max()} "
      f"Senior rate: {df['is_senior'].mean():.1%}")

# ---------------------------------------------------
# MORTALITY LABEL
# ---------------------------------------------------

print("Creating mortality label...")

df["mortality"] = df["HOSPITAL_EXPIRE_FLAG"]

print(f"Mortality rate: {df['mortality'].mean():.1%}")

# ---------------------------------------------------
# LAB EXTRACTION — PINNED ITEMIDs ONLY
# ---------------------------------------------------

print("\nExtracting lab features (pinned ITEMIDs)...")
print(f"  Glucose ITEMIDs  : {GLUCOSE_ITEMIDS}")
print(f"  Creatinine ITEMIDs: {CREATININE_ITEMIDS}")
print(f"  WBC ITEMIDs      : {WBC_ITEMIDS}")
print(f"  BUN ITEMIDs      : {BUN_ITEMIDS}")

labs_filtered = labs[labs["ITEMID"].isin(ALL_ITEMIDS)].copy()

print(f"\nRows after ITEMID filter: {len(labs_filtered):,}")

labs_filtered = labs_filtered.dropna(subset=["VALUENUM"])
labs_filtered = labs_filtered[labs_filtered["VALUENUM"] >= 0]

labs_filtered["VALUEUOM"] = (
    labs_filtered["VALUEUOM"]
    .fillna("")
    .astype(str)
    .str.strip()
    .str.upper()
)



def validate_units(row):
    itemid = row["ITEMID"]
    unit   = row["VALUEUOM"]
    val    = row["VALUENUM"]

    if itemid in WBC_ITEMIDS:
        # Accept named K/uL variants — already in ×10³/µL
        if unit in ["K/UL", "10^3/UL", "K/UL."]:
            return val
        # FIX 2: blank-unit entries capped at 50 (was 200)
        if unit == "" and 0.1 <= val <= 50:
            return val
        return np.nan

    if itemid in GLUCOSE_ITEMIDS:
        if unit in ["MG/DL", "MG/DL.", ""]:
            return val
        return np.nan

    if itemid in CREATININE_ITEMIDS:
        if unit in ["MG/DL", "MG/DL.", ""]:
            return val
        return np.nan

    if itemid in BUN_ITEMIDS:
        if unit in ["MG/DL", "MG/DL.", ""]:
            return val
        return np.nan

    return np.nan

labs_filtered["VALUENUM"] = labs_filtered.apply(validate_units, axis=1)
labs_filtered = labs_filtered.dropna(subset=["VALUENUM"])

print(f"Rows after unit validation: {len(labs_filtered):,}")

# ---------------------------------------------------
# MAP ITEMIDs → FEATURE NAMES
# ---------------------------------------------------

def map_lab(itemid):
    if itemid in GLUCOSE_ITEMIDS:    return "glucose"
    if itemid in CREATININE_ITEMIDS: return "creatinine"
    if itemid in WBC_ITEMIDS:        return "WBC x 1000"
    if itemid in BUN_ITEMIDS:        return "BUN"
    return None

labs_filtered["feature"] = labs_filtered["ITEMID"].apply(map_lab)
labs_filtered = labs_filtered.dropna(subset=["feature"])




labs_agg = (
    labs_filtered
    .groupby(["HADM_ID", "feature"])["VALUENUM"]
    .median()          # ← was .mean()
    .reset_index()
)

labs_agg = labs_agg.pivot(
    index="HADM_ID",
    columns="feature",
    values="VALUENUM"
).reset_index()

labs_agg.columns.name = None

print(f"Lab features extracted: {labs_agg.shape}")

# ---------------------------------------------------
# MERGE LABS INTO MAIN DATAFRAME
# ---------------------------------------------------

print("Merging labs...")

df = df.merge(labs_agg, on="HADM_ID", how="left")

# ---------------------------------------------------
# OUTLIER CLIPPING
# ---------------------------------------------------

print("Clipping outliers...")

for col, (lo, hi) in OUTLIER_BOUNDS.items():
    if col in df.columns:
        df[col] = df[col].clip(lower=lo, upper=hi)
        print(f"  {col:15s} clipped to [{lo}, {hi}]")

# ---------------------------------------------------
# FINAL FEATURE SET
# ---------------------------------------------------

print("\nPreparing final dataset...")

features = [
    "ICUSTAY_ID",
    "age",
    "is_senior",
    "glucose",
    "creatinine",
    "WBC x 1000",
    "BUN",
    "mortality",
]

features = [f for f in features if f in df.columns]
final = df[features].copy()

final = final.rename(columns={"ICUSTAY_ID": "patientunitstayid"})
final = final.drop_duplicates(subset=["patientunitstayid"])

print(f"\nFinal dataset shape: {final.shape}")

# ---------------------------------------------------
# VALIDATION REPORT
# ---------------------------------------------------

print("\n── Dataset Validation ─────────────────────────────")
print(f"  Total patients  : {len(final):,}")
print(f"  Mortality rate  : {final['mortality'].mean():.1%}")
print(f"  Senior rate     : {final['is_senior'].mean():.1%}")
print(f"\n  Missingness:")
print(final.isnull().mean().round(3).to_string())
print(f"\n  Descriptive stats:")
print(final.describe().round(2).to_string())

# FIX 4 — Lowered WBC warning threshold: 20 → 10
# Healthy ICU population should average ~10–12 K/uL.
wbc_mean = final["WBC x 1000"].mean()
wbc_max  = final["WBC x 1000"].max()
if wbc_mean > 10:
    print(f"\n WARNING: WBC mean={wbc_mean:.1f} is still high — "
          f"check ITEMID {WBC_ITEMIDS} is present in your LABEVENTS file.")
else:
    print(f"\nWBC looks correct: mean={wbc_mean:.1f}, max={wbc_max:.1f} K/uL")

# ---------------------------------------------------
# SAVE
# ---------------------------------------------------

output_path = os.path.join(OUTPUT_DIR, "merged_dataset.csv")
final.to_csv(output_path, index=False)

print(f"\nDataset saved to: {output_path}")
print("\n Ready for BiasGuard hospital splitting\n")