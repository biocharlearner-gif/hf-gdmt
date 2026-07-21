import { describe, it, expect } from "vitest";
import { decodeJwtPayload, toRelativeReference, parseProvider, providerFromIdToken } from "./smartUser";

/** Build an unsigned JWT with the given payload (base64url, no signature needed for our use). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

describe("toRelativeReference", () => {
  it("reduces an absolute Epic fhirUser URL to Practitioner/id", () => {
    expect(toRelativeReference("https://fhir.epic.com/.../api/FHIR/R4/Practitioner/eA1b2c3")).toBe("Practitioner/eA1b2c3");
  });
  it("passes a relative reference through", () => {
    expect(toRelativeReference("Practitioner/abc")).toBe("Practitioner/abc");
  });
  it("tolerates a trailing slash", () => {
    expect(toRelativeReference("https://ex.org/Practitioner/xyz/")).toBe("Practitioner/xyz");
  });
});

describe("parseProvider", () => {
  it("reads fhirUser + name", () => {
    expect(parseProvider({ fhirUser: "https://ex.org/Practitioner/p1", name: "Dr. Alice Wong" })).toEqual({
      reference: "Practitioner/p1",
      display: "Dr. Alice Wong",
    });
  });
  it("falls back to the older `profile` claim", () => {
    expect(parseProvider({ profile: "Practitioner/p2" })).toEqual({ reference: "Practitioner/p2" });
  });
  it("composes a display from given + family when `name` is absent", () => {
    expect(parseProvider({ fhirUser: "Practitioner/p3", given_name: "Bob", family_name: "Lee" }).display).toBe("Bob Lee");
  });
  it("returns {} for null claims", () => {
    expect(parseProvider(null)).toEqual({});
  });
  it("omits display when the token carries only a reference", () => {
    expect(parseProvider({ fhirUser: "Practitioner/p4" })).toEqual({ reference: "Practitioner/p4" });
  });
});

describe("decodeJwtPayload / providerFromIdToken", () => {
  it("decodes a JWT payload", () => {
    expect(decodeJwtPayload(jwt({ fhirUser: "Practitioner/x" }))).toEqual({ fhirUser: "Practitioner/x" });
  });
  it("returns null on a malformed token", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
  });
  it("end-to-end: id_token -> provider", () => {
    expect(providerFromIdToken(jwt({ fhirUser: "https://ex.org/Practitioner/z9", name: "Dr. Smith" }))).toEqual({
      reference: "Practitioner/z9",
      display: "Dr. Smith",
    });
  });
  it("returns {} when no id_token", () => {
    expect(providerFromIdToken(undefined)).toEqual({});
  });
});
