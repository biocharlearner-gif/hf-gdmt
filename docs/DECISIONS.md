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
