// src/lib/api.js

const API_URL = "https://127.0.0.1:8000";

/*
-----------------------------------
Start Federated Training
-----------------------------------
*/
export async function startFederation() {
  const res = await fetch(`${API_URL}/start-federation`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error("Failed to start federation");
  }

  return res.json();
}

/*
-----------------------------------
Onboard New Hospital
-----------------------------------
*/
export async function onboardHospital(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/onboard`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error("Failed to onboard hospital");
  }

  return res.json();
}

/*
-----------------------------------
Reset Federation (matches backend /reset)
-----------------------------------
*/
export async function resetFederation() {
  const res = await fetch(`${API_URL}/reset`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error("Failed to reset federation");
  }

  return res.json();
}

/*
-----------------------------------
Get Hospital Registry
-----------------------------------
*/
export async function getHospitals() {
  const res = await fetch(`${API_URL}/hospitals`);

  if (!res.ok) {
    throw new Error("Failed to fetch hospitals");
  }

  return res.json();
}