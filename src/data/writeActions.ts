import { getClient, getActivePatientId, getProvider } from "../session";
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

/**
 * Build-opts for the ordering clinician: the signed-in provider (fhirUser) becomes
 * Task/ServiceRequest.requester and CarePlan.author, so writes carry the real
 * clinician instead of an anonymous or hardcoded name. Empty on the demo/no-auth path.
 */
function providerOpts(): { requesterRef?: string; authorDisplay?: string } {
  const p = getProvider();
  return {
    ...(p.reference ? { requesterRef: p.reference } : {}),
    ...(p.display ? { authorDisplay: p.display } : {}),
  };
}

type FhirCreate = { resourceType: string } & Record<string, unknown>;

export async function createTaskForPillar(pillar: PillarResult): Promise<string> {
  const created = await getClient().create(
    buildTaskForGap(pillar, { patientRef: patientRef(), ...providerOpts() }) as FhirCreate,
  );
  return created?.id ?? "created";
}

export async function createLabOrder(): Promise<string> {
  const created = await getClient().create(
    buildLabServiceRequest({ patientRef: patientRef(), ...providerOpts() }) as FhirCreate,
  );
  return created?.id ?? "created";
}

/** Order a transthoracic echo to determine LVEF / phenotype (for the Unknown-phenotype gate). */
export async function createEchoOrder(): Promise<string> {
  const created = await getClient().create({
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: "routine",
    code: {
      coding: [{ system: "http://loinc.org", code: "34552-0", display: "Echocardiography study" }],
      text: "Transthoracic echocardiogram to determine LVEF / HF phenotype",
    },
    subject: { reference: patientRef() },
    authoredOn: new Date().toISOString(),
    ...(providerOpts().requesterRef ? { requester: { reference: providerOpts().requesterRef } } : {}),
    note: [{ text: "LVEF unknown — determine phenotype before initiating the four-pillar GDMT program. (Source: 2022 AHA/ACC/HFSA HF Guideline)" }],
  } as FhirCreate);
  return created?.id ?? "created";
}

export async function createCarePlanFor(
  assessment: GdmtAssessment,
  taskRefs: string[],
): Promise<string> {
  const created = await getClient().create(
    buildCarePlan(assessment, taskRefs, { patientRef: patientRef(), ...providerOpts() }) as FhirCreate,
  );
  return created?.id ?? "created";
}
