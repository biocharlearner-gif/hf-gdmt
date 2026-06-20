# Progress Log & Feature Checklist

**Read this at the start of every session; update it before the session ends.**
Mark a feature done only after end-to-end verification (tests green / works against a real
sandbox), not just when code is written.

## Current status (as of 2026-06-18)
- React 19 + Vite + MUI SPA is up with routing (`src/App.tsx`). Engine + Patient Management
  covered by tests: **17 tests passing** (`src/engine/engine.test.ts` 5, `src/patients/patients.test.ts` 12).
- SMART standalone auth (PKCE) implemented in `src/smartAuth.ts`; in-memory session in `src/session.ts`;
  config-driven read/write-split client in `src/fhirClient.ts`.
- Read path wired end-to-end: `src/data/loadPatient.ts` fetches Patient/Observation/Condition/
  MedicationRequest/AllergyIntolerance → `buildEngineInput` → `evaluateGdmt`, rendered in `src/pages/PatientView.tsx`.
- Write path wired: `src/data/writeActions.ts` POSTs Task / lab ServiceRequest / CarePlan via the writeback builders.
- A separate **Patient Management** module (`src/patients/`) does CRUD against the public HAPI R4 server
  (no SMART auth) — patient list/search/create/edit, surfaced under `AppLayout` at `/patients`.
- Still **stubs / not yet integrated**: `src/cds/service.ts` (CDS Hooks handlers — not deployed),
  `src/ai/rationale.ts` (grounded LLM — not called from the app), terminology server (still hardcoded value sets).

## Next up (immediate)
1. Terminology client ($expand via ECL, cached) to replace the hardcoded HF value set; keep the fallback.
2. RAG cited-explanation module + wire `src/ai/rationale.ts` into the PatientView (engine facts + retrieved chunks → grounded rationale).
3. Deploy/wire the CDS Hooks service (`src/cds/service.ts`) and add a SMART-launch link from the card.
4. Verify reads/writes against the real Epic + a writable sandbox (Task/ServiceRequest/CarePlan).

## Feature checklist

### Tier A — MVP (must finish)
- [ ] Login page with **two flows**: "Launch via SMART on FHIR" (Epic) + "Continue with Demo
  Account" (no-friction, bypasses auth → patient list). See DECISIONS.md "Application workflow".
- [ ] Demo-account flow: skip SMART auth → patient list from configurable FHIR server (`.env` URL)
- [ ] Patient list page: name, DOB, gender, age (computed), GDMT status, actions
  (status column = engine-per-patient; overlaps Tier-B population panel — may stub for MVP)
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
- [~] Clinician-grade UI polish (MUI theme + AppLayout in place; PatientView still uses plain CSS classes)

### Tier C — Winning edge
- [~] Remote-monitoring alerts from patient-device vitals. **Thresholds clinician-reviewed &
  finalized 2026-06-20** (see docs/DECISIONS.md "Remote-monitoring alerts"). Decided: NO user-facing
  settings panel — cited config constants only.
  - [x] Pure engine `src/engine/alerts.ts` (weight-gain decompensation + titration-safety vitals, cited; 10 tests).
  - [x] Ingest: `buildAlertInput` in `src/fhir/extract.ts` (device `Observation` → `AlertInput`, kg/lb conversion).
  - [x] Writeback builders `buildDetectedIssue`/`buildFlagForAlert`/`buildTaskForAlert` in `src/fhir/writeback.ts`.
  - [x] Orchestration `src/data/alertActions.ts` (`loadAlerts`, `createAlertArtifacts`); 6 ingest/writeback tests.
  - [ ] Surface alerts in PatientView UI (accept → POST artifacts) + verify writes live.
  - [ ] FHIR `Subscription` push trigger (deployment-level, alongside CDS Hooks deploy).
- [ ] Terminology server integration (replaces hardcoded codes)
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
- _YYYY-MM-DD: what got done, what's next, any blockers._
