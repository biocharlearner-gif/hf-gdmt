/**
 * FHIR R4 Subscription builder for the remote-monitoring alert pipeline.
 *
 * A Subscription tells the FHIR server: "when a resource matching `criteria` is
 * created/updated, POST a notification to my `endpoint`." We scope it to
 * vital-signs Observations so lab results and unrelated Observations never wake the
 * HF alert engine. The notified endpoint is our alert service (see server/alertService.ts),
 * which re-reads the patient's recent Observations, runs the pure engine, and writes
 * back DetectedIssue/Flag/Task. The engine still only detects & cites.
 */

/** Criteria string (a FHIR search) the Subscription matches against. */
export const VITALS_SUBSCRIPTION_CRITERIA = "Observation?category=vital-signs";

/** Tag so the demo Subscription can be found/cleaned up on a shared server. */
export const SUBSCRIPTION_TAG = {
  system: "urn:hf-gdmt:demo",
  code: "remote-monitoring-v1",
  display: "HF GDMT remote-monitoring subscription",
} as const;

export interface SubscriptionOpts {
  /** Absolute URL the FHIR server should POST notifications to (our alert service). */
  endpoint: string;
  /** Override the default vital-signs criteria (e.g. narrow to specific LOINC codes). */
  criteria?: string;
  /** Extra headers the server should send with each notification (e.g. auth). */
  headers?: string[];
}

/**
 * Build an active rest-hook Subscription. `payload: application/fhir+json` asks the
 * server to include the triggering resource in the notification body so our service
 * can read the patient id without an extra round-trip (it still re-reads recent
 * Observations before evaluating, since some servers send an empty ping).
 */
export function buildVitalsSubscription(opts: SubscriptionOpts): Record<string, unknown> {
  return {
    resourceType: "Subscription",
    meta: { tag: [SUBSCRIPTION_TAG] },
    status: "requested",
    reason: "HF remote-monitoring — evaluate vital-signs for decompensation & titration-limiting alerts",
    criteria: opts.criteria ?? VITALS_SUBSCRIPTION_CRITERIA,
    channel: {
      type: "rest-hook",
      endpoint: opts.endpoint,
      payload: "application/fhir+json",
      ...(opts.headers && opts.headers.length ? { header: opts.headers } : {}),
    },
  };
}
