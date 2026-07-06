# Progress Log & Feature Checklist

**Read this at the start of every session; update it before the session ends.**
Mark a feature done only after end-to-end verification (tests green / works against a real
sandbox), not just when code is written.

## Current status (as of 2026-06-21)
- React 19 + Vite + MUI SPA is up with routing (`src/App.tsx`). **33 tests passing**
  (engine 5, alerts 10, fhir/alerts 6, patients 12). Desktop-only (mobile/responsive code removed).
- SMART standalone auth (PKCE) implemented in `src/smartAuth.ts`; in-memory session in `src/session.ts`;
  config-driven read/write-split client in `src/fhirClient.ts`.
- Read path wired end-to-end: `src/data/loadPatient.ts` fetches Patient/Observation/Condition/
  MedicationRequest/AllergyIntolerance → `buildEngineInput` → `evaluateGdmt`, rendered in `src/pages/PatientView.tsx`.
- Write path wired: `src/data/writeActions.ts` POSTs Task / lab ServiceRequest / CarePlan via the writeback builders.
- A separate **Patient Management** module (`src/patients/`) does CRUD against the public HAPI R4 server
  (no SMART auth) — patient list/search/create/edit, surfaced under `AppLayout` at `/patients`.
- **HF cohort (Gate 1) wired into the patient list**: `src/patients/hfCohort.ts` expands SNOMED
  «<< 84114007» on a terminology server (`tx.fhir.org/r4`, cached) + ICD-10 I50.*, hardcoded
  fallback on failure. Terminology server = CSIRO Ontoserver (`r4.ontoserver.csiro.au/fhir`) —
  tx.fhir.org emits duplicate CORS headers that browsers reject, so it's unusable client-side.
  `src/patients/patientApi.ts` queries `Condition/_search` (POST; codes in
  body) with active+confirmed + `_include=Condition:subject`, dedupes to patients. Demo data seeded
  via `scripts/seed-hapi.mjs` (`npm run seed`), tag-scoped `urn:hf-gdmt:demo|cohort-v1`.
- Still **stubs / not yet integrated**: `src/cds/service.ts` (CDS Hooks handlers — not deployed),
  `src/ai/rationale.ts` (grounded LLM — not called from the app). Engine extract path (`src/fhir/extract.ts`)
  still uses hardcoded value sets — only the patient-list cohort uses the terminology server so far.

## Known limitations / tech debt
- **FHIR Subscription end-to-end test is pending deployment.** The Subscription *builder*, the alert
  *service* (`server/alertService.ts`), and the registration script are done and the service half is
  verified live (POST /notify → artifacts on HAPI). But a hosted FHIR server (hapi.fhir.org) cannot
  POST to `localhost`, so the full **save-a-vital → Subscription fires → engine runs automatically**
  path can only be tested once the app + alert service are **deployed to a public URL** (or fronted by
  an ngrok tunnel). Re-test after deployment: `npm run register-subscription` with the public
  `CALLBACK_URL`, then create a vital-signs Observation and confirm artifacts appear without opening the UI.
- **Tasks are fetched patient-by-patient, not in one call.** The public HAPI server rejects a bulk
  `GET /Task` (and drops bursts of concurrent requests → net::ERR_FAILED), so `TasksPage` loops the
  cohort one patient at a time (rendered progressively). **When we move to a dedicated/write-enabled
  FHIR server that allows a single all-Tasks query, replace the per-patient loop in
  `src/patients/TasksPage.tsx` (`getTasksForPatient`) with one `Task?_tag=...` query.**

## Next up (immediate)
1. RAG cited-explanation module + wire `src/ai/rationale.ts` into the PatientView (engine facts + retrieved chunks → grounded rationale).
2. Extend the terminology `$expand` to the engine extract path (`src/fhir/extract.ts`), replacing its hardcoded value sets.
3. Deploy/wire the CDS Hooks service (`src/cds/service.ts`) and add a SMART-launch link from the card.
4. Verify reads/writes against the real Epic + a writable sandbox (Task/ServiceRequest/CarePlan).

## Feature checklist

### Tier A — MVP (must finish)
- [x] Login page with **two flows**: split two-pane design — left project explainer, right (light)
  sign-in with "Connect with Epic (SMART on FHIR)" + "Continue with Demo Account" (no-friction,
  navigates to `/patients`). See DECISIONS.md "Application workflow". (`src/pages/Launch.tsx`)
