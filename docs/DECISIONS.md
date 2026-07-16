# Decisions & Domain Rationale

Distilled from project planning. This captures the *why* behind choices that aren't
obvious from the code. Update when a decision changes.

## Competitive frame (why we built it this way)
The challenge rewards: deep single-domain workflow + real EHR integration + clinical
reasoning beyond CRUD + guideline citations + advanced FHIR write-back + CDS Hooks.
Recent placers:
- **1st (MS Connect):** one specialty, deep, SMART Epic/Cerner, novel feature (trial matching).
- **2nd (OpenTrace):** abnormal-lab safety net, timeline reasoning, **RAG with cited guideline reasoning** (KDIGO/ADA/USPSTF), FHIR Task loop closure, CDS Hooks.
- **3rd:** GLP-1 clinic (full multi-role workflow); PHN maternity (real Oracle Cerner sandbox).

Takeaway: the winning ingredient isn't any single feature — it's **trustworthy, cited
clinical reasoning + closing the loop + real interoperability**, demoed crisply. Our edge
over OpenTrace: a flagship mortality-impact problem (GDMT) + a *deterministic* engine
(safer than pure-LLM) + a quantified benefit projection.

## Application workflow & entry points (login → assessment → loop closure)
The app has **two entry flows**, both landing in the same engine-driven assessment:

1. **SMART on FHIR (clinician launch) — the credibility path.**
   - Real Epic integration via SMART **standalone** launch (user opens the app; `Launch.tsx`),
     with EHR launch also supported (launched from inside Epic with a `launch` token; `EhrLaunch.tsx`).
     Both use OAuth2 + **PKCE** (public client,
     tokens in memory only, never localStorage). This is what scores EHR-integration points.
   - On launch we receive patient context (FHIR id) and go **straight to the patient profile**:
     demographics (`Patient`), problem list (`Condition`), vitals/labs (`Observation`),
     meds (`MedicationRequest`). The engine runs the two gates + 4-pillar assessment, shows the
     care gaps with citations, and offers loop-closure writes (Task/ServiceRequest/CarePlan).
   - Reads come from Epic; **writes go to the configured write server** (HAPI/Cerner) — read/write
     split, both config (`VITE_FHIR_*`), never hardcoded.

2. **"Continue with Demo Account" — the no-friction demo path.**
   - One of two buttons on the login page (`Launch.tsx` — a split two-pane layout: left = project
     explainer with key features, right = a light sign-in card). No username/password fields. It is
     **NOT a real credential check** — it simply bypasses SMART auth (navigates to `/patients`) so
     judges can try the app instantly. Do not invent/hardcode demo credentials; just skip auth.
   - Lands on a **patient list** fetched from a **configurable FHIR server** (public HAPI R4;
     base URL in `.env` / `import.meta.env.VITE_*`). This reuses the standalone Patient
     Management module's server, separate from the Epic SMART path.
   - List columns: name, date of birth, gender, **age (computed dynamically)**, GDMT **status**
     (which pillars the patient is on), action items. NOTE: the status column requires running
     the engine per patient → this is the Tier-B "population panel" and is a **stretch**, not MVP.
   - Selecting a patient opens the **same patient profile + assessment** as flow 1.

**Shared downstream journey (both flows):** patient profile → Gate 1 (HF cohort via terminology
server) → Gate 2 (LVEF ≤ 40 from `Observation` + `DiagnosticReport`) → eligible → engine computes
4-pillar status from meds → **create FHIR Task** per accepted gap → **CarePlan** bundles the pillars
into one GDMT program (loop closure). **The engine decides; never auto-prescribe; every output cited.**

**Where RAG/AI fits (explain-only):** the engine emits deterministic facts; a curated, cited KB is
retrieved against them; the **server-side** LLM renders the grounded, cited rationale shown next to
each gap. AI never picks a drug/dose/eligibility. See "Deterministic engine + RAG" below.

**CDS Hooks (planned):** one `patient-view` service — when a clinician opens the patient in the EHR,
the hook fires, our service runs the **same engine** (gates → pillars), and returns a **Card** with
GDMT status + a SMART-launch link back into this app. It is one service driven by the hook's patient
context, not a separate "get patient info" call.

## Eligibility: two gates
- **Gate 1 = cohort.** "Is this an HF patient?" via active+confirmed `Condition`. Use a
  **broad** value set (SNOMED umbrella 84114007, congestive HF 42343007, all phenotype
  children, + ICD-10 `I50.*`). Broad here is correct — we are only identifying the cohort.
- **Gate 2 = phenotype.** LVEF determines HFrEF (≤40) / HFmrEF (41–49) / HFpEF (≥50).
  Four-pillar GDMT applies to **HFrEF**. SGLT2i applies across the spectrum (reduced ruleset
  for non-HFrEF).
- **LVEF wins; code is fallback.** Phenotype-bearing codes (e.g. 703272007 = HFrEF) corroborate
  when LVEF is missing. HF patient with no LVEF and no phenotype code → `needsEf` (order echo).
- **Verify SNOMED codes in the official browser** before trusting them; better, resolve via a
  terminology server (`<< 84114007` ECL) or a VSAC value set rather than hardcoding.

## Why client-side condition filtering
- `clinical-status=active` can be pushed server-side, but `verificationStatus` is usually **not
  a searchable parameter** → must be checked client-side.
