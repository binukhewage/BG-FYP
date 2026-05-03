import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import roc_curve, auc

np.random.seed(42)

# Example binary labels
y_true = np.random.randint(0, 2, 500)

# Simulated prediction probabilities
fedavg_probs = np.random.rand(500)
biasguard_probs = np.random.rand(500)

# -------------------------------------------------
# ROC Calculations
# -------------------------------------------------
fpr_fed, tpr_fed, _ = roc_curve(y_true, fedavg_probs)
roc_auc_fed = auc(fpr_fed, tpr_fed)

fpr_bg, tpr_bg, _ = roc_curve(y_true, biasguard_probs)
roc_auc_bg = auc(fpr_bg, tpr_bg)

# -------------------------------------------------
# Create 2 Separate Charts
# -------------------------------------------------

# Chart 1 - FedAvg ROC
plt.figure(figsize=(7,5))
plt.plot(fpr_fed, tpr_fed, linewidth=2, label=f"FedAvg (AUC = {roc_auc_fed:.4f})")
plt.plot([0,1], [0,1], linestyle="--", linewidth=1)
plt.xlabel("False Positive Rate")
plt.ylabel("True Positive Rate")
plt.title("ROC Curve - FedAvg")
plt.legend(loc="lower right")
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()

# Chart 2 - BiasGuard ROC
plt.figure(figsize=(7,5))
plt.plot(fpr_bg, tpr_bg, linewidth=2, label=f"BiasGuard (AUC = {roc_auc_bg:.4f})")
plt.plot([0,1], [0,1], linestyle="--", linewidth=1)
plt.xlabel("False Positive Rate")
plt.ylabel("True Positive Rate")
plt.title("ROC Curve - BiasGuard")
plt.legend(loc="lower right")
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()