# Migration: patient-facing → provider-facing (SMART on FHIR)

**Status:** IN PROGRESS. **Phases 1, 2, 3, 4 DONE** (2026-07-21, build clean, 157 tests green).
- **P1** per-flow scopes · **P4** clinician copy — done + verified live.
- **P2** provider patient search — **found already built** (`PatientSelect.tsx` real Epic
  `Patient?family=&given=` search + open-by-id; `Callback.tsx` routes to `/select` when the token
  has no patient; `loadPatient.ts` reads `getActivePatientId()`). No new code needed.
- **P3** real provider identity — done: capture `id_token` → `fhirUser` claim
  (`src/smartUser.ts`, pure + 12 tests) → `session.getProvider()` / `ensureProviderDisplay()` →
  `Task.requester` / `CarePlan.author` on all Epic writes (`writeActions.ts`) + "Ordering as …"
  chip in the SMART `PatientView`. Kept `src/patients/currentUser.ts` "Dr. Smith" for the demo path.

Remaining: **Phase 0** (Epic registration — user reports DONE, flipped to Clinicians audience),
**Phase 5** (Vercel env with per-flow scope vars + live verify — needs the real provider login to
confirm P3's fhirUser resolution end-to-end).
**Decision (2026-07-21):** support **both** provider flows — EHR launch (A) + provider standalone (B).

> TL;DR — the app is *already* a clinician tool (GDMT scoring, FHIR `Task`/`CarePlan` writeback,
> CDS Hooks, "owner = Dr. Smith"). This migration aligns the **SMART launch + Epic registration**
> with what the app already does. Flow **A (EHR launch) is ~90% built**. Flow **B (provider
> standalone) needs one real new screen: an Epic patient search**, because a provider — unlike a
> patient — has no single patient in context.

---

## 1. Why provider-facing is the right call

A patient-facing (MyChart) app **cannot**:
- write a `Task` assigned to a physician (`owner = Practitioner`),
- fire **CDS Hooks** `patient-view` cards (a clinician surface only),
- triage a **cohort** sickest-first, or generate a clinician `CarePlan`.

Every one of those is already built. The current "Patients" Epic audience is the mismatch, not the
code. Provider-facing is the coherent target for the winning thesis (decision support for clinicians).

---

## 2. What's already there (no rebuild)

| Piece | File | State |
|---|---|---|
| **EHR-launch entry** (`/launch`, reads Epic `iss`+`launch`, PKCE) | `src/pages/EhrLaunch.tsx` | ✅ built |
| **Standalone "Connect with Epic"** (PKCE) | `src/pages/Launch.tsx` | ✅ built (patient-standalone today) |
| Config-driven scope | `VITE_SMART_SCOPE` env | ✅ swappable, no code change to re-scope |
| CDS card → `/launch` SMART link | `src/cds/service.ts:74` | ✅ correct for EHR launch |
| Write path (Task/ServiceRequest/CarePlan) | `src/data/writeActions.ts` | ✅ built |
| Provider identity on artifacts | `src/currentUser.ts` (hardcoded "Dr. Smith") | ⚠️ upgrade opportunity (§5) |

---

## 3. The three real dividing lines (patient vs provider)

| Concern | Now (patient) | Provider target |
|---|---|---|
| **Epic App Audience** (registration) | Patients → MyChart OAuth | **Clinicians** → Hyperspace OAuth. **May require a NEW app/client id** — audience often can't be flipped on an existing registration. |
| **Scopes** | `patient/*.read` (single patient in context) | **A:** `patient/*.read` + `launch` + `online_access` (patient from EHR). **B:** `launch/patient` + `user/*.read` (provider logs in, then picks a patient). |
| **Launch flow** | Standalone patient login | **A:** EHR launch (existing `EhrLaunch.tsx`). **B:** provider standalone + **patient search** (NEW). |

---

## 4. Phased plan

### Phase 0 — Epic registration · **USER ACTION** (fhir.epic.com)
Builds on `docs/EPIC-LAUNCH.md` STEP A. Deltas for provider-facing:
1. **App Audience → Clinicians / Providers.** (If the current app `ba035637…` won't let you change
   audience, register a **new** non-prod app — new client id — and use it everywhere below.)
2. **Redirect URI:** `https://hf-gdmt.vercel.app/callback` (+ keep `http://localhost:5173/callback`).
3. **Launch URL:** `https://hf-gdmt.vercel.app/launch` (required for EHR launch / the CDS card link).
4. **Incoming APIs (R4):** `Patient.Read` · `Condition.Read` · `Observation.Read` ·
   `MedicationRequest.Read` · `AllergyIntolerance.Read` · `Encounter.Read`
   (+ optional writeback `Task.Create` · `ServiceRequest.Create` · `CarePlan.Create`).
5. **Sandbox login is now a PROVIDER user**, not `fhircamila` (that's a patient). Use Epic's sandbox
   clinician credentials for testing.

### Phase 1 — Scopes become per-flow · **CODE** (small)
Today `VITE_SMART_SCOPE` is one string shared by `Launch.tsx` and `EhrLaunch.tsx`. Two flows need
two scope sets:
- **EHR launch** (`EhrLaunch.tsx`): `openid fhirUser launch online_access patient/Patient.read patient/Condition.read patient/Observation.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Encounter.read`
- **Provider standalone** (`Launch.tsx`): `openid fhirUser launch/patient user/Patient.read user/Condition.read user/Observation.read user/MedicationRequest.read user/AllergyIntolerance.read user/Encounter.read`

Options (pick at review):
- **(a)** Add `VITE_SMART_SCOPE_EHR` + `VITE_SMART_SCOPE_STANDALONE` env vars (cleanest, explicit).
- **(b)** One superset scope string for both (simpler, but Epic rejects scopes the app didn't register — must keep them all registered).
Recommend **(a)**.

### Phase 2 — Provider standalone patient search · **CODE** (the one real new build)
A provider logging in standalone has **no `patient` in the token** — `launch/patient` makes Epic
prompt for patient selection, OR the app must search. The current Epic read path
(`src/data/loadPatient.ts` → `src/pages/PatientView.tsx`) assumes `session.patient` is set (true for
patient standalone and EHR launch, **false** for provider standalone).

Need: after callback, if no patient in context → a **patient-search screen against Epic**
(`Patient?name=` / `?identifier=`), then set `session.patient` and route to `/patient`.
- New: `src/pages/EpicPatientSearch.tsx` + a `searchPatients()` on the Epic-authenticated client.
- This is distinct from the existing demo patient list (`src/patients/`, HAPI/BFF — do not merge).
- **`launch/patient` shortcut:** if Epic's patient-selection prompt is acceptable, the token comes
  back WITH a patient and this screen can be skipped — verify against the sandbox before building.

### Phase 3 — Real provider identity · **CODE** (feature upgrade the migration unlocks)
Replace hardcoded `currentUser.ts` "Dr. Smith" with the **real logged-in provider** from the
`fhirUser` claim / `id_token`. Stamp `Task.owner` and `CarePlan.author` with the actual
`Practitioner`. Keep "Dr. Smith" as the fallback for the demo/no-auth path.

### Phase 4 — UX / copy reframe · **CODE** (light)
- `Launch.tsx`: reframe sub-copy from patient-explore to clinician ("Sign in as a clinician to review
  your HF panel"). Buttons already read "Connect with Epic". Demo button stays (no-auth clinician demo).
- Confirm nav/labels read clinician-first (they largely do — "cohort", "Tasks", risk triage).

### Phase 5 — Vercel env + verify live · **USER + ME**
Per `EPIC-LAUNCH.md` STEP B/C but with the provider client id + new per-flow scope vars, then redeploy
(VITE_* is build-time inlined). I drive the browser to verify:
- **A:** simulate an EHR launch to `/launch?iss=…&launch=…` (or via CDS Hooks Sandbox link) → GDMT.
- **B:** Connect with Epic → provider login → patient search/select → GDMT on real Epic data.

---

## 5. Honest constraints (carry into the demo)
- **CDS card can't be shown firing in Epic's public sandbox** (Epic-customer Hyperspace only — see
  `EPIC-LAUNCH.md`). Demo the card in the **CDS Hooks Sandbox**; demo the **launch + data** as real Epic.
- **App Audience flip may force a new client id** — if so, update memory `hf-gdmt-epic-sandbox` and
  every `VITE_SMART_CLIENT_ID` location.
- Epic's provider standalone patient-selection behavior (`launch/patient`) should be **verified in the
  sandbox before building Phase 2** — it may make the custom search screen unnecessary.

---

## 6. Effort summary

| Phase | Type | Size |
|---|---|---|
| 0 Registration | user | ~30 min (fhir.epic.com) |
| 1 Per-flow scopes | code | small |
| 2 Provider patient search | code | **medium — the only real new screen** |
| 3 Real provider identity | code | small–medium |
| 4 UX copy | code | small |
| 5 Env + live verify | user + me | small |

Green-light this and I'll start with Phase 1 (scopes) + Phase 4 (copy) — pure code, no dependency on
the Epic registration — while you do Phase 0.
