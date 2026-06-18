# HF GDMT Optimizer

SMART on FHIR app for the **Medblocks FHIR App Challenge** (15-day build, real FHIR APIs).
It scores a heart-failure patient against guideline-directed medical therapy (GDMT), explains
each gap with citations, and writes FHIR Tasks to close the loop. Goal: place top-3.

> Full spec: `docs/HF-GDMT-Optimizer-Spec.md` · Decisions & rationale: `docs/DECISIONS.md` · Status & next steps: `docs/PROGRESS.md`. Read `docs/PROGRESS.md` at the start of each session and update it at the end.

## Winning thesis (keep this coherent — don't feature-creep)
- Deep single-domain workflow: **HFrEF GDMT optimization**, end to end.
- **The engine decides; AI only explains.** Recommendations are deterministic and guideline-coded; the LLM/RAG layer only renders cited rationale. This is a safety advantage — never blur it.
- Differentiators, in priority order: deterministic engine → terminology-server rigor → RAG cited explanations → CDS Hooks + loop closure → benefit projection → multi-EHR.

## Architecture rules (load-bearing — do not violate)
- **Engine is pure and deterministic.** No I/O, no `Date.now`; inject `now` for recency. The same engine module is shared by the SPA, the CDS Hooks service, and tests. Logic lives once.
- **Read/write split.** Reads go to one FHIR base URL (Epic sandbox), writes (Task/ServiceRequest/CarePlan) go to another (HAPI or Cerner). Both are **config**, never hardcoded — swappable live.
- FHIR **R4**. SMART standalone launch with **OAuth2 + PKCE** (public client, tokens in memory, never localStorage).
- **Terminology binding via a terminology server** ($expand with SNOMED ECL, $validate-code, $lookup). Pre-expand value sets once and cache; keep a hardcoded value set as fallback so a flaky server never blocks the build.
- **RAG grounds the explanation, not the decision.** Curated, cited guideline knowledge base; LLM output is grounded strictly in engine facts + retrieved chunks.

## Clinical rules (must hold — a doctor judges this)
- **Two gates for eligibility.** Gate 1: active+confirmed HF `Condition` (broad value set across SNOMED + ICD-10 `I50.*`) = cohort. Gate 2: phenotype from **LVEF** — HFrEF = LVEF ≤ 40%. Four-pillar program is **HFrEF only**.
- **LVEF wins** over diagnosis-code phenotype hints. If HF patient but no LVEF → `needsEf` (order-echo gap), not a guess.
- Four pillars (HFrEF, all Class 1): RAAS inhibitor (ARNI preferred), evidence-based beta-blocker, MRA, SGLT2 inhibitor. Each is lab/vital-gated with contraindication checks.
- **Never auto-prescribe.** Output is decision support; never phrase as an order. Always carry a guideline citation.
- Clinical thresholds in `codes.ts` are starter values — **verify against the 2022 AHA/ACC/HFSA guideline** before trusting.
- **Copyright:** when building the RAG knowledge base, paraphrase guideline statements with citations; short quotes only; never ingest full copyrighted guideline text.

## Conventions
- TypeScript strict (`noUncheckedIndexedAccess` on). ESM modules.
- Tests: **vitest**. Every engine/eligibility change needs a test with synthetic fixtures.
- Classify drugs via **value sets (RxNorm/ATC)**, never free-text matching, in production paths.
- Degrade gracefully on missing/partial FHIR data → `INSUFFICIENT_DATA` / `Unknown`, never crash.

## Commands
- Install: `npm install`
- Test: `npm test`  ·  Typecheck: `npm run typecheck`

## Key files
- `src/engine/` — pure rule engine (types, codes, rules, engine, benefit)
- `src/fhir/extract.ts` — FHIR → EngineInput · `src/fhir/conditions.ts` — Gate 1 · `src/fhir/writeback.ts` — Task/ServiceRequest/CarePlan
- `src/smart/` — PKCE auth + config-driven FHIR client (read/write split)
- `src/cds/service.ts` — CDS Hooks (reuses the engine) · `src/ai/rationale.ts` — grounded LLM (server-side only)
