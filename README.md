# How to Run the Project

## Backend

Open a terminal and run:

```bash
cd backend
uvicorn main:app --reload --ssl-keyfile=key.pem --ssl-certfile=cert.pem
```

Backend runs at:

- https://127.0.0.1:8000
- https://127.0.0.1:8000/docs

> If your browser shows a security warning, click **Advanced → Continue**.

---

## Frontend

Open another terminal and run:

```bash
cd frontend
npm run dev
```

Frontend runs at:

- http://localhost:3000

---

## Available Pages

- `/` - Main Dashboard
- `/wardview` - Ward Dashboard
- `/clinician` - Clinician Dashboard# BG-FYP
