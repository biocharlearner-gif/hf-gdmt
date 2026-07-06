import { describe, it, expect, vi } from "vitest";
import { buildVitalsSubscription, VITALS_SUBSCRIPTION_CRITERIA } from "../src/fhir/subscription";
import { patientIdFromNotification, processNotification, type AlertServiceDeps } from "./alertService";

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
