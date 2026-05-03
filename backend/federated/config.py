# Features
MODEL_FEATURES = [
    "age",
    "glucose",
    "creatinine",
    "WBC x 1000",
    "BUN"
]

TARGET_COLUMN       = "mortality"
PROTECTED_ATTRIBUTE = "is_senior"
INPUT_DIM           = len(MODEL_FEATURES)

# Model Selection : "mlp" or "logistic"
MODEL_TYPE = "logistic"       


# Training Settings
LOCAL_EPOCHS  = 15
LEARNING_RATE = 0.005
NUM_ROUNDS    = 20


# Fairness Settings
FAIRNESS_LAMBDA          = 10.0
FAIRNESS_LOSS_WEIGHT     = 1.0
BIAS_REJECTION_THRESHOLD = 0.5
FAIRNESS_PENALTY_MODE    = "inverse"


# Differential Privacy
DP_ENABLED  = True     
CLIP_VALUE  = 1.0
NOISE_SCALE = 0.5


# Legacy aliases
DP_SIGMA       = NOISE_SCALE
MAX_GRAD_NORM  = CLIP_VALUE