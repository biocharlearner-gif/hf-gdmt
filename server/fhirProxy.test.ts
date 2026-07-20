import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyFhir, resolveUpstream } from "./fhirProxy";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(): string[] {
  const targets: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      targets.push(target);
      return new Response("{}", { status: 200, headers: { "content-type": "application/fhir+json" } });
    }),
  );
  return targets;
}

describe("proxyFhir", () => {
  it("strips Vercel's injected `...path` catch-all param and forwards the real query", async () => {
    const targets = stubFetch();
    const url = new URL("https://app.vercel.app/api/fhir/Patient?_count=1&...path=Patient");
    const res = await proxyFhir(new Request(url.toString()), url, { fhirBase: "https://fhir.example/r4" });
    expect(res.status).toBe(200);
    expect(targets[0]).toBe("https://fhir.example/r4/Patient?_count=1");
  });

  it("forwards a query-less path unchanged (no dangling `?`)", async () => {
    const targets = stubFetch();
    const url = new URL("https://app.vercel.app/api/fhir/metadata?...path=metadata");
    await proxyFhir(new Request(url.toString()), url, { fhirBase: "https://fhir.example/r4/" });
    expect(targets[0]).toBe("https://fhir.example/r4/metadata");
  });

  it("proxies a nested path (Condition/_search) from the Vercel `__path` rewrite param", async () => {
    const targets = stubFetch();
    // vercel.json rewrites /api/fhir/:path* -> /api/fhir-proxy?__path=:path*
    const url = new URL("https://app.vercel.app/api/fhir-proxy?__path=Condition/_search&_count=2");
    await proxyFhir(new Request(url.toString(), { method: "POST" }), url, { fhirBase: "https://fhir.example/r4" });
    expect(targets[0]).toBe("https://fhir.example/r4/Condition/_search?_count=2");
  });

  it("proxies a nested path from pathname (Bun dev, no rewrite param)", async () => {
    const targets = stubFetch();
    const url = new URL("https://localhost:8787/api/fhir/Condition/_search?_count=2");
    await proxyFhir(new Request(url.toString(), { method: "POST" }), url, { fhirBase: "https://fhir.example/r4" });
    expect(targets[0]).toBe("https://fhir.example/r4/Condition/_search?_count=2");
  });

  it("injects the Bearer token server-side when configured", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_t: string, init: RequestInit) => {
        seen.push(init);
        return new Response("{}", { status: 200 });
      }),
    );
    const url = new URL("https://app.vercel.app/api/fhir/Patient");
    await proxyFhir(new Request(url.toString()), url, { fhirBase: "https://fhir.example/r4", token: "secret-xyz" });
    expect((seen[0]!.headers as Record<string, string>).Authorization).toBe("Bearer secret-xyz");
  });
});

describe("resolveUpstream", () => {
  it("prefers the `__path` rewrite param and strips it from the query", () => {
    const u = new URL("https://x/api/fhir-proxy?__path=Patient/123&_summary=true");
    expect(resolveUpstream(u)).toEqual({ path: "/Patient/123", query: "_summary=true" });
  });
  it("falls back to the pathname after /api/fhir", () => {
    const u = new URL("https://x/api/fhir/Observation?patient=p1&_count=5");
    expect(resolveUpstream(u)).toEqual({ path: "/Observation", query: "patient=p1&_count=5" });
  });
  it("strips the legacy `...path` catch-all param", () => {
    const u = new URL("https://x/api/fhir/Patient?...path=Patient&name=a");
    expect(resolveUpstream(u)).toEqual({ path: "/Patient", query: "name=a" });
  });
});
