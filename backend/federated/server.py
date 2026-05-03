# =============================================================
# Three-layer fairness mechanism 
#   Layer 1 — Bias-Aware Aggregation  : down-weight / reject biased clients
#   Layer 2 — Adaptive Lambda         : tighten penalty pressure over rounds
#   Layer 3 — Post-Aggregation Correction : gradient steps directly on global
#             model to minimise DP gap using pooled val data
# =============================================================

import os
import json
import torch
import torch.nn as nn
import numpy as np
import pandas as pd
from copy import deepcopy
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score

from federated.client import FederatedClient
from federated.model import LogisticRegressionModel
from federated.config import (
    INPUT_DIM, MODEL_FEATURES, TARGET_COLUMN, PROTECTED_ATTRIBUTE,
    DP_ENABLED, NOISE_SCALE, CLIP_VALUE,
    FAIRNESS_LAMBDA,
    FAIRNESS_LOSS_WEIGHT,
    FAIRNESS_PENALTY_MODE,
    BIAS_REJECTION_THRESHOLD,
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class FederatedServer:

    def __init__(
        self,
        backend_dir,
        num_rounds           = 10,
        fairness_lambda      = None,
        fairness_loss_weight = None,
        local_epochs         = 15,
        learning_rate        = 0.005,
        dp_enabled           = None,
    ):
        self.backend_dir   = backend_dir
        self.num_rounds    = num_rounds
        self.local_epochs  = local_epochs
        self.learning_rate = learning_rate

        self.fairness_lambda = (
            fairness_lambda if fairness_lambda is not None else FAIRNESS_LAMBDA
        )
        self.fairness_loss_weight = (
            fairness_loss_weight if fairness_loss_weight is not None else FAIRNESS_LOSS_WEIGHT
        )
        self.dp_enabled = (
            dp_enabled if dp_enabled is not None else DP_ENABLED
        )
        self.bias_rejection_threshold = BIAS_REJECTION_THRESHOLD

        self.registry_path = os.path.join(
            backend_dir, "data", "registry", "hospitals.json"
        )

        self.global_model = LogisticRegressionModel(INPUT_DIM).to(DEVICE)

        self.history                      = []
        self.last_round_hospital_metrics  = []
        self.first_round_hospital_metrics = []
        self._peak_dp_per_hospital        = {}
        self._last_rejection_count        = 0
        self._last_fairness_weights       = []
        self._last_global_dp              = 0.0

        self._adaptive_lambda    = float(self.fairness_lambda)
        self._dp_target          = 0.08
        self._dp_pressure_thresh = 0.12
        self._lambda_growth_rate = 1.30
        self._lambda_max         = self.fairness_lambda * 10.0

        self._correction_steps = 5
        self._correction_lr    = 0.001

    def get_active_hospital_paths(self):
        with open(self.registry_path, "r") as f:
            registry = json.load(f)
        active = [h for h in registry.get("hospitals", []) if h.get("active", True)]
        return [
            os.path.join(self.backend_dir, "data", "hospitals", h["file"])
            for h in active
        ]

    def fed_avg(self, client_weights, client_sizes):
        new_state_dict = deepcopy(client_weights[0])
        total_samples  = sum(client_sizes)
        for key in new_state_dict:
            new_state_dict[key] = sum(
                client_weights[i][key] * (client_sizes[i] / total_samples)
                for i in range(len(client_weights))
            )
        return new_state_dict

    def _update_adaptive_lambda(self):
        if self.fairness_lambda == 0:
            return

        if self._last_global_dp > self._dp_pressure_thresh:
            self._adaptive_lambda = min(
                self._adaptive_lambda * self._lambda_growth_rate,
                self._lambda_max
            )
        elif self._last_global_dp < self._dp_target:
            self._adaptive_lambda = max(
                self._adaptive_lambda / self._lambda_growth_rate,
                self.fairness_lambda
            )

    def _compute_fairness_weight(self, sample_size, bias_score):
        if bias_score > self.bias_rejection_threshold:
            return 0.0

        lam = self._adaptive_lambda

        if FAIRNESS_PENALTY_MODE == "inverse":
            penalty = 1.0 / (1.0 + lam * (bias_score ** 2))
        elif FAIRNESS_PENALTY_MODE == "quadratic":
            penalty = 1.0 / (0.0, 1.0 + lam * (bias_score ** 2))
        else:
            penalty = np.exp(-lam * bias_score)

        return sample_size * penalty

    def bias_aware_fed_avg(self, client_weights, client_sizes, client_biases):
        fairness_weights = [
            self._compute_fairness_weight(client_sizes[i], client_biases[i])
            for i in range(len(client_sizes))
        ]
        total_weight = sum(fairness_weights)

        if total_weight == 0:
            print("   All clients rejected — fallback to FedAvg")
            self._last_rejection_count  = len(client_sizes)
            self._last_fairness_weights = [0.0] * len(client_sizes)
            return self.fed_avg(client_weights, client_sizes)

        num_rejected = sum(1 for w in fairness_weights if w == 0)
        self._last_rejection_count  = num_rejected
        self._last_fairness_weights = [
            round(w / total_weight, 4) for w in fairness_weights
        ]

        if num_rejected > 0:
            print(f"  Rejected {num_rejected} biased client(s)")

        new_state_dict = deepcopy(client_weights[0])
        for key in new_state_dict:
            new_state_dict[key] = sum(
                client_weights[i][key] * (fairness_weights[i] / total_weight)
                for i in range(len(client_weights))
            )
        return new_state_dict

    def _apply_weight_correction(self, client_weights, client_biases):
            """
            FL FAIRNESS CORRECTION 
            """

            if self.fairness_lambda == 0:
                return

            # Compute average bias direction
            avg_bias = np.mean(client_biases)

            # If no bias → skip
            if abs(avg_bias) < 1e-4:
                return

            # Correction strength (balanced with client)
            correction_strength = 0.1 * self._adaptive_lambda

            new_state = self.global_model.state_dict()

            for key in new_state:
                # Compute direction from client updates
                direction = sum(
                    (client_weights[i][key] - new_state[key]) * client_biases[i]
                    for i in range(len(client_weights))
                ) / len(client_weights)

                # Apply correction (opposite to bias)
                new_state[key] -= correction_strength * direction

            self.global_model.load_state_dict(new_state)

    def _evaluate_global(self, hospital_paths, val_split=0.15):
        all_probs, all_y, all_protected = [], [], []

        for path in hospital_paths:
            df       = pd.read_csv(path)
            X_raw    = df[MODEL_FEATURES].values
            y_raw    = df[TARGET_COLUMN].values
            prot_raw = df[PROTECTED_ATTRIBUTE].values
            split    = int(len(X_raw) * (1 - val_split))

            imputer = SimpleImputer(strategy="median")
            imputer.fit(X_raw[:split])
            scaler = StandardScaler()
            scaler.fit(imputer.transform(X_raw[:split]))

            X_val = scaler.transform(imputer.transform(X_raw[split:]))
            X_t   = torch.tensor(X_val, dtype=torch.float32).to(DEVICE)

            self.global_model.eval()
            with torch.no_grad():
                probs = torch.sigmoid(
                    self.global_model(X_t)
                ).cpu().numpy().flatten()

            all_probs.extend(probs.tolist())
            all_y.extend(y_raw[split:].tolist())
            all_protected.extend(prot_raw[split:].tolist())

        all_probs     = np.array(all_probs)
        all_y         = np.array(all_y)
        all_protected = np.array(all_protected)
        all_preds     = (all_probs > 0.5).astype(int)

        try:
            auc = float(roc_auc_score(all_y, all_probs))
        except:
            auc = 0.5

        s_mask  = (all_protected == 1)
        ns_mask = (all_protected == 0)

        if s_mask.sum() > 0 and ns_mask.sum() > 0:
            sr  = float(all_preds[s_mask].mean())
            nr  = float(all_preds[ns_mask].mean())
            dp  = float(abs(sr - nr))
            dpd = float(sr - nr)
        else:
            sr = nr = dp = dpd = 0.0

        def tpr(mask):
            pos = (all_y[mask] == 1)
            if pos.sum() == 0:
                return 0.0
            return float((all_preds[mask][pos] == 1).mean())

        eo = float(abs(tpr(s_mask) - tpr(ns_mask)))

        return {
            "auc":                      auc,
            "avg_dp":                   dp,
            "avg_eo":                   eo,
            "dp_gap_direction":         dpd,
            "senior_positive_rate":     sr,
            "non_senior_positive_rate": nr,
        }

    def run_single_round(self, round_num):
        print(f"\\n--- Round {round_num} ---")

        global_weights = self.global_model.state_dict()
        hospital_paths = self.get_active_hospital_paths()
        print(f"Active Hospitals: {len(hospital_paths)}")

        current_dp = (
            self._last_global_dp if (self.fairness_loss_weight > 0 and self.history)
            else None
        )

        client_weights, client_sizes   = [], []
        client_biases,  client_dp_dirs = [], []
        client_aucs,    client_eos     = [], []
        client_sr,      client_nsr     = [], []

        for path in hospital_paths:
            client = FederatedClient(path)

            weights, metrics = client.train(
                global_weights       = global_weights,
                current_dp           = current_dp,
                local_epochs         = self.local_epochs,
                learning_rate        = self.learning_rate,
                dp_enabled           = self.dp_enabled,
                fairness_loss_weight = self.fairness_loss_weight,
            )

            client_weights.append(weights)
            client_sizes.append(metrics.get("train_samples", metrics["samples"]))
            client_biases.append(metrics["demographic_parity"])
            client_dp_dirs.append(metrics["dp_gap_direction"])
            client_aucs.append(metrics["auc"])
            client_eos.append(metrics["equal_opportunity"])
            client_sr.append(metrics["senior_positive_rate"])
            client_nsr.append(metrics["non_senior_positive_rate"])

            print(
                f"  {os.path.basename(path)} | "
                f"AUC: {metrics['auc']:.3f} | "
                f"DP: {metrics['demographic_parity']:.3f} | "
                f"EO: {metrics['equal_opportunity']:.3f}"
            )

        if self.fairness_lambda == 0:
            new_weights = self.fed_avg(client_weights, client_sizes)
            self._last_rejection_count  = 0
            self._last_fairness_weights = []
            print("  Aggregation: Standard FedAvg")
        else:
            self._update_adaptive_lambda()
            new_weights = self.bias_aware_fed_avg(
                client_weights, client_sizes, client_biases
            )
            print(
                f"  Aggregation: Bias-Aware FedAvg "
                f"[λ={self._adaptive_lambda:.3f}]"
            )

        self.global_model.load_state_dict(new_weights)


        self._apply_weight_correction(client_weights, client_biases)

        g                    = self._evaluate_global(hospital_paths)
        self._last_global_dp = g["avg_dp"]

        self.history.append({
            "round":            round_num,
            "avg_auc":          g["auc"],
            "avg_dp":           g["avg_dp"],
            "avg_eo":           g["avg_eo"],
            "rejected_count":   self._last_rejection_count,
            "fairness_weights": list(self._last_fairness_weights),
            "adaptive_lambda":  round(self._adaptive_lambda, 4),
        })

        fw = self._last_fairness_weights
        self.last_round_hospital_metrics = []

        for i, path in enumerate(hospital_paths):
            hname  = os.path.basename(path)
            dp_val = float(client_biases[i])

            prev = self._peak_dp_per_hospital.get(hname, 0.0)
            self._peak_dp_per_hospital[hname] = max(prev, dp_val)

            self.last_round_hospital_metrics.append({
                "hospital":         hname,
                "auc":              float(client_aucs[i]),
                "dp":               dp_val,
                "dp_direction":     float(client_dp_dirs[i]),
                "senior_rate":      float(client_sr[i]),
                "non_senior_rate":  float(client_nsr[i]),
                "eo":               float(client_eos[i]),
                "samples":          int(client_sizes[i]),
                "rejected":         bool(fw[i] == 0.0) if fw else False,
                "fairness_weight":  float(fw[i]) if fw else 1.0,
                "peak_dp":          float(self._peak_dp_per_hospital[hname]),
            })

        if round_num == 1:
            self.first_round_hospital_metrics = deepcopy(
                self.last_round_hospital_metrics
            )

        print(f"\\n  Round {round_num} Summary (Global Model):")
        print(f"  Global AUC : {g['auc']:.3f}")
        print(f"  Global DP  : {g['avg_dp']:.3f}")
        print(f"  Global EO  : {g['avg_eo']:.3f}")
        if self.fairness_lambda > 0:
            print(f"  λ (adaptive): {self._adaptive_lambda:.3f}")

    def train(self):
        print("\\nStarting Federated Training")

        if self.dp_enabled:
            print(f"Differential Privacy : ENABLED  (noise={NOISE_SCALE}, clip={CLIP_VALUE})")
        else:
            print("Differential Privacy : DISABLED")

        if self.fairness_lambda > 0:
            print(f"  Bias-Aware Aggregation : ENABLED")
            print(f"   Fairness Lambda     : {self.fairness_lambda}")
            print(f"   Penalty Mode        : {FAIRNESS_PENALTY_MODE}")
            print(f"   Rejection Threshold : {self.bias_rejection_threshold}")
            print(f"   Adaptive λ max      : {self._lambda_max:.1f}")
            print(f"   Correction Steps    : {self._correction_steps}")

        if self.fairness_loss_weight > 0:
            print(f"Client Fairness Penalty : ENABLED  (weight={self.fairness_loss_weight})")
        else:
            print("Client Fairness Penalty : DISABLED (server-only mode)")

        start_round = len(self.history) + 1
        end_round   = start_round + self.num_rounds - 1
        

        for round_num in range(start_round, end_round + 1):
            self.run_single_round(round_num)

        print("\\nFederated Training Complete")