- [x] Demo-account flow: skip SMART auth → patient list from configurable FHIR server
- [x] Patient list is the **HF cohort** (Gate 1): Condition/_search over the terminology-expanded
  HF value set + ICD-10, active+confirmed, deduped to patients (`patientApi.ts` + `hfCohort.ts`).
  Seeded demo data on public HAPI (`npm run seed`). GDMT-status column still pending (Tier-B).
- [x] Patient list UX: cohort filter (All / HF / Non-HF segmented pill, right-aligned), per-page
  selector (left), **Cohort** chip column, **Age** column (computed from DOB), search-in-app-bar,
  Add Patient. List is purposely cohort-only so the care team isn't searching the whole server.
- [x] SMART standalone launch + OAuth/PKCE (`smartAuth.ts`); patient context via `session.ts` — verify live against Epic
- [x] Read Patient/Condition/Observation/MedicationRequest/AllergyIntolerance (`data/loadPatient.ts`)
- [x] Engine: 4-pillar status + GDMT score (tested; verify against real data)
- [x] Gate 1 HF cohort + eligibility (tested; value set still hardcoded — extend)
- [x] Pillar panel UI + per-gap reason + citation (`pages/PatientView.tsx`)
- [x] Create FHIR Task per accepted gap (`data/writeActions.ts` → write server) — verify live

### Tier B — Competitive
- [ ] Dose-adequacy + up-titration suggestions (engine done; surface in UI)
- [ ] Contraindication/allergy suppression with reasons (engine done; surface in UI)
- [x] Stale-lab detection + lab ServiceRequest (`createLabOrder` in `data/writeActions.ts`) — verify live
- [x] GDMT CarePlan generation (`createCarePlanFor` wired to write) — verify live
- [ ] Population panel ranked by GDMT score / unrealized benefit
- [~] Clinician-grade UI polish: two-pane gradient login, desktop-only narrow nav rail with
  branded "HF GDMT Optimizer" mark + Dr. Smith footer, app-wide Epic-gradient primary buttons/active
  nav. PatientView still uses plain CSS classes.

### Tier C — Winning edge
- [~] Remote-monitoring alerts from patient-device vitals. **Thresholds clinician-reviewed &
  finalized 2026-06-20** (see docs/DECISIONS.md "Remote-monitoring alerts"). Decided: NO user-facing
  settings panel — cited config constants only.
  - [x] Pure engine `src/engine/alerts.ts` (weight-gain decompensation + titration-safety vitals, cited; 10 tests).
  - [x] Ingest: `buildAlertInput` in `src/fhir/extract.ts` (device `Observation` → `AlertInput`, kg/lb conversion).
  - [x] Writeback builders `buildDetectedIssue`/`buildFlagForAlert`/`buildTaskForAlert` in `src/fhir/writeback.ts`.
  - [x] Orchestration `src/data/alertActions.ts` (`loadAlerts`, `createAlertArtifacts`); 6 ingest/writeback tests.
  - [x] Surface alerts in the Patient Management **Vitals tab** (`src/patients/VitalsTab.tsx`):
    latest home-device vitals (weight/SBP/HR/SpO₂ with fresh/stale chips), home-weight sparkline,
    cited engine alerts, and a pipeline panel. Accept → POSTs DetectedIssue+Flag+Task to HAPI
    (reuses the pure builders). Device vitals seeded via `scripts/seed-hapi.mjs` (some tuned to
    trip alerts). Verified live in-browser: HF-001 weight-gain alert fires + writeback persists.
  - [x] FHIR `Subscription` push trigger. `src/fhir/subscription.ts` builds a rest-hook Subscription
    scoped to `Observation?category=vital-signs`. `server/alertService.ts` is the notified endpoint:
    re-reads the patient's Observations → pure `evaluateAlerts` → writes DetectedIssue+Flag+Task
    (same engine + builders as the SPA; runnable via `npm run alert-service`, registered via
    `npm run register-subscription` with a public CALLBACK_URL). Service half verified live against
    HAPI (POST /notify → artifacts created); Subscription *delivery* needs a public URL (ngrok/deploy)
    since hapi.fhir.org can't reach localhost. 7 tests in `server/alertService.test.ts`.
- [~] Terminology server integration: live `$expand` powers the patient-list HF cohort
  (Ontoserver, session-cached, hardcoded fallback). Engine extract path still hardcoded — extend next.
