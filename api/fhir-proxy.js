// server/fhirProxy.ts
function resolveUpstream(url) {
  const params = new URLSearchParams(url.search);
  let path = params.get("__path");
  params.delete("__path");
  params.delete("...path");
  if (path == null) {
    const marker = "/api/fhir";
    const i = url.pathname.indexOf(marker);
    path = i >= 0 ? url.pathname.slice(i + marker.length) : url.pathname;
  }
  path = "/" + path.replace(/^\/+/, "");
  return { path, query: params.toString() };
}
async function proxyFhir(req, url, config) {
  const fhirBase = config.fhirBase.replace(/\/$/, "");
  const { path, query } = resolveUpstream(url);
  const target = `${fhirBase}${path}${query ? `?${query}` : ""}`;
  const headers = {
    Accept: req.headers.get("accept") || "application/fhir+json"
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : void 0
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/fhir+json" }
  });
}

// api-src/fhir-proxy.ts
var FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
var TOKEN = process.env.MEDBLOCKS_TOKEN || void 0;
var fhir_proxy_default = {
  async fetch(req) {
    const url = new URL(req.url);
    return proxyFhir(req, url, { fhirBase: FHIR_BASE, token: TOKEN });
  }
};
export {
  fhir_proxy_default as default
};
