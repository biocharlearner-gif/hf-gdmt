# Progress Log & Feature Checklist

**Read this at the start of every session; update it before the session ends.**
Mark a feature done only after end-to-end verification (tests green / works against a real
sandbox), not just when code is written.

## Clinical tab — problems / meds / lab history (2026-07-16)
- New **Clinical tab** (`src/patients/ClinicalTab.tsx`, route `/patients/:id/clinical`) is now the
  chart-review surface, with sub-tabs driven by `?view=problems|medications|labs` (linkable, no extra
  routes). **Problems** and **Medications** each have an Active/Resolved toggle (Active by default,
  counts on each button); queries stay unfiltered so toggling never re-fetches.
- Status predicates live in `src/patients/clinicalData.ts` (`conditionActivity` / `medicationActivity`).
  Unknown/missing status → **active** (never hide data behind a filter). These are deliberately NOT the
  same predicate as `fhir/extract.ts:91`, which counts `completed`/`intended` as on-therapy for pillar
  scoring — reconciling that would move GDMT output, so it's left as a follow-up.
- **Labs are no longer discarded.** `src/patients/labs.ts` defines the GDMT panel (K+, eGFR, creatinine,
  NT-proBNP, BNP, LVEF) reusing `LOINC`/`THRESHOLDS` from `engine/codes.ts`; `getLabObservations`
  (`patientApi.ts`) fetches it code-scoped (`code=<loinc|code,…>`, `_count=500`) rather than
  `category=laboratory` — LVEF is `category=imaging`, and code-scoping keeps device vitals from
  crowding the cap. `LOINC.NT_PROBNP`/`BNP` finally have a consumer.
- **Reference flags vs GDMT gates are separate on purpose.** `refLow`/`refHigh` are physiologic (so
  eGFR 58 flags Low), while the gate numbers shown in each card's note are interpolated from
  `THRESHOLDS` — the Labs view and the engine cannot drift. The tab displays and flags; it never
  recommends.
- Demographics is now identity/address/contact only. Shared `Card`/`Loading` → `src/patients/ui.tsx`;
  `Bars`/`Line` → `sparkline.tsx`; formatters → `format.ts` (VitalsTab imports both, no third copy).
  `PatientViewPage` derives the active tab from `TABS` instead of a nested ternary (adding a tab used
  to need three coordinated edits).
- **Seed extended** (`scripts/seed-hapi.mjs`): each lab is now a 6-point series over ~11 months
  (`LAB_TREND_DAYS`, oldest 330d so it sits inside the 12-month window), plus NT-proBNP; secondary
  active/resolved Conditions (`EXTRA_PROBLEMS`, non-HF codes only — the primary cohort Condition is
  untouched); and two **stopped** meds with reasons (HF-001 ACEi/cough, HF-003 MRA/hyperkalemia).
  `stopped` not `completed` — `extract.ts` treats `completed` as active and would have closed a gap.
  Each trend ends at exactly the existing `LABS` value because the engine reads latest-only.
- **Verified end-to-end** against the Medblocks tenant: 84 tests green, build+lint clean, and GDMT for
  HF-001 (1/4 pillars, 34%→73%) and HF-003 (3/4, MRA contraindicated K+ 5.2>5) is **byte-identical
  before and after the seed change** — the stopped meds correctly did not close their pillars.
- Gotcha: `npm run seed` runs under plain `node`, which does **not** auto-load `.env.local` — a bare
  `npm run seed` targets public HAPI while the app reads the Medblocks tenant. Use
  `node --env-file=.env.local scripts/seed-hapi.mjs`.

## BFF / Bun migration (2026-07-14)
- Added a **Bun backend-for-frontend** (`server/index.ts`, `Bun.serve`) so the Medblocks
  tenant Bearer token stays server-side (challenge rule: never on the frontend) and to give
  stable server URLs for CDS Hooks + FHIR Subscriptions. Routes: `/api/fhir/*` (authenticated
  reverse proxy → `MEDBLOCKS_FHIR_BASE`), `GET|POST /cds-services*` (reuses `src/cds/service.ts`),
  `POST /notify` + `GET /health` (reuses the pure `processNotification` from `server/alertService.ts`).
- `server/alertService.ts` now holds only the pure core + a `createFhirDeps({readBase,writeBase,token})`
  factory (Bearer-aware); the old `node:http` server moved into `server/index.ts`.
- **Bun = backend runtime only.** Frontend still Vite + npm. Scripts: `npm run server`
  (was `alert-service`, `tsx` → `bun`), `npm run register-subscription` now on `bun`.
- Frontend Patient Management repointed off direct HAPI onto the BFF: `PATIENT_FHIR_BASE = "/api/fhir"`
  (`src/patients/fhirConfig.ts`) + a Vite dev proxy `/api → http://localhost:8787` (`vite.config.ts`).
- Secrets: `MEDBLOCKS_FHIR_BASE`/`MEDBLOCKS_TOKEN`/`SMART_APP_URL`/`PORT` in git-ignored `.env.local`
  (documented in `.env.example`), unprefixed so Vite can't inline them. Verified end-to-end against
  HAPI (proxy GET/POST → 200, no client token; bundle grep clean). **The Medblocks token pasted so far
  is truncated (missing JWT signature) — `.env.local` token left blank pending the full value.**
- Epic SMART path unchanged (user-scoped PKCE tokens, safe in-browser).

## Current status (as of 2026-06-21)
- React 19 + Vite + MUI SPA is up with routing (`src/App.tsx`). **49 tests passing** (engine 5,
  alerts 14, risk 5, fhir/alerts 6, patients 12, server/alertService 7). Desktop-only.
- SMART standalone auth (PKCE) implemented in `src/smartAuth.ts`; in-memory session in `src/session.ts`;
  config-driven read/write-split client in `src/fhirClient.ts`.
- Read path wired end-to-end: `src/data/loadPatient.ts` fetches Patient/Observation/Condition/
  MedicationRequest/AllergyIntolerance → `buildEngineInput` → `evaluateGdmt`, rendered in `src/pages/PatientView.tsx`.
- Write path wired: `src/data/writeActions.ts` POSTs Task / lab ServiceRequest / CarePlan via the writeback builders.
- A separate **Patient Management** module (`src/patients/`) does CRUD against the public HAPI R4 server
  (no SMART auth) — patient list/search/create/edit, surfaced under `AppLayout` at `/patients`.
- **HF cohort (Gate 1) wired into the patient list**: `src/patients/hfCohort.ts` expands SNOMED
  «<< 84114007» on a terminology server + ICD-10 I50.*, hardcoded fallback. Terminology server =
  CSIRO Ontoserver (`r4.ontoserver.csiro.au/fhir`) — tx.fhir.org emits duplicate CORS headers browsers
  reject. `patientApi.ts` queries `Condition/_search` (POST), dedupes to patients. Demo data seeded via
  `scripts/seed-hapi.mjs` (`npm run seed`), tag-scoped `urn:hf-gdmt:demo|cohort-v1`.
