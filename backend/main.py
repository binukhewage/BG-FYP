import os
import random
import numpy as np
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import shutil
import json
import torch

from federated.server import FederatedServer
from federated.onboarding import HospitalOnboarding
from federated.config import NUM_ROUNDS
from federated.config import DP_ENABLED, NOISE_SCALE, CLIP_VALUE


from api.clinician import router as clinician_router, load_global_model

# -----------------------------------------
# Experiment-specific training configs
# -----------------------------------------

BASELINE_LOCAL_EPOCHS = 8
BASELINE_LR = 0.008
BASELINE_DP = False

BIAS_LOCAL_EPOCHS = 8
BIAS_LR = 0.008
BIAS_DP = DP_ENABLED

# -----------------------------------------
# Global seed
# -----------------------------------------
GLOBAL_SEED = 42

def set_seed(seed=GLOBAL_SEED):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

set_seed()

app = FastAPI()
app.include_router(clinician_router, prefix="/clinician")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_DIR          = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH        = os.path.join(BACKEND_DIR, "data", "registry", "hospitals.json")
MODEL_DIR            = os.path.join(BACKEND_DIR, "models")
MODEL_PATH           = os.path.join(MODEL_DIR, "global_model.pt")           # BiasGuard
BASELINE_MODEL_PATH  = os.path.join(MODEL_DIR, "baseline_model.pt")         

server_instance   = None   # BiasGuard
baseline_instance = None   # Standard FedAvg


# -----------------------------------------
# Helper — save both models in one call 
# -----------------------------------------
def _save_models():
    os.makedirs(MODEL_DIR, exist_ok=True)
    torch.save(server_instance.global_model.state_dict(), MODEL_PATH)
    torch.save(baseline_instance.global_model.state_dict(), BASELINE_MODEL_PATH)
    print(f"BiasGuard model saved  → {MODEL_PATH}")
    print(f"Baseline model saved   → {BASELINE_MODEL_PATH}")


# -----------------------------------------
# Start Federation
# -----------------------------------------
@app.post("/start-federation")
def start_federation():

    global server_instance, baseline_instance

    # -------------------------------------------------------
    # EXPERIMENT 1: Standard FedAvg (Baseline)
    # -------------------------------------------------------
    set_seed()
    print("\n=== EXPERIMENT 1: Standard FedAvg (Baseline) ===")

    baseline_instance = FederatedServer(
        backend_dir=BACKEND_DIR,
        num_rounds=NUM_ROUNDS,
        fairness_lambda=0.0,
        fairness_loss_weight=0.0,
        local_epochs=BASELINE_LOCAL_EPOCHS,
        learning_rate=BASELINE_LR,
        dp_enabled=BASELINE_DP
    )
    baseline_instance.train()

    # -------------------------------------------------------
    # EXPERIMENT 2: BiasGuard Bias-Aware FedAvg
    # -------------------------------------------------------
    set_seed()
    print("\n=== EXPERIMENT 2: BiasGuard Bias-Aware FedAvg ===")

    server_instance = FederatedServer(
        backend_dir=BACKEND_DIR,
        num_rounds=NUM_ROUNDS,
        fairness_lambda=None,
        fairness_loss_weight=None,
        local_epochs=BIAS_LOCAL_EPOCHS,
        learning_rate=BIAS_LR,
        dp_enabled=BIAS_DP
    )
    server_instance.train()

    # Save both models                                        
    _save_models()

    load_global_model()
    print("[clinician] BiasGuard model reloaded for clinical inference")

    return {
        "baseline": {
            "global_results":               baseline_instance.history[-1],
            "round_history":                baseline_instance.history,
            "hospital_metrics":             baseline_instance.last_round_hospital_metrics,
            "first_round_hospital_metrics": baseline_instance.first_round_hospital_metrics,
        },
        "bias_aware": {
            "global_results":               server_instance.history[-1],
            "round_history":                server_instance.history,
            "hospital_metrics":             server_instance.last_round_hospital_metrics,
            "first_round_hospital_metrics": server_instance.first_round_hospital_metrics,
        },
        "active_hospitals": len(server_instance.get_active_hospital_paths()),
        "privacy": {
            "enabled":     DP_ENABLED,
            "noise_scale": NOISE_SCALE if DP_ENABLED else None,
            "clip_value":  CLIP_VALUE  if DP_ENABLED else None
        }
    }


