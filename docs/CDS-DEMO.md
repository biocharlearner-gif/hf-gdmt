# CDS Hooks — live demo walkthrough

Shows the deployed **HF GDMT Optimizer** CDS Hooks service firing a `patient-view`
card inside a real CDS-Hooks client (the public **CDS Hooks Sandbox**), driven by real
FHIR data. Verified live 2026-07-21.

> **Thesis reminder:** the engine decides, the card only surfaces it. The card content
> (score, eligible gaps, benefit %, citations) is the *same pure engine* that powers the
> SPA — see `src/cds/service.ts` → `evaluateGdmt`. No LLM in this path.

## Live endpoints (already deployed)

- Discovery: `GET  https://hf-gdmt.vercel.app/cds-services`
- Card:      `POST https://hf-gdmt.vercel.app/cds-services/hf-gdmt-optimizer`

The card only appears for an **HFrEF** patient (LVEF ≤ 40) with at least one eligible
gap; it returns `{ "cards": [] }` when nothing is actionable (fully optimized or not HFrEF).

## Why the sandbox points at public HAPI, not our own tenant

A CDS-Hooks client resolves the service's **prefetch** templates itself (client-side) and
POSTs the bundles to the service. That means the client's browser fetches directly from
whatever FHIR server you configure, so that server must be **CORS-open** and **R4**.

Our production FHIR proxy (`/api/fhir`) **deliberately emits no CORS header** — it carries
the tenant Bearer token server-side and must not be an open, token-bearing proxy (see
`server/fhirProxy.ts`). So we do **not** point the sandbox at it. Instead we seed a small,
self-contained HFrEF demo patient onto **public HAPI R4** (`https://hapi.fhir.org/baseR4`,
CORS-open) and point the sandbox there.

### Demo patient (public HAPI R4)

| Field    | Value |
| -------- | ----- |
| Name     | Harold J. Whitmore |
| Patient  | `137203927` |
| Tag      | `urn:hf-gdmt:demo\|cds-hooks-v1` |
| Data     | HF `Condition` (SNOMED 84114007 / ICD-10 I50.9) · LVEF **28%** · K+ 4.2 · eGFR 68 · HR 72 · SBP 118 · **no GDMT meds** → all four pillars `GAP_ELIGIBLE` |

Re-seed with `node scripts/seed-cds-demo.mjs` (plain node, no env needed). Public HAPI
purges old data, so confirm the patient still exists before demoing:
`GET https://hapi.fhir.org/baseR4/Patient/137203927` (re-run the seed if it 404s — the new
id it prints goes in the deep-link's `patientId`).

## One-click reproduction (deep-link)

The sandbox reads config from the query string. This single URL loads our service, points
FHIR at HAPI, and selects the demo patient — the card renders on load:

```
https://sandbox.cds-hooks.org/?serviceDiscoveryURL=https%3A%2F%2Fhf-gdmt.vercel.app%2Fcds-services&fhirServiceUrl=https%3A%2F%2Fhapi.fhir.org%2FbaseR4&patientId=137203927
```

### Manual path (fallback if the deep-link params change)

Open `https://sandbox.cds-hooks.org` → gear menu (top-right):
1. **Add CDS Services** → `https://hf-gdmt.vercel.app/cds-services`
2. **Change FHIR Server** → `https://hapi.fhir.org/baseR4`
3. **Change Patient** → `137203927`

## What the card shows (verified)

- **Summary:** `HF below target GDMT: 0 of 4 pillars` (warning indicator)
- **Detail:** `LVEF 28% (HFrEF). Closing eligible gaps adds ~73% relative reduction in CV
  death / HF hospitalization (illustrative).`
- **Four cited gap bullets**, each with its guideline section:
  - RAAS inhibition — Eligible: K+ 4.2 (≤5.5), eGFR 68 (≥30). ARNI preferred. *(§7.3.1)*
  - Evidence-based beta-blocker — Eligible: HR 72 (≥60). *(§7.3.2)*
  - MRA — Eligible: K+ 4.2 (≤5), eGFR 68 (≥30). *(§7.3.3)*
  - SGLT2 inhibitor — Eligible: eGFR 68 (≥20). *(§7.3.4)*
- **Source:** HF GDMT Optimizer → https://hf-gdmt.vercel.app
- **Link:** `Open GDMT Optimizer` → `https://hf-gdmt.vercel.app/launch` (`type: smart`). Per the
  CDS Hooks spec the EHR appends `iss`+`launch` on click, so the URL targets the app's SMART
  **launch endpoint** (`/launch`). (Was `?patient=…` → the login page; fixed 2026-07-21. The
  live deploy shows the new link only after a redeploy.)

## The SMART-launch caveat (expected — not a bug)

In the sandbox the launch button is disabled with *"Cannot launch SMART link without a
SMART-enabled FHIR server"*, and the console logs a 400 from the sandbox's launch-context
handshake. That is the **sandbox** trying to negotiate a SMART launch against public HAPI,
which is not SMART-auth-enabled — it is **not** a defect in our card. The card's launch
link is correctly formed.

Two ways to show the "launch → lands on the GDMT tab" step in the video:
1. **Real Epic sandbox (seamless):** register the service in Epic's CDS config. Because the
   same FHIR server backs both the EHR and the SMART app, the launch context resolves and
   the `?patient=<id>` link lands directly on the patient's GDMT tab. (Heavier setup; Epic
   creds in memory `hf-gdmt-epic-sandbox`.)
2. **Two-shot (pragmatic):** screenshot the card in the sandbox, then cut to the live app
   opened on a real patient's **GDMT** tab (e.g. Eleanor Reyes, the rich HFrEF case) to show
   the destination. The card mechanics and the destination are both real; only the
   cross-server SMART handshake is simulated.

## 30-second narration script

> "On opening a heart-failure patient, our CDS Hooks service fires automatically — no
> clicks. The card is produced by the *same deterministic engine* as the app: it flags that
> this HFrEF patient is on **0 of 4** guideline pillars, lists each **eligible** gap with its
> **2022 AHA/ACC/HFSA citation**, and quantifies the upside — **~73% relative risk
> reduction** if the gaps are closed. One click on *Open GDMT Optimizer* SMART-launches the
> clinician straight into the patient's GDMT tab to act on it. The engine decides; the card
> and the AI only explain."

## Proof captured this session

- Discovery + card endpoints return 200 (curl and in-sandbox).
- End-to-end simulated exactly as the sandbox does it (prefetch from HAPI → POST to our live
  service → card) — card returned with all four cited gaps and the launch link.
- Card rendered in the CDS Hooks Sandbox UI against the live service (accessibility-tree
  verified: patient header "Harold J. Whitmore", service `hf-gdmt-optimizer`, summary +
  four cited bullets + source + launch link).