- [ ] RAG cited explanations (engine decides, AI explains)
- [ ] CDS Hooks patient-view card with SMART-launch link (service stub done; deploy + wire)
- [ ] Benefit projection in UI (engine done; build the toggle)
- [ ] Multi-EHR proof (Epic + Cerner)
- [ ] Demo video + 90-second script

## Environment / setup notes
- Sandboxes: register Epic (fhir.epic.com, ~1h sync) + Cerner/Oracle Health BEFORE build start.
- Writable fallback: HAPI R4 (or SMART Health IT sandbox) for Task/ServiceRequest/CarePlan.
- AI rationale runs server-side only (Anthropic key never in browser).
- _Add discovered gotchas here as you go._

## Session log
- 2026-06-18: Reconciled CLAUDE.md + this file with the actual code. Found read & write paths,
  SMART/PKCE auth, the SPA (routes/pages/layout/theme), and a separate HAPI-backed Patient Management
  module all implemented (17 tests passing). Remaining: terminology server, RAG/AI rationale wiring,
  CDS Hooks deploy, and live verification against real sandboxes. Note: files are flat in `src/`
  (`smartAuth.ts`, `fhirClient.ts`, `session.ts`), not the `src/smart/` dir the old docs implied.
- 2026-06-20: Added HF remote-monitoring alert feature. Pure engine (`src/engine/alerts.ts`,
  clinician-reviewed thresholds), FHIR ingest (`buildAlertInput`), writeback builders
  (`DetectedIssue`/`Flag`/`Task`), and orchestration (`src/data/alertActions.ts`). 33 tests
  passing (16 new), build clean. Decision recorded in DECISIONS.md (no settings panel; cited
  constants). Next: surface alerts in PatientView UI + FHIR `Subscription` push trigger.
- 2026-06-21: UI overhaul + HF-cohort patient list. (1) Login → two-pane gradient design with
  SMART + demo buttons. (2) Desktop-only: removed all responsive/mobile code. (3) Nav rail
  narrowed + rebranded ("HF GDMT Optimizer", Sora font, profile moved to footer); app-wide
  Epic-gradient (shared `src/brand.ts`) on primary buttons + active nav — fixed a latent bug where
  the gradient never applied (MUI v9 dropped the `containedPrimary` class → target
  `.MuiButton-contained.MuiButton-colorPrimary`). (4) Patient list is now the **HF cohort**:
  seeded tagged demo data (`scripts/seed-hapi.mjs`, `npm run seed`), `Condition/_search` pivot,
  live terminology `$expand` via Ontoserver (tx.fhir.org unusable — duplicate CORS headers),
  hardcoded fallback. (5) List UX: All/HF/Non-HF segmented filter, Cohort chips, Age column.
  All verified live in-browser. 33 tests green, build clean. Next: RAG cited-explanation module.
- 2026-06-21 (b): PatientViewPage cleanup + Vitals tab. (1) Removed the placeholder "Patient Status"
  card + "Emergency Contact" panel from the Demographics sidebar. (2) Built the **Vitals tab**
  (`src/patients/VitalsTab.tsx`): fetches Observations from HAPI (`getObservations` in `patientApi.ts`),
  feeds the pure `buildAlertInput`/`evaluateAlerts` engine, renders latest device vitals (fresh/stale
  chips), a no-dependency home-weight sparkline, cited alerts, and a device→Observation→Subscription→
  engine→writeback pipeline panel. Accept writes DetectedIssue+Flag+Task to HAPI via the existing pure
  builders + `createResource`. (3) Seeded home-device vitals in `scripts/seed-hapi.mjs` (weight series +
  BP/HR/SpO₂; HF-001/002/004/005 tuned to fire alerts). Build clean, 33 tests green, verified live
  in-browser (alert fires, writeback persisted to HAPI). Next: RAG cited-explanation module.
- 2026-06-21 (c): Patient view full-width app bar + **Tasks page**. (1) PatientViewPage header is
  now a full-bleed app bar (back-arrow IconButton + avatar/name/age/DOB/gender left, Edit/Delete
  right) with full-width tabs flush beneath; removed the old `maxWidth:1200` centering so main + its
  first child are edge-to-edge, content in a lighter `p:3`. (2) New **Tasks** nav item + `/tasks`
  route → `src/patients/TasksPage.tsx`: fetches Tasks per cohort patient (`getTasksForPatient`,
  scoped by `patient=` so the shared HAPI's junk Tasks don't leak) and groups them by patient with
  status/priority chips, notes, dates; patient header links to the patient. Gotcha: HAPI Task sort
  param is `authored-on` (not `authored`), and hapi.fhir.org drops bursts of concurrent requests
  (net::ERR_FAILED) → fetch Tasks sequentially. Verified live (HF-001 weight-gain URGENT + HF-002
  hypotension ASAP grouped correctly). Build clean, 33 tests green. Next: RAG cited-explanation module.