- **Patient view is a routed shell** (`PatientViewPage`): full-width app bar + route-linked tabs +
  `<Outlet>`. Tabs are real pages — **Demographics** (`DemographicsPage` — identity/address/contact),
  **Clinical** (`ClinicalTab` at `/patients/:id/clinical` — problem list, medications, lab history),
  **GDMT** (`GdmtTab` at `/patients/:id/gdmt` — the flagship 4-pillar assessment in the demo
  flow), **Vitals** (`VitalsTab` at `/patients/:id/vitals`), **Tasks** (`PatientTasksPage` at
  `/patients/:id/tasks`). (The dead "Overview" tab was removed.)
- **Remote-monitoring is the flagship (Tier C), largely complete:**
  - Pure alert engine `src/engine/alerts.ts` — threshold rules (weight-gain, hypotension, brady/
    tachycardia, hypoxia) **+ predictive trend rules** (rising-weight, declining-SpO₂); every alert
    carries `severity`, `kind` (threshold/trend), `observed`, `threshold`, and a `citationRef`.
  - `src/engine/risk.ts` — deterministic 0–100 **HF risk score** (severity-weighted, auditable
    contributors); shown on the Vitals page and used to rank the Tasks list sickest-first.
  - `src/engine/citations.ts` — resolves refs → source + section + **deep link** (2022 AHA/ACC/HFSA DOI).
  - **Vitals page** (`VitalsTab`, redesigned to mockups): cited alert banners (Threshold/Trend tag,
    observed-vs-reference, Review-Trend, Accept → creates DetectedIssue+Flag+Task **idempotently**,
    linked to the triggering Observation, status=accepted, owner=Dr. Smith); banner hides once a Task
    exists; risk panel; 7/30-day trend cards (SVG charts); Detailed Reading History + BP-panel log.
  - **Tasks**: global `/tasks` (master/detail, risk-ranked, status filter, progressive load) and the
    per-patient Tasks tab share a reusable **`TaskCard`** (full workflow: accept→start→complete with
    required action notes via "Save Task Notes"; cancel requires a reason; alert→action→**outcome**
    chip) and a lazy **`VitalTrendDetail`** expander. Curated demo Tasks seeded across the workflow.
  - **FHIR Subscription push**: `src/fhir/subscription.ts` (vital-signs rest-hook) + `server/
    alertService.ts` (notified endpoint reusing the pure engine + builders) + `registerSubscription.ts`.
    Service half verified live; end-to-end delivery pending a public URL (see tech debt).
- Still **stubs / not yet integrated**: `src/cds/service.ts` (CDS Hooks — not deployed),
  `src/ai/rationale.ts` (grounded LLM — not called). Engine extract path still uses hardcoded value
  sets — only the patient-list cohort uses the terminology server so far.

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

## Next up (immediate) — HANDOFF for the next session (set 2026-07-20)
**Live app: https://hf-gdmt.vercel.app** (Vercel auto-deploys on push to `main`). Deploy, RAG (incl.
free pre-baked "Option C"), remote-monitoring loop, and CDS Hooks endpoints are all DONE + verified live
(see the 2026-07-20 session-log entries). The two tasks the user asked to continue next:

1. **Demo CDS Hooks against a REAL EHR sandbox.** Our CDS service is already live and correct:
   `GET https://hf-gdmt.vercel.app/cds-services` returns discovery; `POST …/cds-services/hf-gdmt-optimizer`
   returns a patient-view Card (verified — returns a card for an HFrEF patient with gaps, `{cards:[]}`
   when nothing actionable). `SMART_APP_URL` is set so the card's launch link points at the deployed app.
   What's left is to SHOW it firing inside an EHR:
   - **Fastest, no EHR account:** the public **CDS Hooks Sandbox** (sandbox.cds-hooks.org) — point it at
     our discovery URL, pick/craft a patient-view context with an HFrEF patient (LVEF ≤40 + a gap), and
     screenshot the rendered card + the "Open GDMT Optimizer" SMART link. Good enough for the demo video.
   - **Real Epic:** register the service in the Epic sandbox / App Orchard-style CDS config so the card
     fires on patient-view; needs the Epic sandbox (already have creds — see memory `hf-gdmt-epic-sandbox`).
     Note the prefetch templates in `src/cds/service.ts` (`discovery()`) — confirm Epic supplies them or
     falls back to fetch. Heavier setup; the Sandbox path is the pragmatic demo.
   - Deliverable: a short scripted walkthrough (open patient in the EHR/sandbox → card appears → click
     launch → lands on the GDMT tab) for the demo video.
2. **Browser pass of the live GDMT tab.** Drive https://hf-gdmt.vercel.app in the in-app Browser: Demo
   Account → a patient (Eleanor/HF-001 is the rich HFrEF case; Priya/HF-003 is the MRA-contraindicated
   case) → GDMT tab → click **"Explain with cited AI"** → confirm each pillar shows the AI-drafted
   (pre-baked) rationale + citation deep-links + the "AI-drafted explanation — grounded & cited" label,
   `mode: prebaked`. Screenshot for proof. (The endpoint is already verified via curl; this is the visual
   end-to-end confirmation.)

### Later / lower priority
3. **Multi-EHR `DocumentReference` publish-back** (write-permission-tolerant CarePlan path). Don't assume
   `CarePlan.write`; publish the plan as a **`DocumentReference`** (LOINC 18776-5 "Plan of care note")
   with the `carePlanSummary.ts` handout as the attachment, via `fhirClient.writeBaseUrl`. New
   `buildDocumentReference` in `fhir/writeback.ts` + a "Publish to chart" action on `CarePlanTab.tsx`.
   Full design note: `~/.claude/plans/are-their-any-resources-playful-crystal.md`.
4. **Demo video + 90-second script** ("engine decides → AI explains → loop closes"). Unchecked; this is
   what actually gets scored — script it around the live app.
5. Extend terminology `$expand` to the engine extract path (`src/fhir/extract.ts`), replacing hardcoded
   value sets (only the patient-list cohort uses the tx server today).
6. OPTIONAL: set `ANTHROPIC_API_KEY` in Vercel to upgrade RAG prose from pre-baked → live LLM (identical
   citations; not required — pre-baked ships free).

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
- [x] Dose-adequacy + up-titration suggestions — surfaced on the **GDMT tab** (`src/patients/GdmtTab.tsx`):
  per-pillar dose bar (daily/target mg + % of target), sub-target → "Create up-titration Task".
- [x] Contraindication/allergy suppression with reasons — GDMT tab shows CONTRAINDICATED pillars with the
  engine's reason (e.g. hyperkalemia → "K+ 5.2 > 5 — avoid MRA") and offers no action.
- [x] Stale-lab detection + lab ServiceRequest (`createLabOrder` in `data/writeActions.ts`) — verify live
- [x] GDMT CarePlan generation (`createCarePlanFor` wired to write) — verify live
- [~] Population panel ranked by risk — the **Tasks list is ranked sickest-first by the HF risk
  score**, and the **Patient List now has a sortable HF-risk column** (`src/patients/PatientListPage.tsx`)
  for cohort triage; a standalone GDMT-score/unrealized-benefit cohort panel is still TODO.
- [~] Clinician-grade UI polish: two-pane gradient login, desktop-only branded nav rail, app-wide
  Epic-gradient buttons/active nav. The Patient Management module (list, patient view, Vitals, Tasks)
  is fully polished to MUI; the legacy SMART `pages/PatientView.tsx` still uses plain CSS classes.

