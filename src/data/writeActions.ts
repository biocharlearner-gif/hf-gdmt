import { getClient, getActivePatientId } from "../session";
import { buildTaskForGap, buildLabServiceRequest, buildCarePlan } from "../fhir/writeback";
import type { GdmtAssessment, PillarResult } from "../engine/types";

/**
 * Write-back actions (spec A6). Builds FHIR R4 payloads from the assessment via the
 * scaffold's `fhir/writeback` builders and POSTs them through the session's
 * `FhirClient.create` (write base = Epic by default, or VITE_FHIR_WRITE_BASE).
 *
 * The created resource's logical id is returned for display / CarePlan linking.
 */

function patientRef(): string {
  const id = getActivePatientId();
  if (!id) throw new Error("No patient selected");
  return `Patient/${id}`;
}

type FhirCreate = { resourceType: string } & Record<string, unknown>;

export async function createTaskForPillar(pillar: PillarResult): Promise<string> {
  const created = await getClient().create(
    buildTaskForGap(pillar, { patientRef: patientRef() }) as FhirCreate,
  );
  return created?.id ?? "created";
}

export async function createLabOrder(): Promise<string> {
  const created = await getClient().create(
    buildLabServiceRequest({ patientRef: patientRef() }) as FhirCreate,
  );
  return created?.id ?? "created";
}

export async function createCarePlanFor(
  assessment: GdmtAssessment,
  taskRefs: string[],
): Promise<string> {
  const created = await getClient().create(
    buildCarePlan(assessment, taskRefs, { patientRef: patientRef() }) as FhirCreate,
  );
  return created?.id ?? "created";
}
