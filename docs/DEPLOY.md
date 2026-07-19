# Deploy (Vercel)

The app ships as **one Vercel deployment**: the Vite SPA is served statically from
`dist/`, and the Bun BFF's four concerns are re-exposed as serverless functions in
`api/` that import the **same pure core** (logic lives once — see the Bun server in
`server/index.ts` for the local-dev equivalent). Because the SPA and the functions
share one origin, `/api/fhir` stays same-origin and the tenant Bearer token never
reaches the browser bundle.

## What maps where

| Public path                     | Function                        | Purpose                                   |
| ------------------------------- | ------------------------------- | ----------------------------------------- |
| `/api/fhir/*`                   | `api/fhir/[...path].ts`         | Authenticated FHIR reverse proxy (SPA data path) |
| `/notify`                       | `api/notify.ts`                 | FHIR Subscription rest-hook target (alert loop) |
| `/cds-services`                 | `api/cds-services.ts`           | CDS Hooks discovery (GET)                 |
| `/cds-services/hf-gdmt-optimizer` | `api/cds-services/[service].ts` | CDS Hooks patient-view card (POST)      |
| `/health`                       | `api/health.ts`                 | Liveness + config echo                    |
| everything else                 | (static `dist/`)                | SPA; unknown paths rewrite to `index.html` for client routing |

Friendly paths (`/notify`, `/cds-services`, `/health`) are mapped to their `api/*`
functions by `vercel.json` rewrites. Functions use Vercel's documented Web-standard
`export default { fetch(request) {…} }` all-methods form.

## Environment variables (set in Vercel → Project → Settings → Environment Variables)

Server-side only — **do NOT** `VITE_`-prefix these (Vite would inline them into the client bundle):

| Var                   | Value                                                        |
| --------------------- | ----------------------------------------------------------- |
| `MEDBLOCKS_FHIR_BASE` | tenant FHIR base URL (same value as your local `.env.local`) |
| `MEDBLOCKS_TOKEN`     | tenant Bearer token (same value as `.env.local`)             |
| `SMART_APP_URL`       | the deployed app URL, e.g. `https://<app>.vercel.app` (used in CDS launch links) |

> The SMART/Epic login path additionally needs the `VITE_SMART_*` build-time vars
> (see `.env.example`). The **demo-account flow works without them** — it reads through
> `/api/fhir`. Add the `VITE_SMART_*` vars only when wiring the live Epic launch.

## Deploy steps (run locally — needs your Vercel auth)

```bash
npm i -g vercel          # if not installed
vercel login
vercel                   # first run: link/create the project, accept detected settings
# set the env vars above (dashboard, or: vercel env add MEDBLOCKS_TOKEN …)
vercel --prod            # production deploy → prints the public URL
```

Then set `SMART_APP_URL` to that printed URL and redeploy (`vercel --prod`) so CDS
launch links point at the right host.

## Post-deploy verification

1. `curl https://<app>.vercel.app/health` → `{ ok: true, authenticated: true }`.
2. Open the app → Continue with Demo Account → the HF cohort list loads (proves the
   authenticated `/api/fhir` proxy works in prod).
3. `curl https://<app>.vercel.app/cds-services` → discovery JSON with `hf-gdmt-optimizer`.
4. **Subscription end-to-end** (the thing localhost couldn't test):
   ```bash
   CALLBACK_URL=https://<app>.vercel.app/notify npm run register-subscription
   ```
   Then create a vital-signs `Observation` on the tenant server (or save a vital in the
   Vitals tab) and confirm a DetectedIssue + Flag + Task appear **without opening the UI**.
   The alert writeback is now idempotent (search-by-identifier then create), so a repeated
   notification for the same alert will not create duplicates.
