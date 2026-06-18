import { MRN_SYSTEM, PATIENT_FHIR_BASE } from "./fhirConfig";
import type { FhirPatient } from "./patientMapper";

/**
 * Thin no-auth FHIR client for the public HAPI server. The existing
 * src/fhirClient.ts FhirClient is coupled to SMART bearer tokens, so this is a
 * lightweight sibling rather than a retrofit.
 */

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

export interface SearchArgs {
  name?: string;
  birthDate?: string; // ISO YYYY-MM-DD
  mrn?: string;
  page: number; // 0-based
  pageSize: number;
}

export interface SearchResult {
  patients: FhirPatient[];
  total: number;
}

interface Bundle {
  total?: number;
  entry?: Array<{ resource: FhirPatient }>;
}

/** Search patients with offset-based paging. Returns the page plus accurate total. */
export async function searchPatients(args: SearchArgs): Promise<SearchResult> {
  const params = new URLSearchParams();
  params.set("_count", String(args.pageSize));
  params.set("_offset", String(args.page * args.pageSize));
  params.set("_total", "accurate");
  params.set("_sort", "family");
  if (args.name?.trim()) params.set("name", args.name.trim());
  if (args.birthDate?.trim()) params.set("birthdate", args.birthDate.trim());
  if (args.mrn?.trim()) params.set("identifier", `${MRN_SYSTEM}|${args.mrn.trim()}`);

  const bundle = (await request(`Patient?${params.toString()}`)) as Bundle;
  return {
    patients: (bundle.entry ?? []).map((e) => e.resource).filter((r) => r?.resourceType === "Patient"),
    total: bundle.total ?? 0,
  };
}

export function getPatient(id: string): Promise<FhirPatient> {
  return request(`Patient/${id}`) as Promise<FhirPatient>;
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
  const matches = (bundle.entry ?? []).map((e) => e.resource);
  return matches.some((p) => p.id !== excludeId);
}
