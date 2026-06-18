import type { SmartTokens } from "./smartAuth";
import { FhirClient, tokenGetter } from "./fhirClient";

/**
 * In-memory session (spec NFR: tokens never touch localStorage). A single mutable
 * holder so `tokenGetter(holder)` always reads the current access token, and a
 * lazily-built `FhirClient` pointed at the authenticated Epic base (`iss`).
 *
 * Write base defaults to the read base (single-vendor Epic mode); override via
 * VITE_FHIR_WRITE_BASE once the write target is decided (Phase 4).
 */
const holder: { tokens: SmartTokens | null } = { tokens: null };

let client: FhirClient | null = null;
// Provider standalone returns no patient context, so the provider picks one in-app.
// Patient standalone supplies tokens.patient directly. selectedPatient overrides.
let selectedPatientId: string | null = null;

export function setSession(tokens: SmartTokens): void {
  holder.tokens = tokens;
  selectedPatientId = tokens.patient ?? null;
  const writeBaseUrl = import.meta.env.VITE_FHIR_WRITE_BASE || tokens.iss;
  client = new FhirClient({
    readBaseUrl: tokens.iss,
    writeBaseUrl,
    getAccessToken: tokenGetter(holder),
  });
}

export function getSession(): SmartTokens | null {
  return holder.tokens;
}

/** The patient to load: provider-selected, else the launch-supplied context. */
export function getActivePatientId(): string | null {
  return selectedPatientId;
}

export function setSelectedPatient(id: string): void {
  selectedPatientId = id;
}

export function getClient(): FhirClient {
  if (!client) throw new Error("No active session — authenticate first");
  return client;
}

export function clearSession(): void {
  holder.tokens = null;
  client = null;
  selectedPatientId = null;
}
