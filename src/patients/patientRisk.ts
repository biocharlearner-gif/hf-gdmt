import { buildAlertInput, buildHospitalizationSignal } from "../fhir/extract";
import { evaluateAlerts } from "../engine/alerts";
import { computeRiskScore, type RiskScore } from "../engine/risk";
import { getObservations, getEncounters, type FhirResource } from "./patientApi";

/**
 * Pure roll-up of a patient's Observations (+ optional Encounters) into their current
 * HF risk score: Observations → alert engine → deterministic risk score, plus a recent
 * HF hospitalization signal. This is the single definition of the glue that was
 * previously inlined in the Vitals tab and Tasks page — the engine still decides; this
 * only composes the existing pure functions.
 */
export function riskFromObservations(
  patientId: string,
  observations: FhirResource[],
  now?: string,
  encounters: FhirResource[] = [],
): RiskScore {
  return computeRiskScore(evaluateAlerts(buildAlertInput({ patientId, observations, now })), {
    hospitalization: buildHospitalizationSignal({ now, encounters }),
  });
}

/**
 * Fetch a patient's Observations + Encounters and compute their current risk score.
 * Encounters are best-effort (a server without them still yields a vitals-only score).
 */
export async function fetchPatientRisk(patientId: string, now?: string): Promise<RiskScore> {
  const [obs, encounters] = await Promise.all([
    getObservations(patientId),
    getEncounters(patientId).catch(() => [] as FhirResource[]),
  ]);
  return riskFromObservations(patientId, obs, now, encounters);
}