### Tier C — Winning edge
- [x] Remote-monitoring alerts from patient-device vitals. **Thresholds clinician-reviewed &
  finalized 2026-06-20** (see docs/DECISIONS.md "Remote-monitoring alerts"). Decided: NO user-facing
  settings panel — cited config constants only.
  - [x] Pure engine `src/engine/alerts.ts` (weight-gain decompensation + titration-safety vitals, cited; 14 tests).
  - [x] **Predictive trend rules** (`weight-trend-rising`, `spo2-trend-decline`) — early warning
    before a hard breach; fire only when the acute rule didn't. Each alert tagged `kind` threshold/trend.
  - [x] **HF risk score** (`src/engine/risk.ts`) surfaced on Vitals, used to rank the Tasks list, and
    shown as a **sortable band chip column on the Patient List** (`src/patients/PatientListPage.tsx`) so
    the HF cohort can be triaged sickest-first. Risk is computed per HF patient from their Observations
    (`riskFromObservations`/`fetchPatientRisk` in `src/patients/patientRisk.ts`), fetched **sequentially**
    (HAPI drops concurrent bursts) and rendered progressively; band colors live once in
    `src/patients/riskColors.ts` (`RiskChip`), shared by Vitals/Tasks/List.
  - [x] **Citation deep-links** (`src/engine/citations.ts`) — ref → source + section + guideline URL.
  - [x] **Full task workflow** (shared `TaskCard`): accept (status=accepted, owner=Dr. Smith,
    Task.focus→Observation, idempotent) → start → complete (requires action notes) / cancel (requires
    reason); alert→action→outcome chip; lazy `VitalTrendDetail` expander; per-patient Tasks tab.
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
    (same engine + builders as the SPA; runnable via `npm run server`, registered via
    `npm run register-subscription` with a public CALLBACK_URL). Service half verified live against
    HAPI (POST /notify → artifacts created); Subscription *delivery* needs a public URL (ngrok/deploy)
    since hapi.fhir.org can't reach localhost. 7 tests in `server/alertService.test.ts`.
- [~] Terminology server integration: live `$expand` powers the patient-list HF cohort
  (Ontoserver, session-cached, hardcoded fallback). Engine extract path still hardcoded — extend next.
- [ ] RAG cited explanations (engine decides, AI explains)
- [ ] CDS Hooks patient-view card with SMART-launch link (service stub done; deploy + wire)
- [x] Benefit projection in UI — GDMT tab benefit card (current vs. potential vs. incremental RRR from the
  pivotal HFrEF trials, `projectBenefit`); shown for HFrEF only, labelled illustrative-not-predictive.
- [ ] Multi-EHR proof (Epic + Cerner)
  - [ ] **Publish CarePlan as a `DocumentReference`** (write-permission-tolerant path — most EHRs gate
    `CarePlan.write` but allow document write-back). LOINC 18776-5 + `carePlanSummary.ts` attachment,
    via `fhirClient.writeBaseUrl`; new `buildDocumentReference` in `fhir/writeback.ts` + a "Publish to
    chart" action on `CarePlanTab.tsx`. Deferred to this phase (see Next-up #4 + the design note).
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
  `bun` + `npm run server` / `register-subscription`. Verified the service end-to-end against
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
- 2026-06-21 (m): Reconciled the top-of-file summary with everything shipped today — refreshed
  "Current status" (49 tests; routed patient shell; the full remote-monitoring stack: predictive
  alerts, risk score, citations, redesigned Vitals, shared TaskCard workflow, Subscription service),
  updated "Next up" (deploy + Subscription E2E first, then RAG), and marked the Tier C
  remote-monitoring items + risk-ranked Tasks list done in the checklist.
- 2026-07-06: **Add-Patient now puts patients on the roster.** Root cause: the list is
  tag-scoped (`_tag=urn:hf-gdmt:demo|cohort-v1`) and HF/Non-HF is derived from a coded
  Condition, but the Add form wrote neither, so new patients never appeared. Fixes:
  (1) `formToPatient` now stamps `meta.tag` = DEMO_TAG (new structured constant in
  `fhirConfig.ts`); (2) new **Problem List / Diagnosis** section in `PatientFormDialog`
  (Add mode only) — a required grouped Primary-Diagnosis select (`src/patients/problemList.ts`:
  5 HF options coded in the cohort value set, 5 Non-HF outside it), a live "will be added
  as HF / Non-HF" chip, and an info box explaining the two cohorts (requirement #2);
  (3) on save it writes an active+confirmed problem-list `Condition` via new
  `formToCondition` (tagged, coded), so HF picks land in the HF cohort. Schema gained an
  optional `problem` (Edit flow unchanged). 4 new tests (53 total), build clean. Verified
  live in-browser: added a patient → appeared as "HF Patient"; Patient+Condition POSTs
  201; test record cleaned up afterward. Next: RAG cited-explanation module.
