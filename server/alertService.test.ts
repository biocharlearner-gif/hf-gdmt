import { describe, it, expect, vi } from "vitest";
import { buildVitalsSubscription, VITALS_SUBSCRIPTION_CRITERIA } from "../src/fhir/subscription";
import { createFhirDeps, identifierSearchToken, patientIdFromNotification, processNotification, type AlertServiceDeps } from "./alertService";

describe("buildVitalsSubscription", () => {
  it("is an active-able rest-hook scoped to vital-signs", () => {
    const sub = buildVitalsSubscription({ endpoint: "https://x/notify" });
    expect(sub.resourceType).toBe("Subscription");
    expect(sub.criteria).toBe(VITALS_SUBSCRIPTION_CRITERIA);
    const channel = sub.channel as Record<string, unknown>;
    expect(channel.type).toBe("rest-hook");
    expect(channel.endpoint).toBe("https://x/notify");
    expect(channel.payload).toBe("application/fhir+json");
  });

  it("accepts a narrowed criteria override", () => {
    const sub = buildVitalsSubscription({ endpoint: "https://x/notify", criteria: "Observation?code=http://loinc.org|29463-7" });
    expect(sub.criteria).toContain("29463-7");
  });
});

describe("patientIdFromNotification", () => {
  it("reads a raw Observation subject", () => {
    expect(patientIdFromNotification({ resourceType: "Observation", subject: { reference: "Patient/123" } })).toBe("123");
  });
  it("reads the first Observation in a notification Bundle", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [{ resource: { resourceType: "SubscriptionStatus" } }, { resource: { resourceType: "Observation", subject: { reference: "Patient/abc" } } }],
    };
    expect(patientIdFromNotification(bundle)).toBe("abc");
  });
  it("supports an explicit { patientId } ping and returns null otherwise", () => {
    expect(patientIdFromNotification({ patientId: "p9" })).toBe("p9");
    expect(patientIdFromNotification({})).toBeNull();
    expect(patientIdFromNotification(null)).toBeNull();
  });
});

describe("processNotification", () => {
  it("evaluates the patient's vitals and writes back artifacts per alert", async () => {
    // A low SpO2 reading → one hypoxia alert → DetectedIssue + Flag + Task.
    const observations = {
      entry: [
        {
          resource: {
            resourceType: "Observation",
            code: { coding: [{ system: "http://loinc.org", code: "59408-5" }] },
            effectiveDateTime: "2026-06-21T09:00:00Z",
            valueQuantity: { value: 86, unit: "%" },
          },
        },
      ],
    };
    const created: string[] = [];
    const deps: AlertServiceDeps = {
      readObservations: vi.fn(async () => observations),
      createResource: vi.fn(async (r) => {
        created.push(r.resourceType as string);
        return { id: `${r.resourceType}-1` };
      }),
      now: () => "2026-06-21T10:00:00Z",
    };

    const result = await processNotification({ resourceType: "Observation", subject: { reference: "Patient/p1" } }, deps);

    expect(result.patientId).toBe("p1");
    expect(result.alerts.length).toBeGreaterThanOrEqual(1);
    expect(result.alerts.some((a) => a.vital === "spo2")).toBe(true);
    expect(created).toEqual(expect.arrayContaining(["DetectedIssue", "Flag", "Task"]));
  });

  it("no-ops when the patient cannot be resolved", async () => {
    const deps: AlertServiceDeps = {
      readObservations: vi.fn(async () => ({ entry: [] })),
      createResource: vi.fn(async () => ({ id: "x" })),
    };
    const result = await processNotification({}, deps);
    expect(result.patientId).toBeNull();
    expect(deps.readObservations).not.toHaveBeenCalled();
    expect(result.created).toHaveLength(0);
  });
});

describe("identifierSearchToken", () => {
  it("builds a system|value token from the first identifier", () => {
    expect(identifierSearchToken({ identifier: [{ system: "urn:hf-gdmt:alert", value: "p1:spo2:d:task" }] }))
      .toBe("urn:hf-gdmt:alert|p1:spo2:d:task");
  });
  it("falls back to the bare value when there is no system", () => {
    expect(identifierSearchToken({ identifier: [{ value: "abc" }] })).toBe("abc");
  });
  it("returns null when there is no identifier", () => {
    expect(identifierSearchToken({ resourceType: "Task" })).toBeNull();
  });
});

describe("createFhirDeps.createResource (idempotent)", () => {
  const resource = {
    resourceType: "Task",
    identifier: [{ system: "urn:hf-gdmt:alert", value: "p1:spo2:2026-06-21:task" }],
  };

  it("reuses an existing resource instead of creating a duplicate", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // The search call returns a bundle with an existing match.
      if (!init || init.method === undefined) {
        return new Response(JSON.stringify({ entry: [{ resource: { id: "existing-1" } }] }), { status: 200 });
      }
      throw new Error("should not POST when a match exists");
    });
    vi.stubGlobal("fetch", fetchMock);

    const deps = createFhirDeps({ readBase: "https://fhir.example/r4" });
    const out = await deps.createResource(resource);

    expect(out.id).toBe("existing-1");
    expect(fetchMock).toHaveBeenCalledTimes(1); // search only, no POST
    const [searchUrl] = fetchMock.mock.calls[0]!;
    expect(searchUrl).toContain("/Task?identifier=");
    vi.unstubAllGlobals();
  });

  it("creates when the search finds nothing", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return new Response(JSON.stringify({ entry: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "new-1" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const deps = createFhirDeps({ readBase: "https://fhir.example/r4" });
    const out = await deps.createResource(resource);

    expect(out.id).toBe("new-1");
    expect(fetchMock).toHaveBeenCalledTimes(2); // search, then POST
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("POST");
    vi.unstubAllGlobals();
  });
});
