import { buildAlertInput } from "../fhir/extract";
import { evaluateAlerts } from "../engine/alerts";
import { computeRiskScore, type RiskScore } from "../engine/risk";
import { getObservations, type FhirResource } from "./patientApi";

/**
 * Pure roll-up of a patient's Observations into their current HF risk score:
 * Observations → alert engine → deterministic risk score. This is the single
 * definition of the glue that was previously inlined in the Vitals tab and Tasks
 * page — the engine still decides; this only composes the existing pure functions.
 */
export function riskFromObservations(
  patientId: string,
  observations: FhirResource[],
  now?: string,
): RiskScore {
  return computeRiskScore(evaluateAlerts(buildAlertInput({ patientId, observations, now })));
}

/** Fetch a patient's Observations from HAPI and compute their current risk score. */
export async function fetchPatientRisk(patientId: string, now?: string): Promise<RiskScore> {
  const obs = await getObservations(patientId);
  return riskFromObservations(patientId, obs, now);
}
