/**
 * TEMPORARY diagnostic — probes whether cross-directory TS imports resolve at
 * runtime on Vercel. Remove once the bundling issue is fixed.
 */
export default {
  async fetch(): Promise<Response> {
    const out: Record<string, string> = { node: process.version };
    try {
      const m = await import("../server/fhirProxy");
      out.fhirProxy = typeof m.proxyFhir === "function" ? "ok" : "loaded-no-export";
    } catch (e) {
      out.fhirProxy = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    try {
      const m = await import("../src/cds/service");
      out.cdsService = typeof m.discovery === "function" ? "ok" : "loaded-no-export";
    } catch (e) {
      out.cdsService = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    return new Response(JSON.stringify(out, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};
