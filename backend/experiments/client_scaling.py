# backend/experiments/client_scaling.py

import sys
import os
import json
import random
import numpy as np
import torch

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from federated.server import FederatedServer

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))



# Reproducibility (VERY IMPORTANT for research)

def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)



# Activate first N hospitals

def set_active_clients(n):
    path = os.path.join(BACKEND_DIR, "data", "registry", "hospitals.json")

    with open(path, "r") as f:
        registry = json.load(f)

    for i, h in enumerate(registry["hospitals"]):
        h["active"] = i < n

    with open(path, "w") as f:
        json.dump(registry, f, indent=2)



# Count active clients (DEBUG + VALIDATION)

def count_active_clients():
    path = os.path.join(BACKEND_DIR, "data", "registry", "hospitals.json")

    with open(path, "r") as f:
        registry = json.load(f)

    return sum(1 for h in registry["hospitals"] if h["active"])



# Clean models directory

def clean_models():
    models_path = os.path.join(BACKEND_DIR, "models")

    if not os.path.exists(models_path):
        return

    for f in os.listdir(models_path):
        file_path = os.path.join(models_path, f)
        if os.path.isfile(file_path):
            os.remove(file_path)



# Get BEST round 

def get_best_round(history):
    """
    Select best round based on:
    - High AUC
    - Low DP + EO
    """
    best = None
    best_score = -float("inf")

    for h in history:
        auc = h["avg_auc"]
        dp  = h["avg_dp"]
        eo  = h["avg_eo"]

        # Composite score (you can tweak this if needed)
        score = auc - 0.5 * dp - 0.5 * eo

        if score > best_score:
            best_score = score
            best = h

    return best



# Main experiment

def run_experiment():
    results = []

    for n in [3, 5, 6]:
        print(f"\n{'='*50}")
        print(f"=== Running with {n} clients ===")

        set_seed(42)

        # Activate clients
        set_active_clients(n)

        # Debug check (VERY IMPORTANT)
        active_count = count_active_clients()
        print(f"Active clients (registry): {active_count}")

        if active_count != n:
            print(" WARNING: Requested clients != actual active clients")

        # Clean models
        clean_models()

        # Start server
        server = FederatedServer(
            backend_dir=BACKEND_DIR,
            num_rounds=20
        )

        server.train()

        # Get best round instead of last
        best = get_best_round(server.history)

        print(
            f"✔ Best Round → "
            f"AUC: {best['avg_auc']:.4f}, "
            f"DP: {best['avg_dp']:.4f}, "
            f"EO: {best['avg_eo']:.4f}"
        )

        results.append({
            "clients": n,
            "best_auc": round(best["avg_auc"], 4),
            "dp": round(best["avg_dp"], 4),
            "eo": round(best["avg_eo"], 4),
        })

    # Final summary
    print(f"\n{'='*50}")
    print("FINAL RESULTS (BEST ROUND PER SETTING)")
    print(f"{'='*50}")

    for r in results:
        print(r)


# Run

if __name__ == "__main__":
    run_experiment()