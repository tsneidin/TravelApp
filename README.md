# TravelApp — self-hosted travel planner

A Wanderlog-style travel planning app built from scratch, containerized and
deployed to Unraid via Docker Compose. Dark navy/cyan dashboard UI.

## Features
- Trips & day-by-day itineraries (drag-to-reorder places)
- Map view with route polyline (Leaflet + OpenStreetMap)
- Budget & expenses (currency, categories, totals)
- Photos & journal entries
- Packing checklists
- Bookings (manual + email-imported)
- Lightweight multi-user (owner / editor / viewer)
- Calendar view (global month-grid, click-to-add, drag-to-reschedule, bookings overlaid, iCal export)
- Email itinerary import (monitor a Gmail/Google Workspace inbox via IMAP + App Password)

## Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: Node 20 + Express + TypeScript + Prisma
- Database: PostgreSQL 16 (dedicated container)
- Maps: Leaflet + OpenStreetMap tiles

## Layout
```
backend/    Express API + Prisma schema + email worker
frontend/   React UI (nginx-served build)
docker-compose.yml
```

## Run locally (dev)
```bash
# 1. Provision Postgres (any local instance) and set backend/.env:
#    cp backend/.env.example backend/.env   # edit DATABASE_URL/JWT_SECRET

# 2. Backend
cd backend
npm install
npx prisma migrate dev --name init
npm run dev                # http://localhost:3000

# 3. Frontend
cd frontend
npm install
npm run dev                # http://localhost:5173  (proxies /api to 3000)
```

## Deploy on Unraid via Git (Compose Manager / Container Manager)

This repo is a git project. `docker-compose.yml` lives at the root, so Unraid's
**Compose Manager** (or Unraid 7 **Container Manager**) can clone it and bring
the stack up in one step.

1. Create the appdata directory on Unraid:
   `mkdir -p /mnt/user/appdata/travelapp`
2. Clone the repo (or point Compose Manager at the repo URL):
   ```bash
   git clone <your-repo-url> /mnt/user/appdata/travelapp/repo
   cd /mnt/user/appdata/travelapp/repo
   ```
3. Copy the template and edit real values:
   ```bash
   cp .env.example .env
   nano .env   # set POSTGRES_PASSWORD, JWT_SECRET, PUBLIC_BASE_URL, bootstrap admin, IMAP creds
   ```
4. Build & start:
   ```bash
   docker compose up -d --build
   ```
   - Web UI: `http://<unraid-ip>:8070`
   - Data persists under `/mnt/user/appdata/travelapp/` (db, uploads)
   - The API container runs `prisma db push` at startup, so a fresh clone needs no manual migrations.

> **Note:** the `.env` file is gitignored on purpose — it never gets committed,
> and it lives inside the cloned repo dir on the Unraid share rather than in the
> repo itself. Pull to update code without touching your secrets.

Connect via the existing **swag** reverse proxy or **cloudflared** tunnel later
for remote access.

## Email import setup
1. On your Gmail account (or Google Workspace admin for org mailboxes) enable:
   - IMAP under **Settings → See all settings → Forwarding and POP/IMAP**
   - **2-Step Verification**, then create an **App Password** (never use your
     normal login password).
2. Put the address + App Password + `EMAIL_ENABLED=true` in `backend/.env`
   (or the Compose env).
3. Forward booking confirmation emails to the monitored inbox, add senders to
   `EMAIL_ALLOWLIST` if wanted.
4. Imports appear under **Email imports** in the app for confirmation/assignment.

## Verification
```bash
# backend
cd backend
npm run lint
npm run typecheck
npm test

# frontend
cd frontend
npm run lint
npm run typecheck
npm run build
```