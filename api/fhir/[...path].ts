/**
 * Vercel serverless function: authenticated FHIR reverse proxy for the SPA.
 *
 * Catch-all under /api/fhir/* — the browser talks to this same-origin path and the
 * tenant Bearer token is injected server-side (never in the client bundle). Mirrors
 * the Bun BFF route in server/index.ts; both call the shared proxyFhir core.
 *
 * Env (Vercel project settings, server-side, NOT VITE_-prefixed):
 *   MEDBLOCKS_FHIR_BASE  tenant FHIR base URL (default: public HAPI, unauthenticated)
 *   MEDBLOCKS_TOKEN      tenant Bearer token
 */
import { proxyFhir } from "../../server/fhirProxy";

const FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const TOKEN = process.env.MEDBLOCKS_TOKEN || undefined;

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    return proxyFhir(req, url, { fhirBase: FHIR_BASE, token: TOKEN });
  },
};
