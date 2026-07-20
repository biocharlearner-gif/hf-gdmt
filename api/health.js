// api-src/health.ts
var FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
var TOKEN = process.env.MEDBLOCKS_TOKEN || void 0;
var health_default = {
  async fetch() {
    return new Response(
      JSON.stringify({ ok: true, fhirBase: FHIR_BASE, authenticated: Boolean(TOKEN) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};
export {
  health_default as default
};
