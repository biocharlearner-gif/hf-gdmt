import type { SmartTokens } from "./smartAuth";

/**
 * FHIR client with a READ base URL and a separate WRITE base URL — this is the
 * "read/write split" in code. Reads go to e.g. Epic; writes (Task/ServiceRequest/
 * CarePlan) go to e.g. a HAPI server or Cerner secure sandbox.
 *
 * Endpoints are configuration, never hardcoded, so you can swap them live in a demo.
 */
export interface FhirClientConfig {
  readBaseUrl: string;
  writeBaseUrl: string;          // may equal readBaseUrl for single-EHR mode
  getAccessToken: () => string;  // read token
  getWriteToken?: () => string;  // write token if the write server uses different auth
}

export class FhirClient {
  private cfg: FhirClientConfig;

  constructor(cfg: FhirClientConfig) {
    this.cfg = cfg;
  }

  private async req(base: string, path: string, init: RequestInit, token: string): Promise<any> {
    const res = await fetch(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/fhir+json",
        ...(init.body ? { "Content-Type": "application/fhir+json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`FHIR ${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  /** Search the READ server, e.g. search("Observation", { patient, category: "laboratory" }). */
  search(resourceType: string, params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams(params).toString();
    return this.req(this.cfg.readBaseUrl, `${resourceType}?${qs}`, { method: "GET" }, this.cfg.getAccessToken());
  }

  read(resourceType: string, id: string): Promise<any> {
    return this.req(this.cfg.readBaseUrl, `${resourceType}/${id}`, { method: "GET" }, this.cfg.getAccessToken());
  }

  /** Create on the WRITE server. */
  create(resource: { resourceType: string } & Record<string, unknown>): Promise<any> {
    const token = this.cfg.getWriteToken?.() ?? this.cfg.getAccessToken();
    return this.req(this.cfg.writeBaseUrl, resource.resourceType, { method: "POST", body: JSON.stringify(resource) }, token);
  }

  /** Fetch all entries across pages for a search (handles Bundle.link rel=next). */
  async searchAll(resourceType: string, params: Record<string, string>): Promise<any[]> {
    let bundle = await this.search(resourceType, params);
    const out: any[] = (bundle.entry ?? []).map((e: any) => e.resource);
    while (bundle.link?.find((l: any) => l.relation === "next")) {
      const next = bundle.link.find((l: any) => l.relation === "next").url;
      const res = await fetch(next, {
        headers: { Authorization: `Bearer ${this.cfg.getAccessToken()}`, Accept: "application/fhir+json" },
      });
      bundle = await res.json();
      out.push(...(bundle.entry ?? []).map((e: any) => e.resource));
    }
    return out;
  }
}

/** Helper to build a token getter from a mutable tokens holder. */
export function tokenGetter(holder: { tokens: SmartTokens | null }): () => string {
  return () => {
    if (!holder.tokens) throw new Error("Not authenticated");
    return holder.tokens.accessToken;
  };
}
