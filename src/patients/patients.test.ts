import { describe, expect, it } from "vitest";
import { patientSchema, parseDob, ageInYears } from "./patientSchema";
import { formToPatient, patientToForm, mrnOf, fullName, dobToIso, isoToDob } from "./patientMapper";

const valid = {
  firstName: "Robert",
  middleName: "",
  lastName: "Mendez",
  gender: "male" as const,
  dob: "01-15-1980",
  mrn: "MRN-12345",
  phone: "",
  email: "",
  addressLine: "",
  city: "",
  state: "",
  zip: "",
  country: "",
};

describe("date helpers", () => {
  it("parses MM-DD-YYYY", () => {
    expect(parseDob("02-28-1990")).toBeInstanceOf(Date);
  });
  it("rejects impossible dates", () => {
    expect(parseDob("02-30-1990")).toBeNull();
    expect(parseDob("13-01-1990")).toBeNull();
    expect(parseDob("1990-01-01")).toBeNull();
  });
  it("computes whole-year age", () => {
    const today = new Date("2026-06-17");
    expect(ageInYears(new Date(2000, 5, 17), today)).toBe(26);
    expect(ageInYears(new Date(2000, 5, 18), today)).toBe(25); // day before birthday
  });
  it("converts between iso and display", () => {
    expect(dobToIso("01-15-1980")).toBe("1980-01-15");
    expect(isoToDob("1980-01-15")).toBe("01-15-1980");
  });
});

describe("schema", () => {
  it("accepts a valid adult patient", () => {
    expect(patientSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects names under 5 chars or non-alpha", () => {
    expect(patientSchema.safeParse({ ...valid, firstName: "Bob" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...valid, firstName: "Rob3rt" }).success).toBe(false);
  });
  it("requires gender", () => {
    expect(patientSchema.safeParse({ ...valid, gender: "" }).success).toBe(false);
  });
  it("rejects under-18 with the GDMT message", () => {
    const res = patientSchema.safeParse({ ...valid, dob: "01-15-2015" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.message.includes("adults"))).toBe(true);
    }
  });
  it("validates MRN charset and length", () => {
    expect(patientSchema.safeParse({ ...valid, mrn: "ab" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...valid, mrn: "MRN_001" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...valid, mrn: "A-12B" }).success).toBe(true);
  });
  it("validates optional phone/email/zip when present", () => {
    expect(patientSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...valid, phone: "1234567890" }).success).toBe(true);
    expect(patientSchema.safeParse({ ...valid, zip: "1234" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...valid, email: "bad" }).success).toBe(false);
  });
});

describe("mapper round-trip", () => {
  it("maps form → FHIR Patient", () => {
    const p = formToPatient({ ...valid, middleName: "James" }, "abc");
    expect(p.id).toBe("abc");
    expect(p.name?.[0]?.given).toEqual(["Robert", "James"]);
    expect(p.name?.[0]?.family).toBe("Mendez");
    expect(p.birthDate).toBe("1980-01-15");
    expect(mrnOf(p)).toBe("MRN-12345");
    expect(fullName(p)).toBe("Robert James Mendez");
  });
  it("round-trips through patientToForm", () => {
    const p = formToPatient(
      { ...valid, middleName: "James", phone: "1234567890", email: "a@b.co", city: "Boston" },
    );
    const back = patientToForm(p);
    expect(back.firstName).toBe("Robert");
    expect(back.middleName).toBe("James");
    expect(back.dob).toBe("01-15-1980");
    expect(back.phone).toBe("1234567890");
    expect(back.city).toBe("Boston");
  });
});