- 2026-07-06 (b): **Add-Patient diagnosis upgraded to live SNOMED search (option B).**
  Replaced the curated dropdown with a debounced terminology-server autocomplete
  (`src/patients/conditionSearch.ts` → `ValueSet/$expand` on Ontoserver, implicit SNOMED
  VS constrained by ECL `<< 64572001 |Disease|`, text `filter`), in a new
  `DiagnosisAutocomplete.tsx`. HF/Non-HF is now computed deterministically via
  `hfCohort.isHfCode` against the SAME expanded cohort value set the roster uses, so form
  and list always agree (engine still decides membership; tx server only supplies concepts).
  Graceful degradation: `problemList.ts` codes are shown as suggestions before typing and
  as a fallback when the tx server is unreachable. `formToCondition` now takes a
  `ConceptOption` and writes its exact SNOMED/ICD-10 coding. Also added the shared cohort
  hint strings and wired **tooltips** on the roster's HF/Non-HF filter pills and cohort
  chips (requirement #2, beyond the Add dialog). MUI v9 note: `Autocomplete`'s
  `renderInput` params moved `InputProps` → `slotProps.input`. 53 tests green, build clean.
  Verified live: Ontoserver text search returns disorders (CORS clean); selecting
  "Congestive heart failure" → "HF Patient" chip; full save wrote Condition coded
  `42343007` and the patient appeared as HF; filter/chip tooltips present; test record
  cleaned up. Next: RAG cited-explanation module.
- 2026-07-06 (c): Fixed two Tasks-page bugs. (1) **Misleading "improved" outcome**: the
  alert→outcome chip re-evaluated alerts with `now` = wall-clock, so seed readings older
  than the 14-day recency window produced no alert → read as "improved" even when the last
  value was still abnormal (e.g. HF-002 SBP 86 < 90). Added pure `evaluateOutcomeAlerts`
  (`src/engine/alerts.ts`) that anchors `now` to the latest reading (recency-independent),
  and wired it into `TasksPage`/`PatientTasksPage` for `activeAlertVitals`. Outcome now
  reflects the last reading ("still abnormal" vs "improved"). (2) **Missing source link**:
  `TaskCard` rendered the note text (seed stored plain `(Source: HF remote-monitoring)`) and
  never had the Vitals page's citation deep-link. Extracted the shared `CitationLine.tsx`
  (now used by both `VitalsTab` and `TaskCard`), added `VITAL_CITATION_REF`/`isKnownCitation`
  (`src/engine/citations.ts`); `TaskCard` now resolves a source (known ref in the note, else
  the vital's ref), strips the raw "(Source: …)" from the note, and renders the guideline
  deep-link. Seed updated to store real citation ids. 56 tests green (3 new), build clean.
  Verified live (HF-002: "blood pressure still abnormal" + §7.3.1 RAAS deep-link). NOTE: the
  patient **Risk** chips show 0 for the same wall-clock-staleness reason — the risk score is
  intentionally left recency-gated; re-seed (`npm run seed`) to refresh demo data, or anchor
  risk to data later if the demo needs live-looking scores. Next: RAG cited-explanation module.
- 2026-07-07: **HF risk score on the Patient List** for cohort triage. Added a sortable **Risk**
  column (`src/patients/PatientListPage.tsx`) that shows each HF patient's band chip and defaults to
  sickest-first; clicking the header toggles risk⇄name sort. Non-HF rows show "—" (HF cohort only).
  Extracted the reused glue into pure `riskFromObservations` + `fetchPatientRisk`
  (`src/patients/patientRisk.ts`), and consolidated the previously-duplicated band-color map into
  `src/patients/riskColors.ts` + a shared `RiskChip` (now used by Vitals/Tasks/List). `usePatients`
  holds the full filtered cohort, computes risk **sequentially** (HAPI drops concurrent bursts) with a
  session cache + StrictMode-safe `loadSeq`, and pages/sorts locally; `patientApi.listCohort` exposes
  the unpaged list. 59 tests green (3 new in `patientRisk.test.ts`), build + lint clean. Verified live:
  5 sequential `Observation` fetches, chips band-colored (Stable = green, matches Vitals), non-HF "—",
  sort toggle works. NOTE: demo chips read 0/Stable (seed vitals are outside the recency window — same
  wall-clock-staleness caveat as the 2026-07-06 entry; `npm run seed` to refresh). Next: RAG module.
- 2026-07-15: **GDMT flagship surfaced in the demo flow + profile clinical data.** The core thesis
  (4-pillar GDMT assessment) previously lived only in the legacy plain-CSS `src/pages/PatientView.tsx`
  (SMART path); the demo flow (`/patients/:id`) never showed it. Fixes: (1) New **GDMT tab**
  (`src/patients/GdmtTab.tsx`, route + tab wired in `App.tsx`/`PatientViewPage.tsx`) — fetches
  Observations/Conditions/Medications, runs the PURE `evaluateGdmt`+`projectBenefit`, renders a phenotype
  gate (Gate 2/LVEF: HFrEF full program, HFmrEF/HFpEF → SGLT2i only + others muted, Unknown → "Order
  echocardiogram"), GDMT score + optimization %, benefit-projection card, and 4 pillar cards with status /
  dose-adequacy bar / contraindication reason / guideline deep-link. Loop closure: Create FHIR Task per gap
  (idempotent via `urn:hf-gdmt:gdmt` identifier), Order labs (BMP), Order echo, Generate CarePlan — all
  written to the tenant via `createResourceIfNoneExist`. (2) **Removed the dead "Overview" tab.**
  (3) **Problem List + Medications cards** added to Demographics (`getConditions`/`getMedications` in
  `patientApi.ts`, summarizers in new `src/patients/clinicalData.ts`; meds show their GDMT-pillar chip).
  (4) **Seed extended** (`scripts/seed-hapi.mjs`): RxNorm MedicationRequests + K+/eGFR/creatinine labs
  across the cohort so the panel tells a story (HF-001 sub-target BB + 3 eligible gaps; HF-002 ARNI at
  target; HF-003 hyperkalemia → MRA contraindicated; HF-004 no labs → labs-needed). (5) **Bug fix:**
  BetaBlocker/MRA `citationRef`s were cross-wired in `rules.ts` (§7.3.2 is beta-blockers, §7.3.3 is MRA) —
  corrected. Verified live against the **Medblocks tenant** (the app's real data source now — reseeded
  there, 142 resources): Eleanor HFrEF benefit 34%→73%/+39% + Task POST→201; Priya dose bars + MRA
  contraindication; no-LVEF patient → order-echo path; Demographics cards populate. Build clean, 59 tests
  green, new files lint clean. Next (Day 2): RAG cited explanations + deploy to a public URL (finishes
  Subscription E2E + unblocks CDS Hooks).
- 2026-07-17: **GDMT tab: created-Task state + medication start-date / up-titration timing.**
  (1) **"FHIR Task already created" now survives reload.** `GdmtTab` tracked task creation only in
  component state, so on reload every pillar re-offered "Create FHIR Task" even though the write was
  already idempotent. It now fetches `getTasksForPatient` on load and maps existing Tasks back to
  pillars by the `urn:hf-gdmt:gdmt` identifier (`<patient>:<pillar>:task`); a created pillar shows a
  green chip + **"View task"** deep-link to `/patients/:id/tasks?highlight=<id>`. `PatientTasksPage`
  honors `?highlight=` (scroll-into-view + outline). Also seeds `taskRefs` from fetched Tasks so the
  CarePlan "N Task(s) linked" count is correct after reload.
  (2) **Layout:** the GDMT Score and Benefit cards were two full-width bands of mostly whitespace →
  now side by side in a grid (`minmax(260px,1fr) 1.5fr`), ScoreCard restructured vertical, BenefitCard
  tightened; pillars move up a screen. Presentation-only.
  (3) **Medication start date + "due for up-titration" (engine-decided).** Threaded
  `MedicationRequest.authoredOn` → `MedicationFact.startedOn` (`extract.ts`) → `PillarResult.agent`
  + new `PillarResult.titration` (`types.ts`, `rules.ts`, deterministic on injected `now`). New
  `THRESHOLDS.titrationIntervalDays = 14` (`codes.ts`, VERIFY) + citation
  `AHA-ACC-HFSA-2022-7.3-titration` (`citations.ts`). On-therapy pillars show "On since <date> · N
  days"; **sub-target** pillars past the interval show an amber "Due for up-titration" hint with the
  §7.3 deep-link (`GdmtTab.tsx`, reuses `fmtDay` + `CitationLine`). On-target never flags. 99 tests
  green (+5: 4 engine timing, 1 extract mapping), build clean.
  Verified live against the **Medblocks tenant**: Eleanor's sub-target carvedilol → overdue (60 days);
  Marcus's ARNI on-target → date only, no hint; Marcus's metoprolol → not overdue (5 days). NOTE: the
  seed is create-only (`ifNoneExist`), so re-running `npm run seed` will NOT update an existing
  resource's `authoredOn` — the two demo beta-blocker dates were set by a direct PUT through the BFF to
  realize the overdue/not-overdue contrast; the `authoredDaysAgo` values in `scripts/seed-hapi.mjs`
  (carvedilol 60, metoprolol 5) only apply on a fresh (empty-tenant) seed. Next: RAG cited-explanation module.
- 2026-07-19: **GDMT journey stage banner + HF-hospitalization risk signal** (two features).
  (1) **GDMT journey stage** — new pure `engine.gdmtStage(assessment)` classifies where a patient
  sits on the optimization journey over the pillars applicable to their phenotype:
  PHENOTYPE_PENDING / INITIATION / TITRATION / OPTIMIZED_LIMITED / OPTIMIZED, with at-target counts and
  the most-recent medication change (min days-on-therapy). Surfaced as a **StageBanner** on the GDMT tab
  (three-step rail — Initiation → Active titration → Optimized — with the current step highlighted, a
  toned summary, and a next-step prompt); skipped for Unknown (phenotype banner already prompts echo).
  `isApplicablePillar` moved into the engine and reused by the tab (removed the duplicate). This answers
  "which stage is the patient in?" deterministically without any EHR visit-type data — chosen over a
  generic Encounter/visit list, which would be an off-thesis EHR dump. 6 engine tests.
  (2) **HF-hospitalization → risk score** — the vulnerable post-discharge phase now drives the HF risk
  score. `buildHospitalizationSignal` (`fhir/extract.ts`) reads the most recent HF-related **inpatient**
  Encounter (class IMP + HF reasonCode / ICD-10 I50) → `HospitalizationSignal{daysSinceDischarge}`;
  `computeRiskScore(alerts, {hospitalization})` adds a cited contributor: +40 within
  `hfHospVulnerableDays`=30 (vulnerable phase), +18 within `hfHospRecentDays`=90 (recent), 0 after
  (thresholds in `codes.ts` VERIFY; citation `AHA-ACC-HFSA-2022-8-transitions`). `RiskContributor.vital`
  is now optional (non-vital signal); RiskPanel shows the contributor + §8 deep-link. Threaded through
  `getEncounters` (`patientApi.ts`) + `patientRisk.ts` so **both** the Vitals panel and the Patient List
  risk column reflect it. Seed adds HF inpatient Encounters (`HOSPITALIZATIONS`: HF-001 discharged 12d →
  vulnerable, HF-005 60d → recent). 7 tests (4 risk + 3 extract). 112 tests green, build clean.
  Verified live against the Medblocks tenant (reseed created 2 Encounters): stage banners render
  (Eleanor/Marcus = Active titration); risk shows HF-001 100/Critical incl. "vulnerable phase 12d (+40)",
  HF-005 63/High incl. "recent 60d (+18)", Marcus no hosp contributor; list column + sort reflect it.
  Next: RAG cited-explanation module.
- 2026-07-19 (b): **Completed the GDMT CarePlan action → dedicated Care Plan tab.** The old
  "Generate GDMT CarePlan" button was write-only (plain `createResource`, non-idempotent → duplicates)
  and never read back — a judge saw an ID, not a deliverable. Now: (1) **New Care Plan tab**
  (`src/patients/CarePlanTab.tsx`, route + tab in `App.tsx`/`PatientViewPage.tsx`) that detects an
  existing plan on load (`getCarePlans` by `urn:hf-gdmt:gdmt|<patient>:careplan`), **Generates**
  idempotently (`createResourceIfNoneExist`), and renders the plan as an artifact: status/created/author,
  "Addresses <HF condition>", Goals, a per-pillar Activities table (status chip + linked-Task chip), a
  benefit snapshot, and guideline `CitationLine`s. (2) **Regenerate** rebuilds from the current
  assessment and `updateResource`s the same id (stays current as gaps close, no dup). (3) **Print / Save
  PDF** opens a self-contained handout (`carePlanSummary.ts` → new-window `window.print()`). (4) Enriched
  `buildCarePlan` (`fhir/writeback.ts`): contained `Goal`s, one `activity` per applicable pillar with
  engine→FHIR `pillarActivityStatus`, `addresses`→HF Condition, `author`, `period`. (5) `getCarePlans` +
  generic `updateResource` in `patientApi.ts`. (6) GDMT tab's CarePlan card now routes to the tab
  (removed the non-idempotent inline path + dead `generateCarePlan`). Reused the cohort's curated
  `HF_FALLBACK_CODES` (includes 417996009 Systolic HF) to pick the `addresses` Condition — a small local
  set had missed it. 13 tests (`writeback.test.ts` + `carePlanSummary.test.ts`); 125 green, build clean.
  Verified live against the Medblocks tenant: Eleanor has exactly 1 rich CarePlan (goals/activities/
  author/addresses); Regenerate keeps 1, same id; Marcus no-plan → Generate → exactly 1 created →
  addresses "Systolic heart failure"; GDMT card links to the tab. (Skipped seeding a static CarePlan —
  it would duplicate the builder and drift; the idempotent Generate is one click.) Next: RAG cited
  explanations; then commit+push the day's work (stage banner, hospitalization risk, 3-col layout,
  stepper redesign, CarePlan tab — the last of these still uncommitted).
- 2026-07-19 (c): **Vercel deploy scaffolding — one origin for SPA + BFF.** Vercel can't run a
  persistent `Bun.serve`, so the BFF's four concerns became thin serverless functions in `api/` that
  import the SAME pure core (logic lives once); the Bun server (`server/index.ts`) stays for local dev.
  (1) Factored the FHIR reverse-proxy out of `server/index.ts` into shared `server/fhirProxy.ts`
  (`proxyFhir(req, url, {fhirBase, token})`), reused by both runtimes. (2) Added `api/fhir/[...path].ts`
  (authenticated proxy — the app's prod data path, token stays server-side), `api/notify.ts`
  (Subscription rest-hook target), `api/cds-services.ts` + `api/cds-services/[service].ts` (CDS Hooks
  discovery + patient-view card, CORS), `api/health.ts`. All use Vercel's documented Web-standard
  `export default { fetch }` all-methods form (verified against Vercel's Functions API Reference — the
  bare `export default function handler` is NOT a documented signature). (3) `vercel.json`: build →
  `dist`, friendly-path rewrites (`/notify`,`/cds-services`,`/health`), SPA client-routing fallback
  `/((?!api/).*) → /index.html`. (4) **Made the alert-service writeback idempotent** (PROGRESS next-up
  #1): `createFhirDeps.createResource` now searches by the builder's stable `identifier` and reuses an
  existing resource instead of POSTing a duplicate (new exported `identifierSearchToken` + 5 tests).
  130 tests green (was 125), build clean; new `api/`+`server/` files lint clean (the 45 pre-existing
  lint errors are unrelated SPA files). Runbook in `docs/DEPLOY.md`. **BLOCKER (user action): the actual
  `vercel` deploy + env vars + `register-subscription` need the user's Vercel auth — see DEPLOY.md.**
  Once deployed this completes the Subscription E2E and unblocks CDS Hooks. Next: RAG cited explanations.
- 2026-07-16 (main): Enabled `strict` + `noUncheckedIndexedAccess` in tsconfig.app/node (CLAUDE.md
  claimed both; configs set neither). Fixed 4 errors in `src/patients/`. (This entry originated on
  `main` and was preserved through the 2026-07-19 (d) merge below.)
- 2026-07-19 (d): **Merged `docs/sync-with-code` → `main`** so the latest code goes live on the
  Vercel production URL (https://hf-gdmt.vercel.app, GitHub-integration deploy on push to main). main
  had diverged from base c677a6c with only the strict-TS commit; the branch carried all July work
  (Bun BFF, Clinical/GDMT/CarePlan tabs, remote-monitoring stack, Vercel functions). One content
  conflict (this session log) resolved to the branch version, keeping main's strict-TS note. Rebuilt
  the whole tree under the now-merged strict tsconfig before pushing.
- 2026-07-20: **App is LIVE on Vercel (https://hf-gdmt.vercel.app) — full stack verified.** After the
  merge, the GitHub-integration deploy exposed two Vercel-specific breakages (both fixed, documented in
  `docs/DEPLOY.md` "Vercel gotchas"): (1) the serverless functions didn't bundle TS imported from
  outside `/api` (`FUNCTION_INVOCATION_FAILED` on every function that used shared code, incl. the FHIR
  proxy the SPA depends on) → moved handlers to `api-src/` and esbuild-bundle them into self-contained
  `api/*.js` via `scripts/build-api.mjs` + a `prebuild` hook (committed output; esbuild now a declared
  devDep); (2) Vercel's `[...path]` catch-all injects a `...path` query param → `proxyFhir` strips it
  before forwarding (was 400ing every FHIR search). Diagnosed both against the live deploy with throwaway
  probe endpoints. Verified live: `/api/fhir/Patient` + HF-cohort `Condition?_tag=…` → 200 with real
  Bundles (SPA data path works), `/cds-services` discovery + patient-view card → 200, `/notify` safe
  no-op, `/health` authenticated against the Medblocks tenant. 133 tests green (+3 `fhirProxy.test.ts`),
  build clean. Remaining for the live URL: set/confirm `SMART_APP_URL=https://hf-gdmt.vercel.app` so CDS
  launch links are absolute, then register the Subscription (`CALLBACK_URL=…/notify`) to close the E2E.
  Next: RAG cited explanations.
- 2026-07-20 (b): **Fixed nested FHIR paths on Vercel — roster verified live.** After the initial
  deploy, the FHIR proxy worked for single-segment paths (`/api/fhir/Patient`) but 404'd on nested ones
  (`/api/fhir/Condition/_search`, the roster's POST search): Vercel's filesystem `[...path]` catch-all
  only matched one segment for a pre-built `.js` function. Replaced it with a single `api/fhir-proxy.js`
  + an explicit `vercel.json` rewrite `/api/fhir/:_vpath* → /api/fhir-proxy?__path=:_vpath*`. Two follow-on
  subtleties, both fixed and diagnosed with throwaway echo probes: the proxy must strip the injected
  path param, AND Vercel appends its **own** copy of the matched route param (named after the route
  var) on top of the explicit `__path` — so the route var is named `_vpath` (no FHIR collision) and
  `resolveUpstream` strips `__path`/`_vpath`/`...path`. Verified live in-browser: the demo roster renders
  all 6 HF cohort patients (Eleanor 100·Critical, Sofia 63·High, …) with ages + risk chips, pulled
  through the authenticated proxy. `/cds-services`, `/api/fhir/Patient`, POST `Condition/_search` all 200.
  139 tests green (`resolveUpstream` + nested-path coverage in `server/fhirProxy.test.ts`), build clean.
- 2026-07-20 (c): **FHIR Subscription registered + alert loop verified live on production.** Registered
  the vital-signs `Subscription` on the Medblocks tenant pointed at `https://hf-gdmt.vercel.app/notify`
  (`Subscription/c5fafeef…`). Medblocks created it as `status: requested` and did NOT auto-activate; a
  PUT to `status: active` succeeded. **Full alert loop verified via direct POST /notify for Eleanor
  (61f1529f…):** engine fired 2 alerts (weight-gain-7d from seed + hypoxia from a test SpO₂=86
  Observation) → wrote 2 DetectedIssue+Flag+Task sets; both Tasks queryable; re-invoking /notify created
  **no duplicates** (idempotency confirmed). BUT: Medblocks does **not deliver** the rest-hook callback
  automatically — creating a vital-signs Observation did not trigger /notify within 3.5 min, while direct
  invocation works perfectly. So the tenant's server-side Subscription *delivery* is disabled (common on
  hosted sandboxes); our engine/service/writeback/idempotency all work. Demo the loop via the Vitals-tab
  Accept path or a direct /notify call. `/health` now echoes `smartAppUrl` (verified
  `https://hf-gdmt.vercel.app`, `smartAppUrlConfigured: true`). TEST DATA LEFT ON TENANT (pending
  cleanup decision): 1 SpO₂=86 Observation (`ef40d1f4…`) + its hypoxia DetectedIssue/Flag/Task, and the
  weight-gain DetectedIssue/Flag/Task for Eleanor. Next: RAG cited explanations.
- 2026-07-20 (d): **RAG cited-explanation module (the flagship differentiator) — engine decides, AI explains.**
  Built the retrieval-grounded explanation layer end to end. (1) **Curated cited KB**
  (`src/ai/knowledgeBase.ts`): ~18 paraphrased 2022 AHA/ACC/HFSA statements, each tagged by
  pillar/topics + a `citationRef` into the existing citation registry (paraphrase-not-verbatim, per
  copyright rule). (2) **Deterministic retriever** (`src/ai/retrieve.ts`): tag/keyword scoring against
  query terms derived from the engine facts (pillar status + reason) — no embeddings service, so the
  same facts always retrieve the same evidence (auditable, testable). (3) **Reworked `src/ai/rationale.ts`**:
  builds per-pillar grounding {engine facts + retrieved chunks}, an **LLM path** (Anthropic SDK,
  `claude-opus-4-8` default, structured JSON output) AND a **deterministic cited fallback**. Key safety
  property: **citations come from the retriever, never the LLM** — the model writes prose only; the app
  attaches the cited refs, so a hallucinated source is impossible. `generateRationale` uses the LLM when
  a key is present and falls back to deterministic on missing key or any error → the demo never breaks.
  (4) **Endpoint** `api-src/rationale.ts` → bundled `api/rationale.js` + Bun route `POST /api/rationale`;
  reads `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` server-side only. (5) **UI**: "Explain with cited AI" action
  on the GDMT tab renders each pillar's grounded rationale + citation deep-links + an AI-vs-deterministic
  label (`GdmtTab.tsx`; `getRationale` in `patientApi.ts`, response types declared locally so the client
  bundle never imports the SDK — verified: client bundle unchanged at ~857 kB). `@anthropic-ai/sdk` added
  as a dependency (static import in the server-only module; Vercel traces it; tree-shaken from client).
  9 tests (`src/ai/rationale.test.ts`: retrieval relevance + deterministic grounding); 144 green, build
  + lint clean. **USER ACTION for the live LLM: add `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) to
  the Vercel project env, then redeploy.** Until then `/api/rationale` serves the deterministic cited
  fallback. Next: verify live; then CDS Hooks card wiring / multi-EHR DocumentReference / demo script.
- 2026-07-20 (e): **RAG "Option C" — AI-drafted pre-baked explanations (free, no API key/credits).**
  The user has a Claude Pro subscription (no API credits); Pro can't power a deployed backend endpoint.
  Since the engine is deterministic, the rationale set is a small finite (pillar × status) lookup, so
  Claude (Opus 4.8) drafted the grounded prose at build time into `src/ai/prebaked.ts` (20 entries,
  value-agnostic — patient values come from the engine reason, citations from the retriever). Render
  precedence is now **live-LLM (if key) > pre-baked > deterministic template** (`renderNoLlm` in
  `rationale.ts`; `source` gained `"prebaked"`, endpoint `mode` gained `"prebaked"`). The GDMT tab labels
  it "AI-drafted explanation — grounded & cited". So the demo ships with AI-quality cited prose at ZERO
  runtime cost; adding `ANTHROPIC_API_KEY` later upgrades to live per-value LLM prose with identical
  citations. Coverage test guarantees every (pillar × status) has an entry. 145 tests green, build/lint
  clean, client bundle SDK-free (~858 kB). Next: verify live, then CDS card wiring / demo script.
- 2026-07-21: **Verified both handoff tasks live; CDS Hooks now demoable in an EHR sandbox.**
  (1) **GDMT "Explain with cited AI" — browser-verified live** on https://hf-gdmt.vercel.app.
  Eleanor (61f1529f) and Priya (26612f4a): clicking the action fires `POST /api/rationale` →
  200 with `mode:"prebaked"`, `llmConfigured:false`, and every pillar's `source:"prebaked"`.
  UI renders each pillar's "AI-drafted explanation — grounded & cited" block + citation
  deep-links; header flips to "Regenerate explanations". Full status range covered:
  Eleanor = gap-eligible ×3 + sub-target BB; Priya = sub-target RAAS + **contraindicated MRA**
  (grounded "held because a safety threshold is outside range… recheck labs" + §7.3.3) + two
  on-target. The free pre-baked path works end-to-end with zero API cost.
  (2) **CDS Hooks card demoed in the public CDS Hooks Sandbox (sandbox.cds-hooks.org).** Key
  constraint discovered: a CDS-Hooks client resolves prefetch **client-side**, so the FHIR
  server it points at must be CORS-open + R4 — and our `/api/fhir` proxy *deliberately* emits
  no CORS (token-bearing, must stay same-origin, `server/fhirProxy.ts`). So instead of pointing
  the sandbox at our tenant, seeded a **self-contained HFrEF demo patient on public HAPI R4**
  (`Patient/137203927` "Harold J. Whitmore", tag `urn:hf-gdmt:demo|cds-hooks-v1`: HF Condition +
  LVEF 28% + K+ 4.2 + eGFR 68 + HR 72 + SBP 118, no GDMT meds → all 4 pillars GAP_ELIGIBLE).
  Reproducible one-click deep-link loads service+FHIR+patient and renders the card:
  `https://sandbox.cds-hooks.org/?serviceDiscoveryURL=https%3A%2F%2Fhf-gdmt.vercel.app%2Fcds-services&fhirServiceUrl=https%3A%2F%2Fhapi.fhir.org%2FbaseR4&patientId=137203927`.
  Card verified in-sandbox (accessibility tree): "HF below target GDMT: 0 of 4 pillars",
  warning, 4 cited gap bullets (§7.3.1–7.3.4), source "HF GDMT Optimizer", +73% RRR, launch
  link `hf-gdmt.vercel.app?patient=137203927`. **SMART-launch caveat (expected, not a bug):**
  the sandbox disables the launch button ("Cannot launch SMART link without a SMART-enabled
  FHIR server") + logs a 400 — it's the *sandbox* negotiating a SMART handshake against public
  HAPI, which isn't SMART-auth-enabled; the card's link is correct. Full runbook + narration
  script in **`docs/CDS-DEMO.md`**. (Note: screenshots via the in-app browser pane repeatedly
  timed out — a pane infra issue, not the app; DOM/accessibility-tree reads are the proof.)
  Next: record the demo video (script ready in CDS-DEMO.md), or the "real Epic" CDS registration
  for a seamless launch; then multi-EHR DocumentReference publish-back.
- 2026-07-21 (b): **Real Epic launch — feasibility settled + code made Epic-ready; config is user-side.**
  User asked to prioritize "real Epic CDS registration for a fully seamless launch." Findings:
  (1) **CDS-card-in-Epic is blocked** — Epic staff (Matt Sargent, fhir.org chat) confirm you
  *cannot* test CDS Hooks in the public EOF sandbox; it needs Epic-customer App Orchard/Hyperspace.
  No public path to watch our card fire in Epic. So "real Epic" = the **launch** half (achievable +
  demoable) + a customer-only card surface (ready but not self-demoable).
  (2) **Fixed a real launch bug in `src/cds/service.ts`:** the card's `type:"smart"` link pointed at
  `${app}?patient=<id>` (the app **login page**, which ignores launch context). Per CDS Hooks spec the
  EHR appends `iss`+`launch` on click, so it must target the SMART **launch endpoint** — now
  `${app}/launch` (our `EhrLaunch.tsx` reads iss+launch → PKCE → `/callback` → `/patient` GDMT view).
  Regenerated the committed `api/cds-services/[service].js` bundle; 145 tests green.
  (3) **Diagnosed live deploy:** the production bundle has **no `VITE_SMART_*` baked in** (checked the
  served JS — no Epic ISS/client id/redirect), so "Connect with Epic" can't launch until the user sets
  the env + redeploys. The requested SMART scope already covers Condition/Observation/MedicationRequest/
  AllergyIntolerance/Encounter reads (the memory "only Patient.Read" was the Epic *app registration*, not
  our request).
  (4) Confirmed the app is otherwise **Epic-launch-ready**: `/launch` EHR-launch entry + standalone
  "Connect with Epic" both wired; callback lands on `/patient` (`PatientView.tsx`) which renders the
  4-pillar GDMT from the **Epic** read path (`loadPatient`, in-browser token) — distinct from the MUI
  `GdmtTab` (BFF→Medblocks). Left as-is; unifying read paths is out of scope/risky.
  **Deliverable + USER ACTIONS: `docs/EPIC-LAUNCH.md`** — precise Epic-portal steps (redirect
  `…/callback`, launch `…/launch`, enable Condition/Observation/MedicationRequest/AllergyIntolerance/
  Encounter Incoming APIs) + Vercel `VITE_SMART_*` env + redeploy. After the user does A+B I drive the
  browser to verify STEP C (Connect with Epic → fhircamila → GDMT on real Epic data) and capture proof.
  **UNCOMMITTED**: this session's code fix + the api bundle + docs (CDS-DEMO.md, EPIC-LAUNCH.md,
  seed-cds-demo.mjs) — commit when ready. Next: user does Epic+Vercel config; then live STEP C verify.
- 2026-07-21 (c): **Real Epic SMART launch VERIFIED LIVE end-to-end.** After the user set the Epic app
  (client `ba035637`, appId 56281) + Vercel `VITE_SMART_*`, the live "Connect with Epic" now completes:
  MyChart login (`fhircamila`/`epicepic1`) → app runs on **real Epic patient data**. Verified via the
  user's screenshot: "SMART ON FHIR · EPIC" badge, patient MRN `FHRB9N98T45DL55` (Camila, 38F), the
  engine ran live and correctly returned **phenotype Unknown / all 4 pillars "Labs needed"** — because
  Camila's Epic record has no LVEF + no recent K+/eGFR/HR. That's the intended *degrade-gracefully,
  never-guess* safety behavior on real EHR data, not a bug (rich 4-pillar scoring still best shown on the
  Demo/Medblocks path with seeded HFrEF patients).
  Debug journey to get there (all diagnosed via a shell probe of Epic's `authorize` endpoint —
  `error=4` in the login-web redirect ⇔ an unregistered redirect_uri OR unenabled Incoming API):
  (1) live bundle had **no `VITE_SMART_*` baked in** → user set them in Vercel + redeployed;
  (2) "Invalid OAuth 2.0 request" on live only → the prod redirect `https://hf-gdmt.vercel.app/callback`
  was **not registered on Epic's sandbox OAuth build**; adding it to the form wasn't enough — needed
  **Save & Ready for Sandbox** + **~16 min propagation** (a 60s background poller caught the flip);
  (3) the "Hyperspace" branding on Epic's error page is generic OAuth error chrome, NOT an
  audience mismatch — once valid, a Patients-audience app correctly routes to **MyChart** login;
  (4) Epic silently down-scopes unenabled write scopes (no error), so the write scopes in the request
  are harmless.
  **Writeback in the Epic session fails by design:** `ServiceRequest POST → 403` (Epic app has only Read
  APIs; no `ServiceRequest.Create`), `CarePlan POST → 405` (Epic sandbox doesn't support CarePlan create
  at all). Root cause: `session.ts:22` `writeBaseUrl = VITE_FHIR_WRITE_BASE || tokens.iss` → unset ⇒
  writes go to Epic (read-only) ⇒ rejected. **Fix (optional, showcases the read/write split):** set
  `VITE_FHIR_WRITE_BASE` (e.g. `https://hapi.fhir.org/baseR4`, CORS-open) in Vercel + redeploy → reads
  from Epic, writes to HAPI. Also earlier this session: fixed the CDS card `type:"smart"` link to target
  `/launch` (was `?patient=…` = login page); regenerated `api/` bundle; 145 tests green. Runbook:
  `docs/EPIC-LAUNCH.md`; CDS sandbox demo: `docs/CDS-DEMO.md`. All this session's code+docs still
  UNCOMMITTED. Next: (optional) writeback split env; commit; demo video.
- 2026-07-21 (d): **Shared `GdmtView` — the Epic SMART launch now lands on the polished GDMT panel.**
  The SMART/Epic path used to render the legacy plain-CSS `pages/PatientView.tsx`, while the polished
  four-pillar UI lived only in the demo `patients/GdmtTab.tsx` (which reads Medblocks via patientApi — a
  different data source, and its bare `Observation?patient=` queries are Epic-incompatible). Rather than
  re-point the demo module at Epic (option A, high risk), extracted the **presentation** into a new
  `src/patients/GdmtView.tsx` (phenotype gate, score card, GDMT-journey stepper, benefit card, 4 pillar
  cards w/ dose/titration/contraindication/citations, AI-explain, safety note; benefit+stage derived
  internally). Both hosts now render it, each keeping its own data + write plumbing (option C):
  - `GdmtTab` (demo) → Medblocks reads + idempotent writes; passes `taskHref` (Tasks-tab deep link) +
    the CarePlan-tab footer.
  - `pages/PatientView.tsx` (Epic) rewritten to MUI: themed patient app bar (name/age/MRN + "SMART on
    FHIR · Epic" chip) + `GdmtView`, wired to `loadPatient` (Epic in-browser token) and `data/writeActions`
    (+ new `createEchoOrder`); AI-explain reuses the source-agnostic `/api/rationale`.
  `GdmtView` supports both via optional `existingTasks`/`taskHref` (demo idempotency vs Epic untracked)
  and a `footer` slot; the "created" chip also honors a `done` action state so Epic (no task-refetch)
  still shows confirmation. Typecheck + lint clean, **145 tests green**. **Verified the demo host live**
  in-browser against the seeded HFrEF patient Harold (public HAPI via a local BFF): full panel renders +
  "Explain with cited AI" → per-pillar AI-drafted cited explanations, no console errors, no regression.
  **The Epic host renders the identical component but needs a redeploy + a MyChart login to eyeball** (I
  can't enter credentials). Still UNCOMMITTED (this + all 2026-07-21 work). Next: commit; redeploy; user
  re-launches Connect with Epic to confirm the polished panel; optional `VITE_FHIR_WRITE_BASE` for writes.
- 2026-07-21 (b): **Provider-facing migration — Phases 1–4** (plan: `docs/PROVIDER-MIGRATION.md`).
  User is repositioning the app from patient- to provider-facing (correct: GDMT scoring / Task+CarePlan
  writeback / CDS Hooks / risk triage are all clinician workflows a MyChart app can't do). Decision:
  support **both** provider flows — EHR launch (A) + provider standalone (B). (1) **P1 per-flow scopes:**
  `Launch.tsx` now uses `VITE_SMART_SCOPE_STANDALONE` (`launch/patient` + `user/*`), `EhrLaunch.tsx` uses
  `VITE_SMART_SCOPE_EHR` (`patient/*` + `launch online_access`), both falling back to the legacy single
  `VITE_SMART_SCOPE`; documented in `.env.example`. (2) **P4 clinician copy:** `Launch.tsx` reframed
  ("Clinician sign-in" / "Review your HF panel" / clinical-decision-support tagline); fixed the tab title
  `index.html` MediFlow Pro → **HF GDMT Optimizer**. (3) **P2 provider patient search — already built**:
  `PatientSelect.tsx` (real Epic `Patient?family=&given=` + open-by-id) + `Callback.tsx` `/select` route
  when the token has no patient + `loadPatient.getActivePatientId()`. Robust to `launch/patient` (Epic's
  own picker → straight to `/patient`; else the custom search). (4) **P3 real provider identity:** new pure
  `src/smartUser.ts` decodes the `id_token` → `fhirUser` claim → relative `Practitioner/id` + display (12
  tests); `smartAuth.completeAuth` captures `id_token`; `session` computes `provider` on login and adds
  `getProvider()` + `ensureProviderDisplay()` (reads the Practitioner when the token has only a reference);
  `writeActions.ts` stamps `Task/ServiceRequest.requester` + `CarePlan.author` with the real clinician on
  ALL Epic writes; `PatientView` shows an "Ordering as <provider>" chip. Demo path keeps
  `src/patients/currentUser.ts` "Dr. Smith". Build clean, **157 tests green** (12 new), changed files lint
  clean (repo has pre-existing lint debt, untouched). Tab-title + clinician login verified live in-browser.
  **Blockers/next:** P3's live fhirUser resolution needs a real Epic **provider** login — user reports the
  Epic app is flipped to Clinicians audience (P0 done); remaining **P5** = set per-flow scope vars +
  provider client id in Vercel, redeploy, then I drive the browser to verify EHR-launch + provider-standalone
  end to end. Note the sandbox test user is now a clinician, not `fhircamila`. All 2026-07-21 work still UNCOMMITTED.
- _YYYY-MM-DD: what got done, what's next, any blockers._
