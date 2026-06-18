import { MRN_SYSTEM, MRN_TYPE } from "./fhirConfig";
import { parseDob, type PatientFormValues } from "./patientSchema";

/** Minimal FHIR Patient shape we read/write. */
export interface FhirPatient {
  resourceType: "Patient";
  id?: string;
  name?: Array<{ use?: string; family?: string; given?: string[] }>;
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string; // ISO YYYY-MM-DD
  identifier?: Array<{
    use?: string;
    type?: { coding?: Array<{ system?: string; code?: string }> };
    system?: string;
    value?: string;
  }>;
  telecom?: Array<{ system?: string; value?: string }>;
  address?: Array<{
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
}

/** MM-DD-YYYY → YYYY-MM-DD (ISO). Assumes a validated input. */
export function dobToIso(value: string): string {
  const [mm, dd, yyyy] = value.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

/** YYYY-MM-DD → MM-DD-YYYY for display/editing. */
export function isoToDob(iso?: string): string {
  if (!iso) return "";
  const [yyyy, mm, dd] = iso.split("-");
  return mm && dd && yyyy ? `${mm}-${dd}-${yyyy}` : "";
}

/** Extract the MRN value from a Patient resource. */
export function mrnOf(p: FhirPatient): string {
  const id = p.identifier?.find((i) => i.system === MRN_SYSTEM);
  return id?.value ?? "";
}

/** Display full name "First Middle Last". */
export function fullName(p: FhirPatient): string {
  const n = p.name?.[0];
  if (!n) return "(unnamed)";
  return [...(n.given ?? []), n.family].filter(Boolean).join(" ") || "(unnamed)";
}

/** Display DOB as MM-DD-YYYY. */
export function formatDob(p: FhirPatient): string {
  return isoToDob(p.birthDate);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Display DOB as "12 May 1985" (used in the patient table/headers). */
export function formatDobLong(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Whole-year age from an ISO birthDate, or null if unknown. */
export function ageFromIso(iso?: string): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

/** Initials for an avatar, e.g. "Jane Doe" → "JD". */
export function initialsOf(p: FhirPatient): string {
  const n = p.name?.[0];
  const first = n?.given?.[0]?.[0] ?? "";
  const last = n?.family?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
}

const AVATAR_COLORS = ["#dbeafe", "#cffafe", "#dcfce7", "#fef9c3", "#fae8ff", "#ffe4e6", "#e0e7ff"];
const AVATAR_FG = ["#1e40af", "#0e7490", "#15803d", "#854d0e", "#86198f", "#9f1239", "#3730a3"];

/** Deterministic pale avatar background/foreground from a patient's id/name. */
export function avatarColors(p: FhirPatient): { bg: string; fg: string } {
  const key = (p.id ?? mrnOf(p) ?? fullName(p)) || "?";
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const idx = h % AVATAR_COLORS.length;
  return { bg: AVATAR_COLORS[idx], fg: AVATAR_FG[idx] };
}

/** Build a FHIR Patient from validated form values. Preserves id when editing. */
export function formToPatient(v: PatientFormValues, id?: string): FhirPatient {
  const given = [v.firstName.trim()];
  if (v.middleName?.trim()) given.push(v.middleName.trim());

  const telecom: FhirPatient["telecom"] = [];
  if (v.phone?.trim()) telecom.push({ system: "phone", value: v.phone.trim() });
  if (v.email?.trim()) telecom.push({ system: "email", value: v.email.trim() });

  const hasAddress = v.addressLine || v.city || v.state || v.zip || v.country;
  const address: FhirPatient["address"] = hasAddress
    ? [
        {
          ...(v.addressLine?.trim() ? { line: [v.addressLine.trim()] } : {}),
          ...(v.city?.trim() ? { city: v.city.trim() } : {}),
          ...(v.state?.trim() ? { state: v.state.trim() } : {}),
          ...(v.zip?.trim() ? { postalCode: v.zip.trim() } : {}),
          ...(v.country?.trim() ? { country: v.country.trim() } : {}),
        },
      ]
    : undefined;

  return {
    resourceType: "Patient",
    ...(id ? { id } : {}),
    name: [{ use: "official", family: v.lastName.trim(), given }],
    gender: v.gender,
    birthDate: dobToIso(v.dob),
    identifier: [
      {
        use: "usual",
        type: { coding: [{ system: MRN_TYPE.system, code: MRN_TYPE.code }] },
        system: MRN_SYSTEM,
        value: v.mrn.trim(),
      },
    ],
    ...(telecom.length ? { telecom } : {}),
    ...(address ? { address } : {}),
  };
}

/** Build form values from a FHIR Patient for the edit flow. */
export function patientToForm(p: FhirPatient): PatientFormValues {
  const n = p.name?.[0];
  const given = n?.given ?? [];
  const addr = p.address?.[0];
  return {
    firstName: given[0] ?? "",
    middleName: given.slice(1).join(" "),
    lastName: n?.family ?? "",
    gender: (p.gender ?? "") as PatientFormValues["gender"],
    dob: isoToDob(p.birthDate),
    mrn: mrnOf(p),
    phone: p.telecom?.find((t) => t.system === "phone")?.value ?? "",
    email: p.telecom?.find((t) => t.system === "email")?.value ?? "",
    addressLine: addr?.line?.[0] ?? "",
    city: addr?.city ?? "",
    state: addr?.state ?? "",
    zip: addr?.postalCode ?? "",
    country: addr?.country ?? "",
  };
}

// re-export for callers that need date helpers
export { parseDob };
