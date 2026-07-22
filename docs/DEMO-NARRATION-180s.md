# HF GDMT Optimizer — 180-Second Spoken Narration

*Spoken script for the demo video. ~470 words ≈ 3 min at a natural clinical-presenter pace.*
*Bracketed cues are on-screen actions, not spoken. Numbers on the left are running time.*

> **One example patient carries the whole demo: Harold Danforth (MRN HF-009).** He is engineered so a
> single HFrEF patient shows **all four pillar states at once** — plus the risk and alert story:
>
> | Pillar | State on Harold | What it teaches |
> |---|---|---|
> | RAAS inhibitor (ARNI) | **ON-TARGET** (400 mg/day) | fully optimized pillar |
> | Beta-blocker (carvedilol) | **SUB-TARGET, overdue** (12.5 mg/day, 60 days) | up-titration |
> | MRA | **CONTRAINDICATED** (K⁺ 5.2 > 5.0) | safety suppression with a reason |
> | SGLT2 inhibitor | **GAP — ELIGIBLE** (eGFR 55) | recommend + create a Task |
>
> Also: LVEF 30% (HFrEF phenotype), discharged 12 days ago (post-discharge risk +40), +2.6 kg this week
> (weight-gain alert). Engine-verified. **Before recording, reseed so Harold exists on the tenant:**
> `node --env-file=.env.local scripts/seed-hapi.mjs`.

---

**[0:00 — Title / live app on screen]**

Heart failure has four guideline-directed medicines that save lives — yet most patients are on the wrong
dose, or missing pillars entirely. The HF GDMT Optimizer closes that gap. Its core principle is a safety
principle: **the engine decides, the AI only explains.** Every recommendation is deterministic and coded to
the 2022 AHA/ACC/HFSA guideline — the AI never makes a clinical call. And it runs against **real FHIR APIs.**

**[0:20 — Login → Connect with Epic, then Demo]**

A clinician signs in two ways. **Connect with Epic** is a real SMART on FHIR launch — OAuth2 with PKCE,
verified live against the Epic sandbox on real patient data, tokens in memory only. I'll use the **Demo**
path to walk through one patient who shows everything.

**[0:38 — Patient list → open Harold Danforth]**

This list isn't the whole server — it's the **heart-failure cohort**, matched from coded HF Conditions
expanded on a **terminology server**, and ranked **sickest-first** by a transparent risk score. Let's open
**Harold Danforth.**

**[0:52 — GDMT tab: phenotype gate + score]**

Two gates run first. Gate one put Harold in the cohort. Gate two reads his **LVEF — 30 percent — so he's
HFrEF**, and the full four-pillar program applies. **LVEF always wins;** if it were missing, we'd order an
echo, not guess.

**[1:05 — The four pillar cards — this is the core]**

Now watch all four pillars — one patient, four different answers. His **ARNI is at target** — optimized,
nothing to do. His **beta-blocker is sub-target** — twelve-and-a-half milligrams for sixty days — so the
engine flags it **overdue for up-titration**. His **MRA is contraindicated**: potassium five-point-two is
above five, so we *suppress* the recommendation and **show the reason** instead of pushing a drug. And his
**SGLT2 inhibitor is an open, eligible gap** — eGFR is fine, so we recommend starting it. Every line carries
a guideline citation, and it **never** auto-prescribes.

**[1:32 — Click "Explain with cited AI"]**

This is the only place AI is used. It drafts a plain-language rationale for each pillar — but the
**citations come from our retriever, never the model**, so a hallucinated source is impossible. It ships
free and never breaks the demo.

**[1:52 — Close the loop back into the chart]**

Now we **close the loop.** For the SGLT2i gap, one click writes a FHIR **Task**; the sub-target
beta-blocker becomes an up-titration Task; and we generate a **CarePlan** — a real, printable deliverable
with goals and per-pillar activities. All idempotent — no duplicates.

**[2:18 — Vitals: risk + alert]**

Beyond the visit, remote monitoring is watching. Harold was **discharged twelve days ago** — the vulnerable
phase — and he's **up 2.6 kilos this week**, so a cited **weight-gain alert** fires, raising a Flag and a
Task before anything is charted by hand.

**[2:38 — CDS Hooks card]**

And it meets the clinician **inside the EHR**: a live **CDS Hooks** card surfaces these same gaps at the
point of care, with a SMART link straight into this view.

**[2:52 — Architecture / close]**

Underneath: **one pure, deterministic engine** shared by the app, the CDS service, and the tests — a
config-driven read/write split, a hundred-and-fifty-plus tests, and it degrades gracefully on messy real
data instead of crashing. **The engine decides; the AI explains; the loop closes** — end to end, on real
FHIR. Thank you.

**[3:00 — End]**


https://sandbox.cds-hooks.org/?serviceDiscoveryURL=https%3A%2F%2Fhf-gdmt.vercel.app%2Fcds-services&fhirServiceUrl=https%3A%2F%2Fhapi.fhir.org%2FbaseR4&patientId=137203927



{
  "hook": "patient-view",
  "id": "hf-gdmt-optimizer",
  "title": "HF GDMT Optimizer",
  "description": "Flags heart-failure patients below guideline-directed medical therapy and links to the optimizer.",
  "prefetch": {
    "patient": "Patient/{{context.patientId}}",
    "conditions": "Condition?patient={{context.patientId}}",
    "medications": "MedicationRequest?patient={{context.patientId}}",
    "observations": "Observation?patient={{context.patientId}}&_sort=-date"
  },
  "enabled": true
}


https://hapi.fhir.org/baseR4