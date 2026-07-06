import { COHORT_TAG, MRN_SYSTEM, PATIENT_FHIR_BASE } from "./fhirConfig";
import { fullName, mrnOf, type FhirPatient } from "./patientMapper";
import { getHfCodes } from "./hfCohort";

/**
 * Thin no-auth FHIR client for the public HAPI server. The existing
 * src/fhirClient.ts FhirClient is coupled to SMART bearer tokens, so this is a
 * lightweight sibling rather than a retrofit.
 */

/** Minimal shape for arbitrary FHIR resources we read/write outside the Patient type. */
export type FhirResource = { resourceType: string } & Record<string, unknown>;

const BASE = PATIENT_FHIR_BASE.replace(/\/$/, "");

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Accept: "application/fhir+json",
      ...(init?.body ? { "Content-Type": "application/fhir+json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`FHIR ${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

export type HfFilter = "all" | "hf" | "non-hf";

export interface SearchArgs {
  /** Combined search: exact MRN when all-digits, otherwise a name match. */
  query?: string;
  /** Cohort membership filter. */
  hfFilter: HfFilter;
  page: number; // 0-based
  pageSize: number;
}

export interface SearchResult {
  patients: FhirPatient[];
  total: number;
  /** Ids of patients in the active+confirmed HF cohort (for the tag column). */
  hfIds: string[];
}

interface Bundle {
  total?: number;
  entry?: Array<{
    resource?: { resourceType?: string; subject?: { reference?: string } } & FhirPatient;
  }>;
}

/** All tagged patients on the (shared) server — scoped to our demo cohort tag. */
export async function fetchTaggedPatients(): Promise<FhirPatient[]> {
  const params = new URLSearchParams();
  params.set("_tag", COHORT_TAG);
  params.set("_count", "1000");
  params.set("_sort", "family");
  const bundle = (await request(`Patient?${params.toString()}`)) as Bundle;
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is FhirPatient => r?.resourceType === "Patient");
}

/**
 * Ids of patients in the HF cohort (Gate 1). FHIR can't filter Patient by diagnosis
 * code, so we search Condition (active + confirmed, coded in the terminology-expanded
 * HF value set) and collect the subject ids. Codes go in a POST `_search` body since
 * the expanded value set can be hundreds of codes — past URL-length limits.
 */
async function fetchHfCohortIds(): Promise<Set<string>> {
  const codes = await getHfCodes();
  const body = new URLSearchParams();
  body.set("_tag", COHORT_TAG);
  body.set("clinical-status", "active");
  body.set("verification-status", "confirmed");
  body.set("code", codes.map((c) => `${c.system}|${c.code}`).join(","));
  body.set("_elements", "subject");
  body.set("_count", "1000");

  const bundle = (await request("Condition/_search", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })) as Bundle;

  const ids = new Set<string>();
  for (const e of bundle.entry ?? []) {
    const ref = e.resource?.subject?.reference;
    if (ref?.startsWith("Patient/")) ids.add(ref.slice("Patient/".length));
  }
  return ids;
}

/**
 * Fetch one page of patients for the list, filtered by cohort membership.
 *
 * Loads all tagged patients plus the HF-cohort id set, then derives the All / HF /
 * Non-HF view client-side. Cheap because the data is tag-scoped to our demo cohort;
 * paging/filtering is client-side since a patient may have several HF Conditions
 * (which would break server-side Patient totals).
 */
export async function searchPatients(args: SearchArgs): Promise<SearchResult> {
  const [all, hfIdSet] = await Promise.all([fetchTaggedPatients(), fetchHfCohortIds()]);

  let patients = all;
  if (args.hfFilter === "hf") {
    patients = patients.filter((p) => p.id && hfIdSet.has(p.id));
  } else if (args.hfFilter === "non-hf") {
    patients = patients.filter((p) => !p.id || !hfIdSet.has(p.id));
  }

  // Client-side query filter: exact-ish MRN when all-digits, otherwise name contains.
  const q = args.query?.trim().toLowerCase();
  if (q) {
    patients = patients.filter((p) =>
      /^\d+$/.test(q) ? mrnOf(p).toLowerCase().includes(q) : fullName(p).toLowerCase().includes(q),
    );
  }

  patients = [...patients].sort((a, b) => fullName(a).localeCompare(fullName(b)));

  const total = patients.length;
  const start = args.page * args.pageSize;
  return {
    patients: patients.slice(start, start + args.pageSize),
    total,
    hfIds: [...hfIdSet],
  };
}

export function getPatient(id: string): Promise<FhirPatient> {
  return request(`Patient/${id}`) as Promise<FhirPatient>;
}

