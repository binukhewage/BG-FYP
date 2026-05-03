import torch
import torch.nn as nn
import pandas as pd
import numpy as np

from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score

from federated.model import LogisticRegressionModel
from federated.config import (
    MODEL_FEATURES, TARGET_COLUMN, PROTECTED_ATTRIBUTE, INPUT_DIM,
    DP_ENABLED, CLIP_VALUE, NOISE_SCALE,
    LOCAL_EPOCHS, LEARNING_RATE,
    FAIRNESS_LOSS_WEIGHT
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class FederatedClient:

    def __init__(self, csv_path):
        self.csv_path = csv_path
        self.model    = LogisticRegressionModel(INPUT_DIM).to(DEVICE)

        
    # ---------------------------------------------------
    # Load + Preprocess Local Data
    # ---------------------------------------------------

    def load_data(self, val_split=0.15):
        df = pd.read_csv(self.csv_path)

        X_raw    = df[MODEL_FEATURES].values
        y_raw    = df[TARGET_COLUMN].values
        prot_raw = df[PROTECTED_ATTRIBUTE].values

        split = int(len(X_raw) * (1 - val_split))

        X_tr_raw,  X_val_raw  = X_raw[:split],   X_raw[split:]
        y_tr,      y_val      = y_raw[:split],    y_raw[split:]
        prot_tr,   prot_val   = prot_raw[:split], prot_raw[split:]

        imputer = SimpleImputer(strategy="median")                              #Preprocessing
        X_tr    = imputer.fit_transform(X_tr_raw)
        X_val   = imputer.transform(X_val_raw)

        scaler  = StandardScaler()                                             
        X_tr    = scaler.fit_transform(X_tr)
        X_val   = scaler.transform(X_val)

        X_tr  = torch.tensor(X_tr,  dtype=torch.float32).to(DEVICE)
        X_val = torch.tensor(X_val, dtype=torch.float32).to(DEVICE)
        y_tr  = torch.tensor(y_tr,  dtype=torch.float32).unsqueeze(1).to(DEVICE)
        y_val = torch.tensor(y_val, dtype=torch.float32).unsqueeze(1).to(DEVICE)

        return X_tr, y_tr, prot_tr, X_val, y_val, prot_val, split

    # ---------------------------------------------------
    # Train Local Model
    # ---------------------------------------------------
    
    def train(
        self,
        global_weights       = None,
        current_dp           = None,
        local_epochs         = None,
        learning_rate        = None,
        dp_enabled           = None,
        fairness_loss_weight = None
    ):
        if local_epochs         is None: local_epochs         = LOCAL_EPOCHS
        if learning_rate        is None: learning_rate        = LEARNING_RATE
        if dp_enabled           is None: dp_enabled           = DP_ENABLED
        if fairness_loss_weight is None: fairness_loss_weight = FAIRNESS_LOSS_WEIGHT

        print("DP INSIDE CLIENT:", dp_enabled)

        if global_weights is not None:
            self.model.load_state_dict(global_weights)                                 #Load latest global model weights from server

        X_tr, y_tr, prot_tr, X_val, y_val, prot_val, train_size = self.load_data()


        # Handle class imbalance
        
        pos_weight_value = (len(y_tr) - y_tr.sum()) / (y_tr.sum() + 1e-6)
        pos_weight       = torch.tensor([pos_weight_value]).to(DEVICE)

        criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

        optimizer = torch.optim.Adam(
            self.model.parameters(),
            lr=learning_rate,
            weight_decay=1e-4
        )

        senior_mask     = torch.tensor(prot_tr == 1, dtype=torch.bool).to(DEVICE)
        non_senior_mask = torch.tensor(prot_tr == 0, dtype=torch.bool).to(DEVICE)

                                                                                           # Adaptive fairness weight 
        if fairness_loss_weight > 0 and current_dp is not None:
            
            adaptive_weight = min(
                0.5 * fairness_loss_weight * (1.0 + current_dp),
                fairness_loss_weight * 1.5
            )
        else:
            adaptive_weight = 0.5 * fairness_loss_weight

        self.model.train()

        for _ in range(local_epochs):
            optimizer.zero_grad()

            outputs  = self.model(X_tr)
            bce_loss = criterion(outputs, y_tr)

            probs = torch.sigmoid(outputs)  

            def group_tpr(p, labels, mask):
                """
                Mean predicted probability for true positives
                in the masked group. Used as a differentiable
                proxy for TPR during training.
                """
                if mask.sum() == 0:
                    return torch.tensor(0.0, device=p.device)
                # Select positive (mortality=1) samples within group
                group_labels = labels[mask].squeeze()
                pos_mask     = (group_labels == 1)
                if pos_mask.sum() == 0:
                    return torch.tensor(0.0, device=p.device)
                return p[mask][pos_mask].mean()

            senior_tpr     = group_tpr(probs, y_tr, senior_mask)
            non_senior_tpr = group_tpr(probs, y_tr, non_senior_mask)
            eo_gap         = torch.abs(senior_tpr - non_senior_tpr)

            loss = bce_loss + adaptive_weight * eo_gap
            

            loss.backward()

                                                                                    # DP-SGD — gradient clipping + Gaussian noise
            if dp_enabled:
                torch.nn.utils.clip_grad_norm_(
                    self.model.parameters(),
                    CLIP_VALUE
                )
                for param in self.model.parameters():
                    if param.grad is not None:
                        noise = torch.normal(
                            mean=0.0,
                            std=NOISE_SCALE,
                            size=param.grad.shape
                        ).to(param.device)
                        param.grad += noise

            optimizer.step()

        metrics = self.evaluate(X_val, y_val, prot_val)
        metrics["train_samples"] = train_size

        return self.model.state_dict(), metrics

    def evaluate(self, X, y, protected):
        self.model.eval()

        with torch.no_grad():
            logits = self.model(X)
            probs  = torch.sigmoid(logits).cpu().numpy()
            preds  = (probs > 0.5).astype(int)

        y_true = y.cpu().numpy().flatten()

        try:
            auc = roc_auc_score(y_true, probs)
        except Exception:
            auc = 0.5

        senior_mask     = (protected == 1)
        non_senior_mask = (protected == 0)

        if senior_mask.sum() > 0 and non_senior_mask.sum() > 0:
            sr               = preds[senior_mask].mean()
            nr               = preds[non_senior_mask].mean()
            dp_gap_direction = sr - nr
            demographic_parity = abs(dp_gap_direction)
        else:
            sr = nr = dp_gap_direction = demographic_parity = 0.0

        def tpr(mask):
            positives = (y_true[mask] == 1)
            if positives.sum() == 0:
                return 0.0
            return float((preds[mask][positives] == 1).mean())

        eo = abs(tpr(senior_mask) - tpr(non_senior_mask))

        return {
            "auc":                      float(auc),
            "demographic_parity":       float(demographic_parity),
            "dp_gap_direction":         float(dp_gap_direction),
            "senior_positive_rate":     float(sr),
            "non_senior_positive_rate": float(nr),
            "equal_opportunity":        float(eo),
            "samples":                  len(y_true)
        }