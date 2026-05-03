import os
import json
import shutil
import torch
import pandas as pd

from federated.client import FederatedClient
from federated.config import MODEL_FEATURES

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class HospitalOnboarding:

    def __init__(self, backend_dir):

        self.backend_dir = backend_dir

        self.registry_path = os.path.join(
            backend_dir, "data", "registry", "hospitals.json"
        )

        self.hospitals_dir = os.path.join(
            backend_dir, "data", "hospitals"
        )

    # ---------------------------------------------------
    # 1. Dataset Validation (FIXED)
    # ---------------------------------------------------
    def validate_dataset(self, csv_path):

        df = pd.read_csv(csv_path)

        # Ensure required MODEL features exist
        required_columns = MODEL_FEATURES + ["mortality"]

        for col in required_columns:
            if col not in df.columns:
                raise ValueError(f"Missing required column: {col}")

        # Ensure protected attribute exists
        if "is_senior" not in df.columns:
            raise ValueError("Missing protected attribute: is_senior")

        # Minimum size
        if len(df) < 200:
            raise ValueError("Dataset too small (<200 samples)")

        # Class balance
        if df["mortality"].nunique() < 2:
            raise ValueError("Dataset must contain both mortality classes")

        # Missing values
        missing_ratio = df.isnull().mean().mean()
        if missing_ratio > 0.30:
            raise ValueError("Too many missing values (>30%)")

        return True

    # ---------------------------------------------------
    # 2. Local Simulation (UNCHANGED)
    # ---------------------------------------------------
    def evaluate_hospital(self, csv_path, global_weights):

        client = FederatedClient(csv_path)

        weights, metrics = client.train(
            global_weights=global_weights
        )

        return metrics

    # ---------------------------------------------------
    # 3. Institutional Gate (IMPROVED)
    # ---------------------------------------------------
    def institutional_gate(
        self,
        metrics,
        min_auc=0.60,
        max_dp=0.60,   # stricter than before
        max_eo=0.60
    ):

        auc = metrics["auc"]
        dp = metrics["demographic_parity"]
        eo = metrics["equal_opportunity"]

        if auc < min_auc:
            return False, "Rejected: AUC below threshold"

        if dp > max_dp:
            return False, "Rejected: High demographic bias"

        if eo > max_eo:
            return False, "Rejected: High equal opportunity gap"

        return True, "Approved"

    # ---------------------------------------------------
    # 4. Registration (SAFE + ROBUST)
    # ---------------------------------------------------
    def register_hospital(self, csv_path):

        with open(self.registry_path, "r") as f:
            registry = json.load(f)

        hospitals = registry["hospitals"]

        # safe ID generation
        existing_ids = [h["id"] for h in hospitals]
        new_id = max(existing_ids) + 1 if existing_ids else 1

        filename = f"hospital_{new_id}.csv"
        destination = os.path.join(self.hospitals_dir, filename)

        shutil.copy(csv_path, destination)

        df = pd.read_csv(destination)

        new_entry = {
            "id": new_id,
            "file": filename,
            "patients": len(df),
            "avg_age": round(df["age"].mean(), 2),
            "active": True,
            "type": "onboarded"
        }

        hospitals.append(new_entry)

        with open(self.registry_path, "w") as f:
            json.dump(registry, f, indent=4)

        print(f"Hospital {new_id} successfully onboarded")

        return new_entry

    # ---------------------------------------------------
    # FULL PIPELINE (NEW - VERY IMPORTANT)
    # ---------------------------------------------------
    def onboard(self, csv_path, global_model):

        print("\nStarting Hospital Onboarding")

        # Step 1: Validate
        self.validate_dataset(csv_path)
        print("Dataset validation passed")

        # Step 2: Evaluate
        metrics = self.evaluate_hospital(
            csv_path,
            global_model.state_dict()
        )

        print(f"Evaluation Metrics: {metrics}")

        # Step 3: Gate check
        approved, message = self.institutional_gate(metrics)

        print(message)

        if not approved:
            return {
                "status": "rejected",
                "reason": message,
                "metrics": metrics
            }

        # Step 4: Register
        hospital = self.register_hospital(csv_path)

        return {
            "status": "approved",
            "hospital": hospital,
            "metrics": metrics
        }