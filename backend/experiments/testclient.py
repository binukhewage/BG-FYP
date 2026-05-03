from federated.client import FederatedClient

for i in range(1, 6):
    print(f"\nTesting Hospital {i}")
    client = FederatedClient(f"data/hospitals/hospital_{i}.csv")
    weights, metrics = client.train()
    print(metrics)