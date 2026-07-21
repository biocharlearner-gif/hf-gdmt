# Real Epic launch — runbook (seamless SMART launch → GDMT)

Goal: the app running on **real Epic patient data**, launched via SMART on FHIR, landing on
the GDMT assessment. This is the achievable "real Epic" for the challenge.

## The hard constraint (read first)

**You cannot watch a CDS Hooks card fire in Epic's public sandbox.** Epic staff confirmed
"It is not currently possible to test CDS Hooks in the EOF sandbox" — it's gated behind
Epic-customer **App Orchard / Hyperspace** access. Epic *does* support our `patient-view`
hook in real Hyperspace, but there is no public path to see the card render.

So "real Epic" splits into two pieces:
- **Launch (achievable now):** a real Epic SMART launch into the app → GDMT on real Epic
  data. Demoable with the open sandbox. **Steps below.**
- **Card-in-Epic (customer-only):** only visible inside a paying Epic customer's Hyperspace.
  Our card + its SMART launch link are correct and ready for that; we just can't self-demo it.

## What's already done in code (no action needed)

- **EHR-launch entry** `GET /launch` (`src/pages/EhrLaunch.tsx`): reads Epic's `iss` + `launch`,
  runs PKCE OAuth, lands on the patient's GDMT view via `/callback`.
- **Standalone launch** ("Connect with Epic" on `/`): PKCE, patient-standalone.
- **CDS card SMART link now points at `/launch`** (`src/cds/service.ts`) so that in a real
  Epic Hyperspace the EHR appends `iss`+`launch` and the app performs the EHR launch. (It used
  to point at the app root `?patient=…`, which would have dropped the launch context on Epic's
  login page — fixed 2026-07-21.)
- Read path: `/callback` → `/patient` (`src/pages/PatientView.tsx`) renders the 4-pillar GDMT
  assessment from the **Epic** read path (`data/loadPatient.ts` + the in-browser token). Note
  this is the plain-CSS SMART view, NOT the polished MUI `GdmtTab` (that tab reads the Medblocks
  demo tenant via the BFF, a separate path — do not confuse them).

## STEP A — Epic app registration (fhir.epic.com) · **user action**

Open your app at [fhir.epic.com](https://fhir.epic.com) → **Build Apps** (the same app from
memory `hf-gdmt-epic-sandbox`, non-prod client `ba035637-ee66-4c2c-947a-f6fc627f2f56`, or a new one).

1. **Redirect URI** — add the production callback (exact match, keep the localhost one for dev):
   - `https://hf-gdmt.vercel.app/callback`
2. **Launch URL** (only needed for EHR launch / the CDS card link, harmless to set now):
   - `https://hf-gdmt.vercel.app/launch`
3. **Incoming APIs** — the GDMT engine needs more than demographics. Add (R4, patient-scoped):
   - `Patient.Read` · `Condition.Read` · `Observation.Read` · `MedicationRequest.Read`
   - `AllergyIntolerance.Read` · `Encounter.Read`
   - (optional writeback) `ServiceRequest.Create` · `Task.Create` · `CarePlan.Create`
   > Memory note: last time only `Patient.Read` was enabled — that's why the GDMT tab couldn't
   > run on Epic data. These extra reads are the fix.
4. **App Audience** = Patients (patient standalone). Sandbox test login: `fhircamila` / `epicepic1`.
5. Save via **Save & Ready for Sandbox**. Client propagation takes a few minutes.

## STEP B — Vercel env vars · **user action**

The live bundle currently has **no** SMART config baked in (verified 2026-07-21), so "Connect
with Epic" can't launch yet. `VITE_*` vars are **build-time inlined**, so you must set them and
**redeploy**.

In the Vercel project → Settings → Environment Variables (Production), add:

```
VITE_SMART_ISS=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
VITE_SMART_CLIENT_ID=<your Epic NON-production client id>
VITE_SMART_REDIRECT_URI=https://hf-gdmt.vercel.app/callback
VITE_SMART_SCOPE=openid fhirUser patient/Patient.read patient/Condition.read patient/Observation.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Encounter.read
```

Then **redeploy** (push to `main` or "Redeploy" in the dashboard) so Vite re-inlines them.
- Keep the write scopes out unless STEP A enabled the matching Create APIs (Epic rejects
  unregistered scopes at authorize).
- `VITE_SMART_REDIRECT_URI` must byte-match the Epic redirect URI from STEP A.

## STEP C — Verify live · **you + me**

After A + B + redeploy, on `https://hf-gdmt.vercel.app`:
1. Click **Connect with Epic** → should redirect to Epic's OAuth login (proves ISS/client/redirect).
2. Log in `fhircamila` / `epicepic1`, authorize.
3. Land on `/patient` showing Camila's **GDMT assessment computed from real Epic FHIR** (LVEF,
   labs, meds pulled live). Confirm pillars + citations render.

Tell me when STEP B's redeploy is live and I'll drive the browser to verify STEP C and capture proof.

## Troubleshooting

**"Invalid OAuth 2.0 request" on live but local works** — Epic returns this (its login web
redirects with `error=4`) when the `redirect_uri` in the authorize request is **not registered**
on the client. Local works because `http://localhost:5173/callback` is registered; the production
`https://hf-gdmt.vercel.app/callback` must be added to the **same** client
(`ba035637-ee66-4c2c-947a-f6fc627f2f56`, the one baked into the Vercel build — a *new* app has a
different client id and won't help). Diagnose from the shell without a browser:

```
# error=4  → redirect not registered ;  no error param → registered
node -e 'const I="https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";fetch(I+"/.well-known/smart-configuration").then(r=>r.json()).then(c=>fetch(c.authorization_endpoint+"?"+new URLSearchParams({response_type:"code",client_id:"ba035637-ee66-4c2c-947a-f6fc627f2f56",redirect_uri:process.argv[1],scope:"openid fhirUser patient/Patient.read",state:"x",aud:I,code_challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",code_challenge_method:"S256"}),{redirect:"manual"})).then(r=>console.log((r.headers.get("location")||"").match(/error=\d+/)||"REGISTERED"))' "https://hf-gdmt.vercel.app/callback"
```

The same probe with a `patient/<Resource>.read` scope tells you whether an **Incoming API** is
enabled on the client (`error=4` when it isn't). Verified 2026-07-21: all six reads are enabled on
`ba035637`; only the production redirect URI is missing.

## Demo framing for the video

- **Card fires:** CDS Hooks Sandbox (see [CDS-DEMO.md](CDS-DEMO.md)) — the card + cited gaps + the
  `/launch` SMART link.
- **Launch is real Epic:** Connect with Epic → real Epic patient → GDMT assessment (STEP C).
- Narrate the one seam honestly: the card UI is shown in the CDS sandbox because Epic gates its
  Hyperspace card surface to customers; the launch and the data are genuine Epic.
