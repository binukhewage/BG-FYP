import os
import glob
import torch
import torch.nn as nn
import numpy as np
import pandas as pd
import random

def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)

    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

set_seed(42)

from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from federated.model import LogisticRegressionModel
from federated.config import (
    MODEL_FEATURES, TARGET_COLUMN, PROTECTED_ATTRIBUTE, INPUT_DIM,
    LEARNING_RATE,
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CENTRAL_MODEL_FILENAME = "centralized_model.pt"

import sys
import os



class CentralizedTrainer:
    """
    Centralised baseline for BiasGuard evaluation.

    Trains on all hospital CSVs pooled — no federation,
    no privacy. This is the theoretical upper bound.

    """

    def __init__(
        self,
        base_dir,
        epochs       = 200,
        lr           = None,
        val_split    = 0.20,
        random_state = 42,
    ):
        self.base_dir     = base_dir
        self.epochs       = epochs
        self.lr           = lr if lr is not None else LEARNING_RATE
        self.val_split    = val_split
        self.random_state = random_state

        # Paths
        self.hospitals_dir = os.path.join(base_dir, "data", "hospitals")
        self.model_path    = os.path.join(base_dir, "models", CENTRAL_MODEL_FILENAME)
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)

        # Model + preprocessing (fitted during train, reused in transform_test)
        self.model          = LogisticRegressionModel(INPUT_DIM).to(DEVICE)
        self._imputer       = None
        self._scaler        = None
        self.best_threshold = 0.5   # evaluate.py reads this via getattr

    # ── Load and pool all hospital data ───────────────────────
    def _load_all_hospitals(self):
        files = sorted(glob.glob(os.path.join(self.hospitals_dir, "hospital_*.csv")))
        if not files:
            raise FileNotFoundError(
                f"No hospital_*.csv files found in {self.hospitals_dir}.\n"
                f"Run prepare_data.py first."
            )

        dfs = [pd.read_csv(f) for f in files]
        df  = pd.concat(dfs, ignore_index=True)
        print(f"  Pooled {len(files)} hospitals → {len(df)} patients total")

        X    = df[MODEL_FEATURES].values
        y    = df[TARGET_COLUMN].values
        prot = df[PROTECTED_ATTRIBUTE].values
        return X, y, prot

    # ── Fairness helpers ──────────────────────────────────────
    @staticmethod
    def _dp_gap(preds, prot):
        s  = preds[prot == 1].mean() if (prot == 1).sum() > 0 else 0.0
        ns = preds[prot == 0].mean() if (prot == 0).sum() > 0 else 0.0
        return float(abs(s - ns))

    @staticmethod
    def _eo_gap(y_true, preds, prot):
        def tpr(mask):
            pos = (y_true[mask] == 1)
            if pos.sum() == 0: return 0.0
            return float((preds[mask][pos] == 1).mean())
        return float(abs(tpr(prot == 1) - tpr(prot == 0)))

    # ── Threshold search on validation set ───────────────────
    def _find_best_threshold(self, probs, y_true):
        """
        Find threshold that maximises F1 on validation set.
        Stored as self.best_threshold so evaluate.py can use it.
        """
        best_t, best_f1 = 0.5, 0.0
        for t in np.arange(0.3, 0.71, 0.01):
            preds = (probs >= t).astype(int)
            tp = ((preds == 1) & (y_true == 1)).sum()
            fp = ((preds == 1) & (y_true == 0)).sum()
            fn = ((preds == 0) & (y_true == 1)).sum()
            p  = tp / (tp + fp + 1e-8)
            r  = tp / (tp + fn + 1e-8)
            f1 = 2 * p * r / (p + r + 1e-8)
            if f1 > best_f1:
                best_f1 = f1
                best_t  = t
        return float(round(best_t, 2))

    # ── Main training ─────────────────────────────────────────
    def train(self):
        """
        Train centralised model on pooled hospital data.
        Returns dict with keys "auc", "dp", "eo" as expected
        by evaluate.py.
        """
        print("\n Centralised Model Training (Privacy-Violating Upper Bound)")
        print(f"  Architecture : {type(self.model.net).__name__}")
        print(f"  Epochs       : {self.epochs}")
        print(f"  Learning rate: {self.lr}")

        X, y, prot = self._load_all_hospitals()

        # Stratified split
        try:
            strat = [f"{a}_{b}" for a, b in zip(y, prot)]
            X_tr, X_val, y_tr, y_val, p_tr, p_val = train_test_split(
                X, y, prot,
                test_size=self.val_split, random_state=self.random_state,
                stratify=strat
            )
        except ValueError:
            X_tr, X_val, y_tr, y_val, p_tr, p_val = train_test_split(
                X, y, prot,
                test_size=self.val_split, random_state=self.random_state,
                stratify=y
            )

        print(f"  Train: {len(y_tr)} | Val: {len(y_val)}")
        print(f"  Mortality — Train: {y_tr.mean()*100:.1f}%  Val: {y_val.mean()*100:.1f}%")
        print(f"  Senior %  — Train: {p_tr.mean()*100:.1f}%  Val: {p_val.mean()*100:.1f}%")

        # Fit imputer + scaler on training data
        self._imputer = SimpleImputer(strategy="median")
        X_tr_i  = self._imputer.fit_transform(X_tr)
        X_val_i = self._imputer.transform(X_val)

        self._scaler = StandardScaler()
        X_tr_s  = self._scaler.fit_transform(X_tr_i)
        X_val_s = self._scaler.transform(X_val_i)

        # To tensors
        X_tr_t  = torch.tensor(X_tr_s,  dtype=torch.float32).to(DEVICE)
        X_val_t = torch.tensor(X_val_s, dtype=torch.float32).to(DEVICE)
        y_tr_t  = torch.tensor(y_tr,    dtype=torch.float32).unsqueeze(1).to(DEVICE)

        # Class-weighted BCE
        pos_w     = float((len(y_tr) - y_tr.sum()) / (y_tr.sum() + 1e-6)) 
        criterion = nn.BCEWithLogitsLoss(
            pos_weight=torch.tensor([pos_w]).to(DEVICE)
        )
        optimizer = torch.optim.Adam(
            self.model.parameters(), lr=0.005, weight_decay=1e-5
        )
        

        best_val_auc = 0.0
        best_state   = None
        patience     = 20
        no_improve   = 0

        self.model.train()
        for epoch in range(self.epochs):
            optimizer.zero_grad()
            loss = criterion(self.model(X_tr_t), y_tr_t)
            loss.backward()
            optimizer.step()
            

            if (epoch + 1) % 10 == 0:
                self.model.eval()
                with torch.no_grad():
                    val_probs = torch.sigmoid(self.model(X_val_t)).cpu().numpy().flatten()
                self.model.train()

                try:
                    val_auc = float(roc_auc_score(y_val, val_probs))
                except Exception:
                    val_auc = 0.5

                if val_auc > best_val_auc:
                    best_val_auc = val_auc
                    best_state   = {k: v.clone() for k, v in self.model.state_dict().items()}
                    no_improve   = 0
                else:
                    no_improve += 1

                # Optional logging
                if (epoch + 1) % 10 == 0:
                    print(f"  Epoch {epoch+1:>4}/{self.epochs} | Loss: {loss.item():.4f} | Val AUC: {val_auc:.3f}")

                if no_improve >= patience:
                    print(f"  Early stopping at epoch {epoch+1}")
                    break

        # Restore best checkpoint
        if best_state:
            self.model.load_state_dict(best_state)

        # Final validation metrics
        self.model.eval()
        with torch.no_grad():
            val_probs = torch.sigmoid(
                self.model(X_val_t)
            ).cpu().numpy().flatten()

        # Find best threshold
        self.best_threshold = self._find_best_threshold(val_probs, y_val)
        val_preds           = (val_probs >= self.best_threshold).astype(int)

        try:
            final_auc = float(roc_auc_score(y_val, val_probs))
        except Exception:
            final_auc = 0.5

        final_dp = self._dp_gap(val_preds, p_val)
        final_eo = self._eo_gap(y_val, val_preds, p_val)

        # Save model
        torch.save(self.model.state_dict(), self.model_path)

        print(f"\n  Centralised model saved → {self.model_path}")
        print(f"  Val AUC:  {final_auc:.3f}")
        print(f"  Best threshold: {self.best_threshold}")

        # Return dict with keys evaluate.py expects: "auc", "dp", "eo"
        return {
            "auc": final_auc,
            "dp":  final_dp,
            "eo":  final_eo,
        }

    # ── transform_test ────────────────────────────────────────
    def transform_test(self, df):
        """
        Apply the same imputer and scaler fitted during training
        to the test DataFrame. Returns scaled numpy array.

        Called by evaluate.py:
            X_scaled = central_trainer.transform_test(df)
        """
        if self._imputer is None or self._scaler is None:
            raise RuntimeError(
                "transform_test() called before train(). "
                "Call train() first so imputer and scaler are fitted."
            )
        X = df[MODEL_FEATURES].values
        X = self._imputer.transform(X)
        X = self._scaler.transform(X)
        return X