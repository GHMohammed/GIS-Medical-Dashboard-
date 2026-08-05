<div align="center">

# Syria Medical GIS Dashboard
### لوحة المراقبة الطبية الجغرافية في سوريا

**A live geographic operations room for Syrian medical response — hospitals, ambulances, emergencies and dispatch, in real time.**

![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TanStack Start](https://img.shields.io/badge/TanStack_Start-SSR-FF4154?logo=react-query&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![PostgreSQL + PostGIS](https://img.shields.io/badge/PostgreSQL_15-PostGIS_3.3-4169E1?logo=postgresql&logoColor=white)
![i18n](https://img.shields.io/badge/i18n-AR%20(RTL)%20%2F%20EN-2E7D32)

</div>

---

## Overview

A presentation-ready proof of concept for a Syrian medical operations room. It presents a live GIS map of medical facilities, the ambulance fleet and emergency incidents, with database-driven dispatch routing, hospital occupancy monitoring, historical replay, and full **Arabic (default, RTL)** / **English (LTR)** support.

> **Design principle:** the browser never computes distances, never picks an ambulance, and never derives occupancy status. It reads database views, calls RPCs, and renders. All authoritative logic lives in PostgreSQL/PostGIS.

---

## Key Features

- 🗺️ **Live GIS map** — Leaflet with marker clustering, status-colored facilities, moving ambulances and drawn dispatch routes.
- 🚑 **Database-driven dispatch** — PostgreSQL selects and locks the nearest available ambulance; failures are surfaced with distinct, explicit messages.
- 🏥 **Occupancy monitoring** — GREEN/RED hospital status computed by a database trigger (`> 90%` is RED).
- 📡 **Realtime resync** — a single Supabase realtime channel used purely as an invalidation signal; the dashboard always re-reads the authoritative snapshot, so a dropped connection can never leave stale data on screen.
- 🕓 **Historical replay** — pick any past timestamp and render a point-in-time snapshot; live actions are disabled and live/past data are never mixed.
- 🔁 **Built-in simulator** — a `pg_cron` job animates the fleet, occupancy and incidents every 5 seconds for a self-driving demo.
- 🌍 **Full bilingual UI** — Arabic-first RTL / English LTR with locale-aware numbers and dates.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| UI | React 19, TanStack Router / Start (SSR), Vite 8, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (Radix primitives), Lucide icons |
| Mapping | Leaflet, react-leaflet, react-leaflet-cluster |
| Data / state | TanStack Query, Supabase JS client |
| Backend | PostgreSQL 15 + PostGIS 3.3, Supabase (Realtime, RPC, RLS) |
| i18n | Custom lightweight provider (Arabic RTL default + English LTR) |

> **Build note:** the Vite/SSR toolchain is bundled through `@lovable.dev/vite-tanstack-config` (see `vite.config.ts`). This single package wires TanStack Start, Nitro, Tailwind, path aliases and env injection, and is required for the project to build and run.

---

## Architecture

```text
React 19 + TanStack Start (Vite 8, SSR)
├─ src/routes/index.tsx            Dashboard: KPIs, filters, map, ops panel, alerts
├─ src/routes/__root.tsx           Root shell, error/404 boundaries, providers
├─ src/components/map/             Leaflet map (client-only): markers, clustering, route lines
├─ src/services/                   The ONLY layer that talks to the database
│   ├─ medical.service.ts            views → typed rows + dashboard snapshot
│   ├─ dispatch.service.ts           process_emergency_routing / complete_dispatch
│   ├─ history.service.ts            get_historical_snapshot
│   └─ simulator.service.ts          read + toggle the simulator
├─ src/hooks/useMedicalRealtime.ts  one shared channel, visible status, full resync on reconnect
├─ src/i18n/                       Arabic default + English, RTL/LTR, locale-aware formatting
└─ src/types/medical.ts            Row and RPC payload contracts
        │
PostgreSQL 15 + PostGIS 3.3 (Supabase)
└─ supabase/migrations/           Schema, triggers, views, RPCs, simulator
```

### Data flow at a glance

| Capability | Where the logic lives |
| --- | --- |
| Facility / ambulance / incident geometry | PostGIS `geography(Point,4326)` columns |
| Map-ready coordinates | SQL views (`*_map`) exposing `ST_X` / `ST_Y` as plain numbers |
| Occupancy status (GREEN / RED) | `calculate_facility_status()` trigger — **`> 90%` is RED, exactly `90%` stays GREEN** |
| Nearest-ambulance dispatch | `process_emergency_routing()` RPC (PostgreSQL chooses and locks the ambulance) |
| Dispatch completion | `complete_dispatch()` RPC |
| Historical replay | `get_historical_snapshot(timestamptz)` RPC over the history tables |
| Alerts | Triggers on high occupancy, new emergencies and dispatch events |
| Continuous movement | `simulate_tick()` scheduled by `pg_cron` every 5 seconds |

---

## Getting Started

### Prerequisites

- **Node.js 20+** (or **Bun 1.1+**, matching the committed `bun.lock`)
- A **Supabase / PostgreSQL 15 + PostGIS** project

### 1. Install dependencies

```bash
npm install
# or
bun install
```

### 2. Configure environment

Create a `.env` file in the project root (only the publishable/anon key ever reaches the browser):

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_SUPABASE_PROJECT_ID=<your-project-id>
```

### 3. Apply the database

Run the SQL in `supabase/migrations/` in filename (timestamp) order against your Supabase/PostgreSQL project.

### 4. Run

```bash
npm run dev      # start the dev server
npm run build    # production build
npm run preview  # preview the production build
npm run lint     # ESLint
npm run format   # Prettier
```

---

## Database

**Core tables:** `medical_facilities`, `ambulances`, `emergency_incidents`, `dispatch_assignments`, `alerts`.

**History tables:** `ambulance_location_history`, `facility_occupancy_history` — written automatically by triggers on every update.

**Views consumed by the UI:** `medical_facilities_map`, `ambulances_map`, `emergency_incidents_map`, `dispatch_assignments_details`.

### Occupancy rule

```
occupancy_rate = occupied_beds / total_beds * 100

rate > 90   →  RED
rate <= 90  →  GREEN
```

The demo data deliberately includes a facility at exactly `90.00%` (`مشفى دمشق المركزي`) that must render **GREEN**, and facilities at `91.43 / 92.00 / 94.29%` that must render **RED** — a built-in check that the boundary is enforced in the database, not the UI.

---

## The Simulator

`public.simulate_tick()` runs every 5 seconds via `pg_cron` (job `syria-gis-simulator`). On each tick it:

1. moves every in-service ambulance a small random step and varies speed/heading (writing location history and emitting realtime events);
2. nudges one random facility's occupancy by −3..+3 beds, re-evaluating GREEN/RED and firing high-occupancy alerts;
3. with ~18% probability creates a new active emergency near a facility (capped at 8 active incidents);
4. with ~15% probability completes an older open dispatch, freeing its ambulance;
5. prunes history and alerts older than two hours so the demo database stays small.

Toggle it from the dashboard header, or from SQL:

```sql
select public.set_simulator_enabled(false);  -- pause
select public.set_simulator_enabled(true);   -- resume
select * from public.simulator_settings;     -- enabled, last_tick_at, tick_count
```

---

## Operating Modes

**Live mode (default):** realtime channel active; dispatch and alert actions enabled. Connection state is always visible in the header (connecting / connected / reconnecting / disconnected).

**Historical mode:** pick a date and time and press load. The dashboard renders the `get_historical_snapshot` result only — realtime is unsubscribed, and dispatch/completion/alert actions are hidden. A persistent banner shows the snapshot timestamp with one-click return to live.

---

## Dispatch Flow

1. Select an active emergency in the operations panel.
2. Choose a receiving hospital (list is sorted by free beds).
3. Press dispatch — the button is disabled while in flight and until a hospital is chosen, so an operator cannot submit twice.
4. `process_emergency_routing()` locks the nearest available ambulance, writes the dispatch row, updates ambulance and emergency status, and raises alerts.
5. The map draws ambulance → incident (blue) and incident → hospital (green) legs, and the result strip shows plate, hospital and distance.

Failure cases are surfaced explicitly: **no available ambulance**, **emergency no longer active**, **not found**, **validation** and **network** errors each get their own message.

---

## Security

- Only the **publishable (anon) key** ever reaches browser code, via `VITE_SUPABASE_PUBLISHABLE_KEY`. There is no service-role key in the frontend.
- **Row Level Security** is enabled on every public table. This PoC has no sign-in, so each table carries a single read-only policy for `anon` / `authenticated`.
- All mutations go through `SECURITY DEFINER` RPCs — no table accepts a direct client write.
- `simulate_tick()` is not callable by `anon`; only the scheduler runs it.

---

## Demo Script (≈3 minutes)

1. Open the dashboard in Arabic — note the RTL layout, KPI row, and the green "connected" indicator.
2. Watch ambulances drift and occupancy KPIs change without any refresh.
3. Filter by governorate and by RED status; click a facility to fly the map to it.
4. Open the emergencies tab, pick an incident, choose a hospital and dispatch — show the assigned plate, the two route legs, and the new alert.
5. Complete the dispatch and show the ambulance returning to available.
6. Switch to English (LTR), then load a historical snapshot from 10 minutes ago — point out that dispatch is disabled and the banner is visible.
7. Return to live mode.

---

## Project Status

Proof of Concept — presentation-ready. Not hardened for production authentication, multi-tenant access control, or high-availability deployment.
