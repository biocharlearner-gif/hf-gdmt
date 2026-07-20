/**
 * Source for /api/health — liveness + config echo.
 *
 * Echoes only NON-SECRET config: the FHIR base URL, whether a token is present
 * (never the token itself), and the SMART app URL used to build CDS launch links.
 * `smartAppUrl` is echoed so the deployed value can be confirmed with one request —
 * if it reads `http://localhost:5173`, the SMART_APP_URL env var is missing for this
 * environment and CDS launch links would point at localhost.
 */
const FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const TOKEN = process.env.MEDBLOCKS_TOKEN || undefined;
const SMART_APP_URL = process.env.SMART_APP_URL || "http://localhost:5173";

export default {
  async fetch(): Promise<Response> {
    return new Response(
      JSON.stringify({
        ok: true,
        fhirBase: FHIR_BASE,
        authenticated: Boolean(TOKEN),
        smartAppUrl: SMART_APP_URL,
        smartAppUrlConfigured: Boolean(process.env.SMART_APP_URL),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
};
