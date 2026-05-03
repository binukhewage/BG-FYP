import os
import sys
import torch
import numpy as np
import random

def set_seed(seed=42):
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

set_seed(42)

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BACKEND_DIR)

from federated.server import FederatedServer
from federated.config import (
    NUM_ROUNDS, FAIRNESS_LAMBDA,
    FAIRNESS_PENALTY_MODE, BIAS_REJECTION_THRESHOLD,
    FAIRNESS_LOSS_WEIGHT, LOCAL_EPOCHS,
    DP_ENABLED, NOISE_SCALE
)


print("=========================================================")
print("EXPERIMENT 1: STANDARD FEDERATED LEARNING (Baseline)")
print("=========================================================")

server_baseline = FederatedServer(
    backend_dir=BACKEND_DIR,
    num_rounds=NUM_ROUNDS,
    fairness_lambda=0.0,
    fairness_loss_weight=0.0,
    
)
server_baseline.train()


print("\n=========================================================")
print("EXPERIMENT 2: BIAS-AWARE FEDERATED LEARNING (BiasGuard)")
print("=========================================================")

server_bias_aware = FederatedServer(
    backend_dir=BACKEND_DIR,
    num_rounds=NUM_ROUNDS,
    fairness_lambda=FAIRNESS_LAMBDA,
    fairness_loss_weight=FAIRNESS_LOSS_WEIGHT
)
server_bias_aware.train()


# ---------------------------------------------------
# Final Comparison
# ---------------------------------------------------
baseline_final = server_baseline.history[-1]
proposed_final = server_bias_aware.history[-1]

# Compute improvement percentages
dp_improvement = (
    (baseline_final['avg_dp'] - proposed_final['avg_dp'])
    / (baseline_final['avg_dp'] + 1e-9)
) * 100

eo_improvement = (
    (baseline_final['avg_eo'] - proposed_final['avg_eo'])
    / (baseline_final['avg_eo'] + 1e-9)
) * 100

auc_delta = proposed_final['avg_auc'] - baseline_final['avg_auc']

print("\n")
print("=" * 65)
print("FINAL EXPERIMENT RESULTS")
print("=" * 65)
print(f"  Config: LOCAL_EPOCHS={LOCAL_EPOCHS} | FAIRNESS_LAMBDA={FAIRNESS_LAMBDA}")
print(f"          PENALTY_MODE={FAIRNESS_PENALTY_MODE} | REJECTION_THRESHOLD={BIAS_REJECTION_THRESHOLD}")
print(f"          FAIRNESS_LOSS_WEIGHT={FAIRNESS_LOSS_WEIGHT} | DP={DP_ENABLED} (σ={NOISE_SCALE})")
print("-" * 65)
print(f"{'Metric':<20}| {'Standard FedAvg':<20}| {'BiasGuard':<20}")
print("-" * 65)
print(f"{'Average AUC':<20}| {baseline_final['avg_auc']:<20.4f}| {proposed_final['avg_auc']:<20.4f}  Δ {auc_delta:+.4f}")
print(f"{'Average DP Gap':<20}| {baseline_final['avg_dp']:<20.4f}| {proposed_final['avg_dp']:<20.4f}  ↓ {dp_improvement:.1f}% {'✅' if dp_improvement > 10 else '⚠️'}")
print(f"{'Average EO Gap':<20}| {baseline_final['avg_eo']:<20.4f}| {proposed_final['avg_eo']:<20.4f}  ↓ {eo_improvement:.1f}% {'✅' if eo_improvement > 10 else '⚠️'}")
print("=" * 65)
print("DP / EO: Lower is better (smaller fairness gap)")
print("AUC:     Higher is better (should stay close to baseline)")