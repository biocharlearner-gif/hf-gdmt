/**
 * Authenticated FHIR reverse-proxy core, transport-agnostic (Web Request/Response).
 *
 * Both runtimes reuse this one function (logic lives once):
 *   - the Bun BFF (server/index.ts) for local development, and
 *   - the Vercel serverless function (api/fhir/[...path].ts) in production.
 *
 * It strips the `/api/fhir` prefix, forwards method/query/body to the tenant FHIR
 * server, and injects the Bearer token SERVER-SIDE so it never reaches the browser
 * bundle. No CORS header is emitted on purpose: this must stay same-origin (the app
 * is served from the same host in both dev and prod) so it can't be abused as an
 * open, token-bearing proxy by arbitrary web pages.
 */

export interface FhirProxyConfig {
  /** Tenant FHIR base URL (no trailing slash required). */
  fhirBase: string;
  /** Tenant Bearer token; attached server-side only. */
  token?: string;
}

export async function proxyFhir(req: Request, url: URL, config: FhirProxyConfig): Promise<Response> {
  const fhirBase = config.fhirBase.replace(/\/$/, "");
  const upstreamPath = url.pathname.slice("/api/fhir".length); // "" or "/Patient/..."
  const target = `${fhirBase}${upstreamPath}${url.search}`;

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
