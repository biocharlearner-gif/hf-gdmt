import type { SmartTokens } from "./smartAuth";
import { FhirClient, tokenGetter } from "./fhirClient";
import { providerFromIdToken, type SmartProvider } from "./smartUser";

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
// The signed-in clinician, from the id_token's fhirUser claim (provider-facing launch).
// Used to stamp Task.requester / CarePlan.author with the real ordering clinician.
let provider: SmartProvider = {};

export function setSession(tokens: SmartTokens): void {
  holder.tokens = tokens;
  selectedPatientId = tokens.patient ?? null;
  provider = providerFromIdToken(tokens.idToken);
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

/** The signed-in clinician (fhirUser). Empty {} for the demo/no-auth path. */
export function getProvider(): SmartProvider {
  return provider;
}

/**
 * Ensure the provider has a human-readable display name. The id_token often carries
 * only a `Practitioner` reference, so when the name is missing we read the Practitioner
 * resource once and cache the resolved name. Best-effort: failures leave the reference
 * intact (writes still carry `requester`, just without a display).
 */
export async function ensureProviderDisplay(): Promise<SmartProvider> {
  if (provider.display || !provider.reference || !client) return provider;
  try {
    const [type, id] = provider.reference.split("/");
    if (type !== "Practitioner" || !id) return provider;
    const res = await client.read("Practitioner", id);
    const n = res?.name?.[0];
    const display = n?.text || [(n?.given ?? []).join(" "), n?.family].filter(Boolean).join(" ");
    if (display) provider = { ...provider, display };
  } catch {
    // Non-fatal: keep the reference-only provider.
  }
  return provider;
}

export function clearSession(): void {
  holder.tokens = null;
  client = null;
  selectedPatientId = null;
  provider = {};
}
