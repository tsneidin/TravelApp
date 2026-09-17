# TravelApp — self-hosted travel planner

A Wanderlog-style travel planning app built from scratch, containerized and
deployed to Unraid via Docker Compose. Dark navy/cyan dashboard UI.

**Current version:** `0.0.166` — check the bottom of the left sidebar for the
live build. After any update, run **Update Stack** on Unraid and look for a
new version number to confirm the rebuild deployed.

## Version workflow
- The app version is baked into `frontend/src/lib/version.ts` and shown at the
  bottom of the left sidebar (and on the login page).
- Before committing/pushing a change, run `node scripts/bump.mjs` (patch by
  default; use `node scripts/bump.mjs minor` or `major` for those bumps). This
  rewrites `version.ts` so the next build carries a new visible version.

## Features
- Trips & day-by-day itineraries (drag-to-reorder places, day notes, calendar visibility controls)
- Interactive Google Maps overview with click-to-preview places with Google Maps and itinerary actions, official website import, pasted Google Maps URL support, uniquely numbered trip-wide itinerary pins, transportation-only route segments, photos, and item details
- Budget & expenses (currency, categories, totals, and editable notes)
- Persistent proxy-safe photo uploads, full-screen photo viewing, and editable journal entries, including day-level journal creation
- Packing checklists with editable items and categories
- Bookings (manual + email-imported) with multiple editable notes per booking
- Lightweight multi-user (owner / editor / viewer)
- Calendar view (global month-grid, click-to-add, drag-to-reschedule, bookings overlaid, iCal export)
- Email itinerary import (monitor a Gmail/Google Workspace inbox via IMAP + App Password)

## Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: Node 20 + Express + TypeScript + Prisma
- Database: PostgreSQL 16 (dedicated container)
- Maps: Google Maps JavaScript API and Google Places API

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
# Gmail imports are configured inside each user's account settings.
# AI assistant — leave false until an OpenAI-compatible endpoint is set up:
AI_ENABLED=false
AI_BASE_URL=http://open-webui:8080   # Open WebUI on the LAN, or Ollama http://<host-ip>:11434
AI_MODEL=llama3
AI_API_KEY=
# Optional Google Places API (New), used for local recommendations:
GOOGLE_PLACES_API_KEY=
VITE_GOOGLE_MAPS_API_KEY=
```
- Web UI: `http://192.168.86.86:8070`
- Data persists under `/mnt/user/appdata/travelapp/` (db, uploads)
- The API container runs `prisma db push` at startup, so a fresh clone needs no manual migrations.
- Use the per-stack **autostart** toggle to start TravelApp automatically when the array boots.

> **Note:** the `.env` file is gitignored — it never gets committed — and lives
> in the repo dir on the Unraid share rather than in git, so `git pull` to
> update code won't touch your secrets.

### Recover an admin account on an existing installation

`BOOTSTRAP_EMAIL` and `BOOTSTRAP_PASSWORD` only create an admin when the user
table is empty. Changing them later does not create a login or reset a password.
After putting the desired admin email and password in the root `.env` and running
**Update Stack**, run this once from the Unraid terminal:

```bash
docker exec travelapp-api node dist/src/scripts/recoverAdmin.js --confirm
```

This creates that admin if absent, or grants admin and resets the password if
the email already exists. It does not alter other users or trips. Log in with
the configured email and password, then remove `BOOTSTRAP_PASSWORD` from the
root `.env` and recreate the API container so the password is no longer held in
its environment.

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
Each user connects their own Gmail account in **Account Settings → Email
imports** or **Email inbox → Gmail settings**. For `name+trips@gmail.com`, enter
`name@gmail.com` as the Gmail account and the plus address as the import
address. The plus address is a filter, not a separate Gmail login.

1. Turn on **2-Step Verification** for the Google account and create a Gmail
   **App Password** at <https://myaccount.google.com/apppasswords>.
2. Enter the Gmail address, import address, and app password in TravelApp.
   Saving verifies the connection. The password is encrypted in the database
   using the server's `JWT_SECRET` and never returned to the browser. If that
   secret changes, enter the app password again.
3. Open **Email inbox**, use **Check now**, review a captured email, select an
   existing trip or **Create a new trip**, and choose **Approve and add**.
   Nothing is added to a trip before approval. Each user can see only their
   own captured emails. Unread-only checking is the default; the importer does
   not mark messages read.

**Reparse email** shows that it is working, then reports which parser found the
reservation and whether the details changed. KItinerary receives the full
original email on first capture and on reparse for newly captured messages.
Older emails are reparsed from saved HTML/text, while prior KItinerary results
are retained if present. If KItinerary finds no reservation or an incomplete
hotel stay, the configured AI
Assist model receives the email subject and plain text, including attached
forwarded emails and readable PDF attachments, and returns Schema.org
reservations for review. Enable AI Assist in app settings before importing;
emails remain in the review queue with an error if AI is unavailable. The AI
provider may be external, so choose its endpoint accordingly. Explicit
check-in and check-out lines override incorrect AI hotel dates; a focused AI retry
handles other incomplete hotel results. For an email already added to a trip,
reparse changes only the preview. Reparse can recover receipt text from saved
HTML or the original email when the earlier preview was blank. A labeled
Booking.com lodging receipt remains reviewable even if AI returns no booking;
the booking reference prevents a second copy of the confirmed stay when you
approve it into the same trip. **Apply dates to booking** updates the linked booking after
you review the newly extracted check-in and check-out dates.

For an upgrade from the former shared mailbox, keep the old `IMAP_USER` and
`EMAIL_RECIPIENT` values in the root `.env` for one deployment. When a user
connects that same Gmail account and import address, TravelApp moves the
unassigned captured emails into that user's review queue. The former
`IMAP_PASS` is no longer passed to the API container. After verifying the old
emails appear, remove the old email variables from `.env` and run **Update
Stack** again. Existing trip bookings remain unchanged.

The API image includes KDE KItinerary. It first extracts structured
reservations from incoming email and AI Assist attachments; AI Assist also tries
it on pasted confirmations. Email import uses the configured AI model when
KItinerary finds nothing or misses hotel dates. Email imports show every extracted reservation for
review before creating bookings. Cancellations are held for review rather than
created as new bookings. KItinerary runs locally in the API container.

To check ingestion on Unraid, open **Docker → travelapp-api → Logs**, or run
`docker logs --since 30m travelapp-api`. Each `[email] account=...` line gives
counts captured and skipped for that user without revealing the account name.
The log detail setting in Gmail settings adds per-message outcomes with masked
addresses. The **Email inbox** page also shows the last check and any error.

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

Browser regression checks use sample API responses and do not require a live database:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
# Or use an installed Google Chrome:
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

The suite covers desktop, phone, and small-phone layouts, date display in Central
Time, dialog keyboard navigation, recoverable form errors, and populated trip
sections. Google Maps rendering and live integrations require separate checks
with a configured API and database.

## Place search and clock preference

The itinerary item form combines title entry and place search. Select a result
to fill the address, category, coordinates, and available website, or keep a
manual title. Google Maps URLs can also be pasted into this field.

Normal place searches use Google's Places Text Search API and require
`GOOGLE_PLACES_API_KEY`. If Google search is unavailable, travelers can still
enter place details manually. Google API results can differ from the consumer
Google Maps app.

Set **Account & Member Settings → Profile → Time format** to **12-hour** or
**24-hour**, then save. This preference is stored with the user account and
applies to itinerary, map, booking, timeline, and other timestamp displays.
Time entry uses a single clock field such as `1:05 PM` or `13:05`, with
separately sized desktop and mobile controls.
