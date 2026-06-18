import { getClient, getSession, getActivePatientId } from "../session";
import { buildEngineInput } from "../fhir/extract";
import { evaluateGdmt } from "../engine/engine";
import type { GdmtAssessment } from "../engine/types";

export interface PatientDemographics {
  id: string;
  name: string;
  gender?: string;
  birthDate?: string;
  age?: number;
  mrn?: string;
}

export interface PatientData {
  patient: PatientDemographics;
  assessment: GdmtAssessment;
}

function ageFromBirthDate(birthDate?: string): number | undefined {
  if (!birthDate) return undefined;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function humanName(patient: any): string {
  const n = patient?.name?.[0];
  if (!n) return "Unknown patient";
  if (n.text) return n.text;
  const given = (n.given ?? []).join(" ");
  return [given, n.family].filter(Boolean).join(" ") || "Unknown patient";
}

function mrnOf(patient: any): string | undefined {
  const ids: any[] = patient?.identifier ?? [];
  const mrn = ids.find((i) =>
    (i.type?.text ?? "").toUpperCase().includes("MRN") ||
    (i.type?.coding ?? []).some((c: any) => c.code === "MR"),
  );
  return (mrn ?? ids[0])?.value;
}

/**
 * Fetch the in-context patient's resources from the read server, run them through
 * the pure engine, and return demographics + GDMT assessment. Resource fetches run
 * in parallel; failures degrade gracefully (empty bundle) rather than crashing.
 */
export async function loadPatientData(): Promise<PatientData> {
  if (!getSession()) throw new Error("Not authenticated");
  const patientId = getActivePatientId();
  if (!patientId) throw new Error("No patient selected");
  const client = getClient();

  const emptyBundle = { entry: [] };
  const safe = (p: Promise<any>) => p.catch(() => emptyBundle);

  const [patient, observations, conditions, medications, allergies] = await Promise.all([
    client.read("Patient", patientId),
    safe(client.search("Observation", { patient: patientId })),
    safe(client.search("Condition", { patient: patientId })),
    safe(client.search("MedicationRequest", { patient: patientId })),
    safe(client.search("AllergyIntolerance", { patient: patientId })),
  ]);

  const input = buildEngineInput({ patientId, observations, medications, conditions, allergies });
  const assessment = evaluateGdmt(input);

  return {
    patient: {
      id: patientId,
      name: humanName(patient),
      gender: patient?.gender,
      birthDate: patient?.birthDate,
      age: ageFromBirthDate(patient?.birthDate),
      mrn: mrnOf(patient),
    },
    assessment,
  };
}
