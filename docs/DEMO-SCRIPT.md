# HF GDMT Optimizer — Demo Script

**One-line thesis to open with:** *"The engine decides; AI only explains."* Every recommendation is
deterministic and guideline-coded (2022 AHA/ACC/HFSA); the AI layer only renders cited rationale — it
never makes a clinical decision. That is the safety story, and it runs end-to-end against **real FHIR APIs**.

---

## 1. Feature walkthrough — every notable feature we built

Present these in order; each is a talking point, not just a bullet.

### A. Two entry flows (provider-facing)
- **Connect with Epic (SMART on FHIR)** — real OAuth2 + PKCE standalone launch **and** EHR launch.
  Verified live end-to-end against the **Epic sandbox** on real patient data (MyChart/clinician login →
  live read path → 4-pillar GDMT). Tokens live in memory only, never in localStorage.
- **Continue with Demo Account** — no-auth path to the seeded HF cohort (Medblocks tenant), used for the
  rich, story-driven walkthrough.
- **Provider identity is real:** the `id_token` `fhirUser` claim is decoded to the actual `Practitioner`,
  and every write is stamped with that clinician ("Ordering as Dr. …").

### B. HF cohort + two-gate eligibility (the clinical rigor)
- **Gate 1 (cohort):** active + confirmed HF `Condition` matched against a **terminology-server-expanded**
  value set (SNOMED ECL `<< 84114007` via CSIRO Ontoserver `$expand`) + ICD-10 `I50.*`, with a hardcoded
  fallback so a flaky tx server never blocks the demo.
- **Gate 2 (phenotype):** derived from **LVEF** — HFrEF = LVEF ≤ 40%. **LVEF always wins** over
  diagnosis-code hints; no LVEF → we *order an echo*, we don't guess.
- Patient list **is** the cohort — All / HF / Non-HF filter, Age column, and a **sortable HF-risk column**
  for sickest-first triage.

### C. The flagship — 4-pillar GDMT assessment (deterministic engine)
- Four Class-1 pillars for HFrEF: **RAAS inhibitor (ARNI preferred), evidence-based beta-blocker, MRA,
  SGLT2 inhibitor.** Drugs classified by **RxNorm/ATC value sets**, never free-text.
- Each pillar is **lab/vital-gated with contraindication checks** (e.g. K⁺ 5.2 > 5 → MRA
  *contraindicated*, with the reason shown and **no** action offered).
- **GDMT score + optimization %**, and a **dose-adequacy bar** (daily vs target mg, % of target) that
  flags sub-target pillars.
- **"Due for up-titration"** timing — reads `MedicationRequest.authoredOn`, and past the titration
  interval a sub-target pillar shows an amber up-titration prompt (deterministic on an injected `now`).
- **GDMT journey stage banner** — Initiation → Active titration → Optimized, classified purely from the
  pillar data (no visit-type EHR dump).
- **Benefit projection** — current vs potential vs incremental relative-risk-reduction from the pivotal
  HFrEF trials; labelled *illustrative, not predictive*.
- **Never auto-prescribes.** Output is decision support, always carrying a guideline citation.

### D. RAG cited explanations — "AI explains, engine decides"
- Curated, **cited** knowledge base (~18 paraphrased 2022 AHA/ACC/HFSA statements — paraphrase, not
  verbatim, for copyright) + a **deterministic retriever** (no embedding service → same facts always
  retrieve the same evidence, fully auditable).
- **Citations come from the retriever, never the LLM** — the model writes prose only; the app attaches
  the cited refs, so a hallucinated source is structurally impossible.
- Render precedence: **live LLM (if API key) → AI-drafted pre-baked → deterministic template.** Ships
  **free** with AI-quality pre-baked cited prose ("AI-drafted explanation — grounded & cited"); adding
  `ANTHROPIC_API_KEY` upgrades to per-value live prose with identical citations. **The demo never breaks.**

### E. Loop closure — writing back to the chart
- **Create a FHIR `Task` per accepted gap** (idempotent — no duplicates on re-click or reload; "View task"
  deep-link once created).
- **Order labs** (BMP `ServiceRequest`) for stale/missing labs, **order an echo** when LVEF is missing.
- **Generate a GDMT `CarePlan`** — a real rendered artifact (goals, per-pillar activities linked to their
  Tasks, benefit snapshot, citations), idempotent Generate/Regenerate, plus **Print / Save PDF** handout.

### F. Remote-monitoring (Tier-C edge)
- Pure **alert engine** — threshold rules (weight-gain decompensation, hypotension, brady/tachycardia,
  hypoxia) **plus predictive trend rules** (rising-weight, declining-SpO₂ early warning).
- **HF risk score** (0–100, severity-weighted, auditable contributors) — surfaced on Vitals, ranks the
  Tasks list sickest-first, and drives the Patient-List risk column. **HF hospitalization** feeds it (+40
  in the 30-day vulnerable post-discharge phase).
- **Full Task workflow** (shared card): accept → start → complete (notes required) / cancel (reason
  required); **alert → action → outcome** chip that re-evaluates and reports "improved" vs "still abnormal".
- **Citation deep-links** everywhere (ref → source + section + live 2022 AHA/ACC/HFSA DOI).

### G. CDS Hooks — decision support inside an EHR
- Live **patient-view** service: `GET /cds-services` discovery + `POST …/hf-gdmt-optimizer` returns a
  cited card ("0 of 4 pillars", 4 gap bullets §7.3.1–7.3.4, +RRR, **SMART-launch link** to the GDMT view).