/**
 * Fetch all Observations for a patient (device vitals + labs), most recent first.
 * Used by the Vitals tab to feed the pure remote-monitoring alert engine. This is the
 * HAPI/no-auth sibling of `data/alertActions.loadAlerts` (which uses the SMART client).
 */
export async function getObservations(patientId: string): Promise<FhirResource[]> {
  const params = new URLSearchParams();
  params.set("patient", patientId);
  params.set("_count", "200");
  params.set("_sort", "-date");
  const bundle = (await request(`Observation?${params.toString()}`)) as {
    entry?: Array<{ resource?: FhirResource }>;
  };
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is FhirResource => r?.resourceType === "Observation");
}

/**
 * Fetch all Tasks for a patient (GDMT gaps + remote-monitoring follow-ups), newest
 * first. Scoped by `patient`, so it returns only this patient's Tasks even on the
 * shared public server. Used by the Tasks page to group work by patient.
 */
export async function getTasksForPatient(patientId: string): Promise<FhirResource[]> {
  const params = new URLSearchParams();
  params.set("patient", patientId);
  params.set("_count", "200");
  params.set("_sort", "-authored-on");
  const bundle = (await request(`Task?${params.toString()}`)) as {
    entry?: Array<{ resource?: FhirResource }>;
  };
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is FhirResource => r?.resourceType === "Task");
}

/** Create any FHIR resource on the HAPI server (used for alert writeback artifacts). */
export function createResource(resource: FhirResource): Promise<FhirResource> {
  return request(resource.resourceType, {
    method: "POST",
    body: JSON.stringify(resource),
  }) as Promise<FhirResource>;
}

/**
 * Idempotent create via search-then-create: if a resource already matches `searchQuery`
 * (e.g. `identifier=urn:hf-gdmt:alert|<key>:task`) it's returned as-is; otherwise it's
 * created. Used so re-accepting the same alert never produces duplicate artifacts.
 *
 * (We deliberately avoid the FHIR `If-None-Exist` conditional-create header — public
 * HAPI's CORS preflight rejects that custom header from the browser.)
 */
export async function createResourceIfNoneExist(resource: FhirResource, searchQuery: string): Promise<FhirResource> {
  const bundle = (await request(`${resource.resourceType}?${searchQuery}&_count=1`)) as {
    entry?: Array<{ resource?: FhirResource }>;
  };
  const existing = bundle.entry?.[0]?.resource;
  if (existing) return existing;
  return createResource(resource);
}

/**
 * Advance a Task's workflow status (and optional statusReason) via a full PUT. The
 * caller passes the existing Task resource so we round-trip it back with the new
 * status + a fresh `lastModified`, preserving every other field.
 */
export function updateTaskStatus(task: FhirResource, status: string, reason?: string): Promise<FhirResource> {
  const id = task.id as string | undefined;
  if (!id) throw new Error("Task has no id");
  const next: FhirResource = {
    ...task,
    status,
    lastModified: new Date().toISOString(),
    ...(reason ? { statusReason: { text: reason } } : {}),
  };
  return request(`Task/${id}`, { method: "PUT", body: JSON.stringify(next) }) as Promise<FhirResource>;
}

/** Persist a Task resource as-is (full PUT, bumps lastModified). Used for note autosave. */
export function saveTask(task: FhirResource): Promise<FhirResource> {
  const id = task.id as string | undefined;
  if (!id) throw new Error("Task has no id");
  const next: FhirResource = { ...task, lastModified: new Date().toISOString() };
  return request(`Task/${id}`, { method: "PUT", body: JSON.stringify(next) }) as Promise<FhirResource>;
}

export function createPatient(resource: FhirPatient): Promise<FhirPatient> {
  return request("Patient", { method: "POST", body: JSON.stringify(resource) }) as Promise<FhirPatient>;
}

export function updatePatient(id: string, resource: FhirPatient): Promise<FhirPatient> {
  return request(`Patient/${id}`, {
    method: "PUT",
    body: JSON.stringify({ ...resource, id }),
  }) as Promise<FhirPatient>;
}

export async function deletePatient(id: string): Promise<void> {
  await request(`Patient/${id}`, { method: "DELETE" });
}

/** True if another patient already uses this MRN (optionally excluding one id). */
export async function mrnExists(mrn: string, excludeId?: string): Promise<boolean> {
  const params = new URLSearchParams();
  params.set("identifier", `${MRN_SYSTEM}|${mrn.trim()}`);
  params.set("_total", "accurate");
  const bundle = (await request(`Patient?${params.toString()}`)) as Bundle;
  const matches = (bundle.entry ?? []).map((e) => e.resource).filter((r): r is FhirPatient => !!r);
  return matches.some((p) => p.id !== excludeId);
}