- Matching a broad HF set across **SNOMED + ICD-10** is brittle to express as server `code`
  search and varies by server. Problem lists are short, so fetch + filter locally is robust and cheap.

## Where LVEF (EF) actually lives — handle in priority order
1. `Observation.valueQuantity` (LOINC 10230-1) — structured. **Target this.**
2. `DiagnosticReport.result` → Observation — structured; follow the reference.
3. `DiagnosticReport.conclusion` / `.text.div` narrative — free text (unstructured).
4. `DiagnosticReport.presentedForm` — PDF attachment (binary).
5. Clinical note (`DocumentReference`) — prose, NLP territory.
Prefer structured; degrade to "EF unknown" (→ `needsEf`) rather than parsing narrative for the challenge.

## Read/write split
Reads are generous everywhere (Epic = recognizable credibility). Writes are restricted:
Epic sandbox allows a limited resource set; Cerner secure sandbox supports selected writes;
self-hosted HAPI writes anything. So read from Epic, write to HAPI/Cerner. Endpoints are config.
Cross-server caveat: a Task on HAPI referencing an Epic Patient is a cross-server reference —
fine for the demo (use absolute reference or load the patient into the write server).

## Deterministic engine + RAG (the safety story)
The engine deterministically decides recommendations from coded rules — it cannot hallucinate
a dose. RAG + LLM only render the *cited rationale* grounded in {engine facts + retrieved
guideline chunks}. Demo line: "the recommendation is deterministic and guideline-coded; the AI
only retrieves and cites the evidence." Keep the RAG KB small and curated (dozens of cited
recommendation statements, paraphrased; pull renal/K gating rationale from KDIGO). Copyright:
paraphrase + cite; short quotes only.

## Remote-monitoring alerts (patient-device vitals)
A deterministic alert layer on home-device vitals, on-thesis with the deep single-domain
HF workflow (our analog to OpenTrace's abnormal-lab safety net). Same safety model as the
GDMT engine: **the engine detects and cites; it never acts, orders, or titrates** — an
alert only notifies the care team, a human decides.

- **Scope is deliberately narrow.** Only HF-relevant vitals: weight-gain decompensation
  (flagship) + the vitals that gate GDMT titration (SBP, HR) + SpO₂ as a general red flag.
  No generic vitals dashboard — that would dilute the single-domain pitch.
- **Finalized rules (clinician-reviewed 2026-06-20), each cited:**
  - Weight gain >2.3 kg (~5 lb)/week → high; >0.9 kg (~2 lb) overnight → moderate
    — *HFSA self-care guidance*.
  - SBP < 90 mmHg → moderate (limits ARNI/ACEi/ARB & SGLT2i) — *AHA/ACC/HFSA 2022 §7.3.1*.
  - HR < 50 bpm → moderate (limits beta-blocker); HR > 100 resting → low — *§7.3.2*.
  - SpO₂ < 90% → high (general red flag, cited cautiously).
  - Stale readings (older than the recency window) are ignored, so a device that stopped
    reporting cannot fire a false alert.
- **Threshold review is a one-time, offline implementation check — NOT an in-app or
  per-alert step.** The citation proves the source; the review confirms we transcribed it
  faithfully and picked sensible values for the judgment calls the guideline leaves open
  (e.g. "overnight" = 1.5-day window). Done once (2026-06-20); the engine then applies the
  approved rules automatically with no human in the loop per alert.
- **No user-facing settings panel to edit thresholds.** Free editing would break the
  "deterministic + guideline-coded" guarantee and make the citations dishonest. Values live
  in one place (`ALERT_THRESHOLDS` in `codes.ts`) so they are config-shaped; any future
  tuning is admin/deployment config with the citation attached, never an end-user free box.
- **Runtime flow:** device reading → **stored as an `Observation`** → FHIR **`Subscription`**
  reacts to that new Observation and notifies our service → service reads recent Observations
  → builds `AlertInput` → `src/engine/alerts.ts` evaluates → on a hit, write back a
  **`DetectedIssue`** ("something concerning was found", linked to the triggering Observation
  + device for provenance) + optional **`Flag`** (chart banner) + **`Task`** (care-team
  follow-up). The Observation exists first; the Subscription reacts to it.
- **Status:** pure engine + tests done (`alerts.ts`, `alerts.test.ts`, 10 tests). Remaining:
  FHIR ingest (device `Observation` → `AlertInput`) and writeback (`DetectedIssue`/`Flag`/`Task`).

## Terminology server (planned)
`TerminologyClient` wrapping `$expand` (SNOMED ECL value-set expansion), `$validate-code`,
`$lookup`, `$subsumes`. Pre-expand value sets once at startup → in-memory Set for fast
membership checks; cache. Servers: `tx.fhir.org` (easiest) or a hosted Snowstorm (full ECL).
SNOMED licensing applies (India has a national license). Keep the hardcoded value set as fallback.

## TypeScript strictness
`strict` + `noUncheckedIndexedAccess` are on in both tsconfigs — CLAUDE.md always claimed this,
the configs just never set it. For a clinical engine, the flags that catch an unchecked
`labs[0]` or a silently-undefined LVEF are exactly the ones worth paying for. Turning them on
cost 4 errors, so there was no reason to weaken the convention instead.
`npm run typecheck` (`tsc -b`) now exists so the documented command is real.
