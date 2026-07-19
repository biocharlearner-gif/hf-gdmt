import { z } from "zod";

/**
 * Single source of truth for patient form validation, reused by both the Add
 * and Edit flows. MRN *format* is validated here; MRN *uniqueness* is an async
 * server check performed at submit time (see patientApi.mrnExists), not in zod.
 */

const ALPHA = /^[A-Za-z]+$/;
const ALPHA_SPACE = /^[A-Za-z ]+$/;
const MRN_RE = /^[A-Za-z0-9-]+$/;
const ADDRESS_RE = /^[A-Za-z0-9\-/,. ]+$/;
const DOB_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-(\d{4})$/; // MM-DD-YYYY

const ADULT_MESSAGE =
  "Standard GDMT protocol is valid only for adults i.e age greater than 18 years";

/** Parse an MM-DD-YYYY string into a Date, returning null if not a real calendar date. */
export function parseDob(value: string): Date | null {
  const m = DOB_RE.exec(value);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null; // e.g. 02-30-2000
  }
  return d;
}

/** Whole-year age as of today. */
export function ageInYears(dob: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age--;
  return age;
}

// Optional text field that treats "" as undefined so empty inputs skip validation.
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const patientSchema = z.object({
  firstName: z
    .string()
    .min(5, "Min 5 characters")
    .max(25, "Max 25 characters")
    .regex(ALPHA, "Only alphabets allowed"),
  middleName: optionalString.pipe(
    z.string().min(5, "Min 5 characters").max(25, "Max 25 characters").regex(ALPHA, "Only alphabets allowed").optional(),
  ),
  lastName: z
    .string()
    .min(5, "Min 5 characters")
    .max(25, "Max 25 characters")
    .regex(ALPHA, "Only alphabets allowed"),

  gender: z.enum(["male", "female", "other", "unknown"], {
    message: "Gender is required",
  }),

  dob: z
    .string()
    .regex(DOB_RE, "Use MM-DD-YYYY format")
    .refine((v) => parseDob(v) !== null, "Not a valid date")
    .refine((v) => {
      const d = parseDob(v);
      return d !== null && ageInYears(d) > 18;
    }, ADULT_MESSAGE),

  mrn: z
    .string()
    .min(5, "Min 5 characters")
    .max(64, "Max 64 characters")
    .regex(MRN_RE, "Alphanumeric and hyphen only"),

  phone: optionalString.pipe(
    z.string().regex(/^\d{10}$/, "Must be exactly 10 digits").optional(),
  ),

  email: optionalString.pipe(
    z.string().min(5, "Min 5 characters").max(200, "Max 200 characters").email("Invalid email").optional(),
  ),

  addressLine: optionalString.pipe(
    z.string().max(100, "Max 100 characters").regex(ADDRESS_RE, "Invalid characters").optional(),
  ),
  city: optionalString.pipe(
    z.string().max(50, "Max 50 characters").regex(ALPHA_SPACE, "Only alphabets allowed").optional(),
  ),
  state: optionalString.pipe(
    z.string().max(50, "Max 50 characters").regex(ALPHA_SPACE, "Only alphabets allowed").optional(),
  ),
  zip: optionalString.pipe(
    z.string().regex(/^\d{5}$/, "Must be exactly 5 digits").optional(),
  ),
  country: optionalString.pipe(
    z.string().max(50, "Max 50 characters").regex(ALPHA_SPACE, "Only alphabets allowed").optional(),
  ),

  // Primary diagnosis / problem-list entry. Optional in the schema so the Edit flow
  // (which doesn't load Conditions) still validates; the Add dialog enforces it and
  // uses it to write a coded Condition + place the patient in the HF / Non-HF cohort.
  problem: optionalString,
});

export type PatientFormValues = z.input<typeof patientSchema>;
export type PatientFormOutput = z.output<typeof patientSchema>;

export const emptyPatientForm: PatientFormValues = {
  firstName: "",
  middleName: "",
  lastName: "",
  gender: "" as unknown as PatientFormValues["gender"],
  dob: "",
  mrn: "",
  phone: "",
  email: "",
  addressLine: "",
  city: "",
  state: "",
  zip: "",
  country: "",
  problem: "",
};
