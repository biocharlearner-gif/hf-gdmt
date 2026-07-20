/**
 * Source for the Vercel function /api/fhir/[...path] — authenticated FHIR reverse
 * proxy for the SPA. Bundled to api/fhir/[...path].js by scripts/build-api.mjs so all
 * shared imports are inlined (Vercel's Node runtime does NOT bundle TS imported from
 * outside /api). The Bearer token is injected server-side; never in the client bundle.
 */
import { proxyFhir } from "../server/fhirProxy";

const FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const TOKEN = process.env.MEDBLOCKS_TOKEN || undefined;

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    return proxyFhir(req, url, { fhirBase: FHIR_BASE, token: TOKEN });
  },
};
