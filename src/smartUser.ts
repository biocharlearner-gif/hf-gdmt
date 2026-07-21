/**
 * Resolve the signed-in clinician from a SMART on FHIR `id_token`.
 *
 * When the app requests `openid fhirUser`, the token response carries an `id_token`
 * (an OIDC JWT) whose `fhirUser` claim is an absolute URL to the logged-in user's
 * FHIR resource — a `Practitioner` for a provider-facing launch. We use it to stamp
 * `Task.requester` / `CarePlan.author` with the *real* ordering clinician instead of
 * a hardcoded name.
 *
 * These are PURE helpers (no I/O) so they're unit-testable. We do NOT verify the JWT
 * signature: the claim is used only for provenance/display, never as a security
 * decision — every access is still gated by the access token the server validates.
 */

export interface SmartProvider {
  /** Relative FHIR reference, e.g. "Practitioner/abc". */
  reference?: string;
  /** Human-readable name for display / *.display fields, when the token supplies one. */
  display?: string;
}

/** Decode a JWT's payload (middle segment) without verifying the signature. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    // base64url -> base64, then decode. atob exists in the browser; Buffer in Node tests.
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Reduce an absolute or relative FHIR user URL to a relative "ResourceType/id" reference. */
export function toRelativeReference(fhirUser: string): string {
  const m = fhirUser.match(/([A-Za-z]+\/[A-Za-z0-9\-.]+)\/?$/);
  return m?.[1] ?? fhirUser;
}

/**
 * Parse the provider identity from decoded OIDC claims. `fhirUser` is the standard
 * SMART claim; `profile` is the older Epic form. A display name is used only if the
 * token includes one — otherwise resolve it from the Practitioner resource later.
 */
export function parseProvider(claims: Record<string, unknown> | null): SmartProvider {
  if (!claims) return {};
  const ref = (claims.fhirUser ?? claims.profile) as string | undefined;
  const given = claims.given_name as string | undefined;
  const family = claims.family_name as string | undefined;
  const display =
    (claims.name as string | undefined) ??
    (claims.preferred_username as string | undefined) ??
    ([given, family].filter(Boolean).join(" ") || undefined);
  return {
    ...(ref ? { reference: toRelativeReference(ref) } : {}),
    ...(display ? { display } : {}),
  };
}

/** Convenience: id_token JWT -> provider identity. */
export function providerFromIdToken(idToken: string | undefined): SmartProvider {
  if (!idToken) return {};
  return parseProvider(decodeJwtPayload(idToken));
}