- Demoed in the **public CDS Hooks Sandbox** with a self-contained HFrEF patient — one-click deep-link
  loads service + FHIR + patient and renders the card. (Card-in-Epic itself needs an Epic-customer
  environment; the launch half is verified on real Epic.)

### H. Architecture the judges care about
- **One pure, deterministic engine** shared by the SPA, the CDS Hooks service, and the tests — logic lives
  once (no `Date.now`, `now` injected).
- **Read/write split** — reads from one FHIR base (Epic), writes to another (HAPI/Medblocks), both
  **config, never hardcoded** — swappable live.
- **BFF** (Bun locally / Vercel serverless functions in prod) keeps the tenant Bearer token **server-side**;
  the client bundle never ships a token or the LLM SDK.
- **TypeScript strict** (`noUncheckedIndexedAccess`), **~157 vitest tests green**, degrades gracefully on
  missing FHIR data (`INSUFFICIENT_DATA` / Unknown, never crash). **Live at https://hf-gdmt.vercel.app.**

---

## 2. FHIR resources used — and why (short + crisp)

| Resource | Read / Write | Why we use it |
|---|---|---|
| **Patient** | Read | Demographics + the identity anchor for every other query. |
| **Condition** | Read / Write | **Gate 1** cohort membership (active+confirmed HF); we also write coded problem-list Conditions from Add-Patient. |
| **Observation** | Read / Write | Labs (K⁺, eGFR, creatinine, NT-proBNP/BNP), **LVEF** for Gate 2, and home-device vitals for remote monitoring. |
| **MedicationRequest** | Read | Detects which of the 4 pillars a patient is on (RxNorm-classified) + `authoredOn` for up-titration timing. |
| **AllergyIntolerance** | Read | Contraindication / allergy suppression of a pillar recommendation. |
| **Encounter** | Read | Most-recent HF **inpatient** encounter → post-discharge vulnerable-phase risk signal. |
| **Task** | Read / Write | Loop closure — one Task per accepted GDMT gap or accepted alert; the clinician work queue. |
| **ServiceRequest** | Write | Orders — a BMP lab panel for stale labs, an echocardiogram when LVEF is missing. |
| **CarePlan** | Read / Write | The GDMT plan as a real deliverable (goals + per-pillar activities linked to Tasks). |
| **DetectedIssue** | Write | Records a remote-monitoring alert as a coded clinical finding. |
| **Flag** | Write | Surfaces that alert prominently on the patient banner. |
| **Goal** (contained) | Write | Contained in the CarePlan — the target for each pillar. |
| **ValueSet / $expand** | Terminology op | Server-side expansion of the HF (SNOMED ECL) and diagnosis value sets — terminology rigor, not string matching. |
| **Subscription** | Write | Registers the server-push trigger for the remote-monitoring pipeline (see §3). |
| **DocumentReference** | *(planned)* | Write-permission-tolerant CarePlan publish-back (most EHRs gate `CarePlan.write` but allow document write) — designed, not yet shipped. |

**Value-set / coding note:** drugs are classified via **RxNorm/ATC** value sets and diagnoses via
**SNOMED / ICD-10**, expanded on a terminology server ($expand, with a hardcoded fallback) — never
free-text matching.

---

## 3. FHIR Subscription — implementation + the honest "not done" note

**Your understanding, clarified:** A FHIR `Subscription` is the *push trigger*. It tells the FHIR server:
*"whenever a resource matching this criteria is created/updated, POST a notification to my endpoint."*
It is the mechanism that lets us react to a new vital **without anyone opening the app**.

**What we built:**
- `src/fhir/subscription.ts` builds an **active `rest-hook` Subscription** scoped to
  `Observation?category=vital-signs` (so lab results and unrelated Observations never wake the HF alert
  engine), tagged for cleanup, `payload: application/fhir+json`.
- The notified endpoint is our **alert service** (`server/alertService.ts`, exposed as `/notify`): on a
  notification it **re-reads the patient's recent Observations → runs the pure alert engine →
  writes back `DetectedIssue` + `Flag` + `Task`** (same engine + builders as the UI, idempotent).
- Registered live on the Medblocks tenant pointing at `https://hf-gdmt.vercel.app/notify`, flipped to
  `status: active`. The **full loop is verified** via a direct `POST /notify` (engine fires 2 alerts →
  writes artifacts → re-invoking creates **no duplicates**).

**⚠️ Note for the demo — what is NOT done (be upfront about this):**

1. **Automatic server-side delivery is not exercised end-to-end.** The Medblocks/HAPI sandboxes do **not**
   actually deliver the rest-hook callback when a new Observation is saved (server-side Subscription
   delivery is commonly disabled on hosted sandboxes, and a hosted server can't POST to `localhost`). Our
   service, builders, engine, and idempotency all work when invoked directly — but "save a vital → the
   server pushes to us automatically" can only be shown once we sit behind a delivery-capable FHIR server.
   For the demo we trigger the same loop via a **direct `/notify` call** or the **Vitals-tab Accept** path.

2. **There is no direct message to a physician over a communication medium.** Right now the pipeline's
   output is **FHIR artifacts** — a `Flag`/`DetectedIssue` on the chart and a `Task` in the clinician's
   work queue (in-EHR notification). We do **not** currently send an out-of-band alert (email / SMS / pager
   / push) or write a FHIR **`Communication` / `CommunicationRequest`** to formally route the message to a
   named physician. That is the natural next step: on an alert, additionally emit a `CommunicationRequest`
   (recipient = the patient's care-team Practitioner) and/or fan out to a real channel — deliberately left
   out of the current implementation and called out here as future work.