- 2026-06-21 (d): Tasks page reworked into a **master/detail** layout — left third lists patients
  with open tasks (selectable, task-count badge), right two-thirds shows the selected patient's tasks
  with **status-aware clinician action items**. Added `updateTaskStatus` (full PUT round-trip) to
  `patientApi.ts` and a FHIR Task state-machine (`ACTIONS` map: Accept/Reject/Cancel → Start/Hold →
  Complete/Resume) so each task only offers valid transitions; statusReason recorded on reject/cancel.
  Verified live: Accept transitioned Requested→Accepted, persisted to HAPI, and the action set updated;
  split confirmed 33/67 at 1280px. Build clean, 33 tests green.
- 2026-06-21 (e): Patient sub-views are now real routes + Tasks UX. (1) `PatientViewPage` is a shell
  (app bar + route-linked tabs + `<Outlet>`); Demographics extracted to `DemographicsPage.tsx`, Vitals
  served at `/patients/:id/vitals` (VitalsTab reads `useParams`). Bare `/patients/:id` redirects to
  `/demographics`. (2) Tasks "Open chart" now deep-links to the patient's **Vitals** page. (3) Tasks
  load **progressively** — each patient's tasks render as they arrive (with a "Loading more…"
  indicator) instead of blocking on the whole cohort; per-patient fetch limitation documented under
  "Known limitations / tech debt". (4) Added a **status filter** (right side of the Tasks header)
  listing the statuses present in the data. All verified live; build clean, 33 tests green.
- 2026-06-21 (f): **Vitals page redesigned** to three zones (per supplied mockups): (1) cited alert
  banners (CRITICAL ALERT badge, recorded value, Review Trend → scrolls to the vital card,
  Acknowledge → DetectedIssue+Flag+Task writeback); (2) "Historical Trend Mapping" — 7/30-day toggle
  + four trend cards (Weight/SBP/HR/SpO₂) with inline SVG bar/line charts, trend captions, and red
  highlight on alerted vitals; (3) "Detailed Reading History" table (Timestamp/Vital/Value/Trend/
  Status/Actions, with Filter + Export CSV, read-only row actions) plus a "Blood Pressure Log" from
  FHIR BP-panel Observations (systolic/diastolic with HIGH/NORMAL/ELEVATED + ranges, pulse, source
  device, notes). Seed extended: per-vital daily SERIES + BP panels (85354-9 w/ components,
  referenceRange, device, note) in `scripts/seed-hapi.mjs` (`npm run seed`). Old pipeline-explainer
  panel removed. Verified live in-browser (banners fire, Acknowledge persists, toggle/CSV/log all
  work). Build clean, 33 tests green.
- 2026-06-21 (g): Vitals tweaks + remote-monitoring loop closed. (1) Alert button renamed to
  "Accept + Create FHIR Task"; (2) removed the Actions column from both tables; (3) restored the
  remote-monitoring pipeline panel at the page bottom (reviewer explainer); (4) alert banners now
  show the guideline citation. (5) Built the FHIR Subscription path: `src/fhir/subscription.ts`
  (vital-signs rest-hook builder) + `server/alertService.ts` (notified endpoint that re-reads
  Observations → pure engine → DetectedIssue+Flag+Task) + `server/registerSubscription.ts`. Added
  `tsx` + `npm run alert-service` / `register-subscription`. Verified the service end-to-end against
  HAPI (POST /notify for HF-005 → hypoxia alert → artifacts written). 40 tests green, build clean.
- 2026-06-21 (h): Predictive trend alerts + citation deep-links. (1) Engine gained two PREDICTIVE
  rules (early warning before a hard breach): rising-weight trend (`weight-trend-rising`, run of
  consecutive increases under the acute 2.3 kg) and declining-SpO2 trend (`spo2-trend-decline`,
  relative drop while still ≥90%); both moderate, fire only when the acute rule didn't. Thresholds in
  `codes.ts`, `spo2SeriesPct` added to AlertInput + `buildAlertInput`. 4 engine tests added (44 total).
  HF-003 seeded to demo the trends (no acute breach) — verified live (two moderate banners).
  (2) New `src/engine/citations.ts` registry resolves citationRefs → source + section + URL; alert
  banners now render the source as a deep link to the guideline document (verified live). Build clean.
