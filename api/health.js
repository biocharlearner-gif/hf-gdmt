// api-src/health.ts
var FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
var TOKEN = process.env.MEDBLOCKS_TOKEN || void 0;
var SMART_APP_URL = process.env.SMART_APP_URL || "http://localhost:5173";
var health_default = {
  async fetch() {
    return new Response(
      JSON.stringify({
        ok: true,
        fhirBase: FHIR_BASE,
        authenticated: Boolean(TOKEN),
        smartAppUrl: SMART_APP_URL,
        smartAppUrlConfigured: Boolean(process.env.SMART_APP_URL)
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};
export {
  health_default as default
};
