/**
 * The signed-in clinician. Hardcoded for the demo (matches the AppLayout footer);
 * in a SMART context this would come from the access token / fhirUser. Centralised
 * so Task.owner, note authorship, etc. all reference the same identity.
 */
export const CURRENT_USER = {
  display: "Dr. Smith",
} as const;