# -----------------------------------------
# Get Current Registry
# -----------------------------------------
@app.get("/hospitals")
def get_hospitals():
    with open(REGISTRY_PATH, "r") as f:
        return json.load(f)


# -----------------------------------------
# Onboard New Hospital
# -----------------------------------------
@app.post("/onboard")
def onboard_hospital(file: UploadFile = File(...)):

    global server_instance, baseline_instance

    upload_path = os.path.join(BACKEND_DIR, "temp_upload.csv")

    with open(upload_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    onboarder = HospitalOnboarding(BACKEND_DIR)

    try:
        onboarder.validate_dataset(upload_path)
    except Exception as e:
        return {"status": "rejected", "reason": str(e)}

    if server_instance is None:
        return {"status": "error", "message": "Start federation first."}

    if baseline_instance is None:
        return {"status": "error", "message": "Baseline server not initialised — start federation first."}

    global_weights = server_instance.global_model.state_dict()
    metrics        = onboarder.evaluate_hospital(upload_path, global_weights)

    approved, message = onboarder.institutional_gate(metrics)
    if not approved:
        return {"status": "rejected", "reason": message, "metrics": metrics}

    new_entry = onboarder.register_hospital(upload_path)

    print("\nNew hospital approved and added to federation")
    print(f"Hospital ID: {new_entry['id']}")
    print("Continuing federated training on BOTH servers...\n")

    bg_start   = len(server_instance.history)  + 1
    base_start = len(baseline_instance.history) + 1

    for i in range(NUM_ROUNDS):
        bg_round   = bg_start   + i
        base_round = base_start + i

        print(f"\n--- Baseline Round {base_round} (Post-Onboarding) ---")
        baseline_instance.run_single_round(base_round)

        print(f"\n--- BiasGuard Round {bg_round} (Post-Onboarding) ---")
        server_instance.run_single_round(bg_round)

    # Save both updated models                               ← CHANGED
    _save_models()
    load_global_model()

    print("\nBoth servers continued and models saved\n")

    return {
        "status":   "approved",
        "hospital": new_entry,
        "metrics":  metrics,
        "federation_update": {
            "round_history":                server_instance.history,
            "global_results":               server_instance.history[-1],
            "hospital_metrics":             server_instance.last_round_hospital_metrics,
            "first_round_hospital_metrics": server_instance.first_round_hospital_metrics,
            "active_hospitals":             len(server_instance.get_active_hospital_paths()),
            "baseline_round_history":       baseline_instance.history,
            "baseline_global_results":      baseline_instance.history[-1],
            "baseline_hospital_metrics":    baseline_instance.last_round_hospital_metrics,
        }
    }


# -----------------------------------------
# Reset Federation
# -----------------------------------------
@app.post("/reset")
def reset_system():

    global server_instance, baseline_instance

    server_instance   = None
    baseline_instance = None

    with open(REGISTRY_PATH, "r") as f:
        registry = json.load(f)

    registry["hospitals"] = [
        h for h in registry["hospitals"] if h["type"] == "core"
    ]

    with open(REGISTRY_PATH, "w") as f:
        json.dump(registry, f, indent=4)

    # Remove both saved models                               ← CHANGED
    for path, label in [(MODEL_PATH, "BiasGuard"), (BASELINE_MODEL_PATH, "Baseline")]:
        if os.path.exists(path):
            os.remove(path)
            print(f"Removed {label} model")

    return {"message": "System reset to core hospitals"}