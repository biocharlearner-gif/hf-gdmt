# Progress Log & Feature Checklist

**Read this at the start of every session; update it before the session ends.**
Mark a feature done only after end-to-end verification (tests green / works against a real
sandbox), not just when code is written.

## Current status
- Scaffold built and modified locally. Engine + Gate 1 covered by tests (vitest).
- _Update this line each session with where things actually stand._

## Next up (immediate)
1. Wire real Epic reads into `extract.ts`: fetch problem-list `Condition` + LVEF `Observation`
   + meds/labs/vitals, feed `buildEngineInput`.
2. `TerminologyClient` ($expand via ECL, cached) to replace hardcoded HF value set; keep fallback.
3. RAG cited-explanation module (curated KB; engine facts + retrieved chunks → grounded rationale).

## Feature checklist

### Tier A — MVP (must finish)
- [ ] SMART standalone launch + OAuth/PKCE against Epic sandbox; patient context
- [ ] Read Patient/Condition/Observation/MedicationRequest/AllergyIntolerance
- [ ] Engine: 4-pillar status + GDMT score (DONE in scaffold; verify against real data)
- [ ] Gate 1 HF cohort + eligibility (DONE in scaffold; extend value set)
- [ ] Pillar panel UI + per-gap reason + citation
- [ ] Create FHIR Task per accepted gap (write server)

### Tier B — Competitive
- [ ] Dose-adequacy + up-titration suggestions (engine done; surface in UI)
- [ ] Contraindication/allergy suppression with reasons (engine done; surface in UI)
- [ ] Stale-lab detection + lab ServiceRequest (engine flags; wire write)
- [ ] GDMT CarePlan generation (builder done; wire write)
- [ ] Population panel ranked by GDMT score / unrealized benefit
- [ ] Clinician-grade UI polish

### Tier C — Winning edge
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
- _YYYY-MM-DD: what got done, what's next, any blockers._
