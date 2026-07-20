import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyFhir } from "./fhirProxy";

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
