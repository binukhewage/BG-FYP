import torch
import torch.nn as nn

from federated.config import MODEL_TYPE


class LogisticRegressionModel(nn.Module):

    def __init__(self, input_dim):
        super().__init__()

        if MODEL_TYPE == "logistic":
            print("Using Logistic Regression (Linear Model)")

            self.net = nn.Linear(input_dim, 1)

        elif MODEL_TYPE == "mlp":
            print("Using MLP (Non-linear Model)")

            self.net = nn.Sequential(
                nn.Linear(input_dim, 64),
                nn.ReLU(),
                nn.Dropout(0.3),

                nn.Linear(64, 32),
                nn.ReLU(),
                nn.Dropout(0.3),

                nn.Linear(32, 1)
            )

        else:
            raise ValueError(f"Invalid MODEL_TYPE: {MODEL_TYPE}")

    def forward(self, x):
        return self.net(x)