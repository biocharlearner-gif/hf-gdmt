import { getClient, getSession, getActivePatientId } from "../session";
import { buildAlertInput } from "../fhir/extract";
import { evaluateAlerts, type GdmtAlert } from "../engine/alerts";
import { buildDetectedIssue, buildFlagForAlert, buildTaskForAlert } from "../fhir/writeback";

/**
 * Remote-monitoring alerts: ingest + writeback orchestration.
 *
 * Ingest — fetch the in-context patient's Observations, parse home-device vitals into
 * AlertInput, and run the pure alert engine. Writeback — turn an accepted alert into
 * FHIR artifacts (DetectedIssue + Flag + Task) on the write server. The engine only
 * detects/cites; a human accepts an alert before anything is written.
 */

type FhirCreate = { resourceType: string } & Record<string, unknown>;

function patientRef(): string {
  const id = getActivePatientId();
  if (!id) throw new Error("No patient selected");
  return `Patient/${id}`;
}

/** Fetch device Observations for the active patient and evaluate alert rules. */
export async function loadAlerts(): Promise<GdmtAlert[]> {
  if (!getSession()) throw new Error("Not authenticated");
  const patientId = getActivePatientId();
  if (!patientId) throw new Error("No patient selected");

  const observations = await getClient()
    .search("Observation", { patient: patientId })
    .catch(() => ({ entry: [] }));

  const input = buildAlertInput({ patientId, observations });
  return evaluateAlerts(input);
}

/**
 * Write one accepted alert back as DetectedIssue + Flag + Task. Returns the created
 * resource ids. Artifacts are created independently so a single failure is isolated.
 */
export async function createAlertArtifacts(alert: GdmtAlert): Promise<{
  detectedIssueId: string;
  flagId: string;
  taskId: string;
}> {
  const opts = { patientRef: patientRef() };
  const client = getClient();
  const [detectedIssue, flag, task] = await Promise.all([
    client.create(buildDetectedIssue(alert, opts) as FhirCreate),
    client.create(buildFlagForAlert(alert, opts) as FhirCreate),
    client.create(buildTaskForAlert(alert, opts) as FhirCreate),
  ]);
  return {
    detectedIssueId: detectedIssue?.id ?? "created",
    flagId: flag?.id ?? "created",
    taskId: task?.id ?? "created",
  };
}