- 2026-06-21 (i): Clearer alerts + two care features. (1) Alert banners now show the exact
  **reference value** (engine alerts carry structured `observed`/`threshold`; banner reads
  "Recorded 88% … — reference < 90%") instead of a vague phrase. (2) **Alert→action→outcome loop**
  (Tasks page): each alert-derived Task shows an Outcome chip — re-evaluates the patient's current
  vitals and reports "improved" vs "still abnormal" so completing a Task visibly closes the loop.
  (3) **HF risk score** — new pure `src/engine/risk.ts` (severity-weighted 0–100 + band + auditable
  contributors, 5 tests). Surfaced as a panel on the Vitals page and as a per-patient chip on the
  Tasks list, which is now **ranked sickest-first** (default selection = highest-risk patient).
  All verified live (Eleanor 90/Critical, Sofia 45, Marcus 22). Build clean, 49 tests green.
- 2026-06-21 (j): Fixed alert↔task mapping + dedup + dead citation link. (1) Citation URL 404 →
  all guideline refs now point to the live 2022 AHA/ACC/HFSA DOI (`citations.ts`). (2) Alert
  artifacts are now **idempotent and linked to the triggering Observation**: `writeback.ts` adds a
  stable `identifier` (`urn:hf-gdmt:alert|<patient>:<rule>:<date>:<kind>`) and sets `Task.focus` →
  the Observation; `createResourceIfNoneExist` (search-then-create; avoids the CORS-blocked
  If-None-Exist header) prevents duplicate Tasks/DetectedIssues/Flags. (3) Vitals page now fetches
  the patient's Tasks and shows "FHIR Task already created" for alerts that already have one — so the
  Vitals banners and the Tasks list stay consistent. Cleaned up 6 pre-existing duplicate alert Tasks
  on HAPI. Verified live (re-accept → 1 task, focus=Observation/…, banner reflects existing).
  Note: the Subscription alert service (`server/alertService.ts`) still uses a plain create; make it
  conditional too when deploying (builders already carry the identifier). 49 tests green, build clean.
- 2026-06-21 (k): Task workflow overhaul + patient Tasks tab + alert clarity. (1) Accept now creates
  the Task as **status=accepted** and assigns **owner=Dr. Smith** (`currentUser.ts`; writeback opts
  `taskStatus`/`ownerDisplay`). (2) Tasks show the assignee. (3) Full workflow in a new shared
  **`TaskCard`**: accepted→Start/Cancel; Cancel requires a typed reason (status only changes on
  confirm); Start→in-progress reveals an **auto-saving "Action taken notes"** field; **Mark complete
  is gated on non-empty notes** (note persisted as a Task.note authored by the clinician). (4) New
  **Tasks tab** on the patient view (`/patients/:id/tasks` → `PatientTasksPage`), plus a reusable
  lazy **`VitalTrendDetail`** (trend + recent readings, loaded only on expand) used by both the
  patient tab and the global Tasks page; `TasksPage` refactored onto the shared `TaskCard`.
  (5) Once a Task exists for an alert, its banner no longer shows on the Vitals page (moves to Tasks).
  (6) Alert banners now tag each alert **Threshold-based** vs **Trend-based (predictive)** (`kind` on
  GdmtAlert). All verified live (accept→accepted+owner+focus; cancel-reason gating; notes autosave
  persisted as Dr. Smith-authored note; complete-gating; lazy trend expand). 49 tests green, build clean.
- 2026-06-21 (l): Seeded a curated Task set + replaced notes autosave with an explicit save.
  (1) `scripts/seed-hapi.mjs` now seeds 4 alert-derived Tasks spanning the workflow (HF-002 accepted,
  HF-004 in-progress w/ action note, HF-005 completed, HF-003 cancelled w/ reason), each owned by
  Dr. Smith and `focus`-linked to the latest Observation of its vital (idempotent via
  `urn:hf-gdmt:task` identifier). Reset the messy prior tasks first. (2) `TaskCard` drops the
  debounced autosave; the in-progress state now has a **"Save Task Notes"** button (disabled unless
  the notes changed) that PUTs only the note — status is untouched. Verified live (save gating, note
  persisted, status stayed in-progress; all 4 seeded tasks render). 49 tests green, build clean.
- _YYYY-MM-DD: what got done, what's next, any blockers._
