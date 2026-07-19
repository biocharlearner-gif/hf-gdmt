/**
 * Vercel serverless function: liveness + config echo (no secret leaked).
 * Rewritten from /health by vercel.json.
 */
const FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const TOKEN = process.env.MEDBLOCKS_TOKEN || undefined;

export default {
  async fetch(): Promise<Response> {
    return new Response(
      JSON.stringify({ ok: true, fhirBase: FHIR_BASE, authenticated: Boolean(TOKEN) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
};
