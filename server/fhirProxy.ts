/**
 * Authenticated FHIR reverse-proxy core, transport-agnostic (Web Request/Response).
 *
 * Both runtimes reuse this one function (logic lives once):
 *   - the Bun BFF (server/index.ts) for local development, and
 *   - the Vercel serverless function (api/fhir-proxy.js, bundled from api-src/) in prod.
 *
 * It resolves the upstream FHIR path from the incoming `/api/fhir/*` request, forwards
 * method/query/body to the tenant FHIR server, and injects the Bearer token SERVER-SIDE
 * so it never reaches the browser bundle. No CORS header is emitted on purpose: this must
 * stay same-origin (the app is served from the same host in dev and prod) so it can't be
 * abused as an open, token-bearing proxy by arbitrary web pages.
 */

export interface FhirProxyConfig {
  /** Tenant FHIR base URL (no trailing slash required). */
  fhirBase: string;
  /** Tenant Bearer token; attached server-side only. */
  token?: string;
}

/**
 * Work out the upstream FHIR path + query from an incoming `/api/fhir/*` URL, tolerating
 * how each host delivers a nested path:
 *   - Bun BFF: the real path is in `url.pathname` (`/api/fhir/Condition/_search`).
 *   - Vercel: the rewrite `/api/fhir/:path*` → `/api/fhir-proxy?__path=:path*` supplies the
 *     path in the `__path` query param (Vercel's filesystem `[...catch-all]` only matched a
 *     single segment, so nested paths like `Condition/_search` need the explicit rewrite).
 * Both `__path` and the older `...path` catch-all param are stripped from the forwarded query.
 * Exported for tests.
 */
export function resolveUpstream(url: URL): { path: string; query: string } {
  const params = new URLSearchParams(url.search);
  let path = params.get("__path");
  params.delete("__path");
  params.delete("...path");
  if (path == null) {
    const marker = "/api/fhir";
    const i = url.pathname.indexOf(marker);
    path = i >= 0 ? url.pathname.slice(i + marker.length) : url.pathname;
  }
  path = "/" + path.replace(/^\/+/, ""); // normalize to a single leading slash
  return { path, query: params.toString() };
}

export async function proxyFhir(req: Request, url: URL, config: FhirProxyConfig): Promise<Response> {
  const fhirBase = config.fhirBase.replace(/\/$/, "");
  const { path, query } = resolveUpstream(url);
  const target = `${fhirBase}${path}${query ? `?${query}` : ""}`;

  const headers: Record<string, string> = {
    Accept: req.headers.get("accept") || "application/fhir+json",
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/fhir+json" },
  });
}
