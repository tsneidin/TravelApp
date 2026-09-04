# TravelApp — self-hosted travel planner

A Wanderlog-style travel planning app built from scratch, containerized and
deployed to Unraid via Docker Compose. Dark navy/cyan dashboard UI.

**Current version:** `0.0.25` — check the bottom of the left sidebar for the
live build. After any update, run **Update Stack** on Unraid and look for a
new version number to confirm the rebuild deployed.

## Version workflow
- The app version is baked into `frontend/src/lib/version.ts` and shown at the
  bottom of the left sidebar (and on the login page).
- Before committing/pushing a change, run `node scripts/bump.mjs` (patch by
  default; use `node scripts/bump.mjs minor` or `major` for those bumps). This
  rewrites `version.ts` so the next build carries a new visible version.

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

## Deploy on Unraid via Compose Manager

This repo is git-based and ships a root `docker-compose.yml`. On Unraid use the
**Compose Manager** plugin (Docker tab → **Compose**). The plugin's native
"Add New Stack" has a **Stack Directory** field you point at a copy of this
repo. (The "Pull from GitHub" field is hidden/unwired in this plugin fork, so
get the files on the server first — either way is fine below.)

### Option A — copy over SMB (no terminal)
1. On this Windows machine, copy the whole `TravelApp` folder to the Unraid
   appdata share: `\\TOWER\appdata\travelapp\repo` (via File Explorer).
2. In the `repo` folder, copy `.env.example` → `.env`, then edit `.env` in
   Notepad and set real values (see "Required .env values" below).
3. In Unraid **Docker → Compose**: **Add New Stack** → name `TravelApp`,
   **Stack Directory** = `/mnt/user/appdata/travelapp/repo`.
4. Click **Update Stack** (the refresh icon — *not* the Up arrow, which does
   not build). This runs `docker compose up -d --build`.
5. Open `http://192.168.86.86:8070`.

### Option B — git clone on the server (terminal)
```bash
mkdir -p /mnt/user/appdata/travelapp
git clone https://github.com/tsneidin/TravelApp.git /mnt/user/appdata/travelapp/repo
cd /mnt/user/appdata/travelapp/repo
cp .env.example .env
nano .env   # set real values (below), then Ctrl+O, Ctrl+X
```
Then follow steps 3–5 above (Add New Stack → Stack Directory
`/mnt/user/appdata/travelapp/repo` → **Update Stack**).

### Required .env values
```ini
POSTGRES_PASSWORD=change_me_strong_password
JWT_SECRET=somelongrandomstring-of-at-least-32-characters
PUBLIC_BASE_URL=http://192.168.86.86:8070
# Optional bootstrap admin (created on first boot if DB is empty):
BOOTSTRAP_EMAIL=you@example.com
BOOTSTRAP_PASSWORD=choose_a_password
# Optional email import — leave false until IMAP is configured:
EMAIL_ENABLED=false
# AI assistant — leave false until an OpenAI-compatible endpoint is set up:
AI_ENABLED=false
AI_BASE_URL=http://open-webui:8080   # Open WebUI on the LAN, or Ollama http://<host-ip>:11434
AI_MODEL=llama3
AI_API_KEY=
# Optional Google Places API (New), used for local recommendations:
GOOGLE_PLACES_API_KEY=
```
- Web UI: `http://192.168.86.86:8070`
- Data persists under `/mnt/user/appdata/travelapp/` (db, uploads)
- The API container runs `prisma db push` at startup, so a fresh clone needs no manual migrations.
- Use the per-stack **autostart** toggle to start TravelApp automatically when the array boots.

> **Note:** the `.env` file is gitignored — it never gets committed — and lives
> in the repo dir on the Unraid share rather than in git, so `git pull` to
> update code won't touch your secrets.

Connect via the existing **swag** reverse proxy or **cloudflared** tunnel later
for remote access.

## AI assistant setup
The chat panel (bottom-right floating button) is powered by any
**OpenAI-compatible** endpoint. Two common options on Unraid:

**Option A — Open WebUI** (you already have the container defined, just start it):
```
AI_ENABLED=true
AI_BASE_URL=http://open-webui:8080
AI_MODEL=<a model name available in Open WebUI, e.g. llama3>
AI_API_KEY=<your open-webui api key, optional>
```
Make sure `open-webui` is on the same Docker network as `travelapp-api` (e.g.
both on `travelapp`), or use `http://<host-ip>:8080`.

**Option B — Ollama on the Unraid host:**
```
AI_ENABLED=true
AI_BASE_URL=http://<unraid-ip>:11434
AI_MODEL=llama3
```

### What the assistant can do
- Answer questions about a trip (uses the current itinerary, bookings, budget).
- Parse booking confirmation emails you paste, show the proposed changes, and add them only after explicit confirmation
  (flights, hotels, car rentals, activities). The raw pasted text is retained —
  open a booking and click the document icon to view it.
- Propose places, expenses, bookings, and days, then require explicit confirmation before changing trip data.
- Suggest things to do / places to see for the destination, with **thumbnail,
  link, and one-tap "Add"** straight into the itinerary.
- Chat history is saved per trip and shown next time you open it.

> Chat happens per trip. Open a trip, then use the chat button at bottom-right.
> The page auto-refreshes when the assistant modifies the itinerary.
> Each itinerary item has an **edit / notes** button and a **map** button that
> jumps the Map tab to that location.

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

## Google API key test

After adding the keys to the root `.env`, run:

```bash
node scripts/test-google-apis.mjs
# Override the browser-key referrer when needed:
node scripts/test-google-apis.mjs --referrer http://192.168.86.86:8070/
```

The utility never displays the keys. The Places test requests one result using the same paid-tier fields used by AI Assist.

## Debug logging

Set `DEBUG_LOGGING=true` in the root `.env` and rebuild the API container. Structured JSON logs include HTTP status/duration, AI tool decisions, Google Places timing/result counts, cache use, and provider fallback errors. Secrets, authorization headers, request bodies, and pasted confirmation text are not logged.

```bash
docker logs -f travelapp-api
```

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