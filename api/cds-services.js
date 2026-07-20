// src/engine/codes.ts
var SNOMED = {
  HEART_FAILURE: "84114007",
  HFREF: "703272007"
};
var TARGET_DOSE_MG = {
  // RAASi
  "sacubitril/valsartan": 194 + 206,
  // target 97/103 mg BID -> ~400 mg/day combined salt
  "entresto": 400,
  lisinopril: 40,
  enalapril: 40,
  ramipril: 10,
  losartan: 150,
  valsartan: 320,
  candesartan: 32,
  // Beta-blockers
  carvedilol: 50,
  "metoprolol succinate": 200,
  metoprolol: 200,
  bisoprolol: 10,
  // MRA
  spironolactone: 50,
  eplerenone: 50,
  // SGLT2i (fixed dose — "at target" if on it)
  dapagliflozin: 10,
  empagliflozin: 10
};

// src/engine/rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;

// src/fhir/extract.ts
var HF_ENCOUNTER_SNOMED = /* @__PURE__ */ new Set([
  SNOMED.HEART_FAILURE,
  SNOMED.HFREF,
  "42343007",
  // Congestive heart failure
  "88805009",
  // Chronic congestive heart failure
  "56675007"
  // Acute heart failure
]);

// src/cds/service.ts
var SERVICE_ID = "hf-gdmt-optimizer";
function discovery() {
  return {
    services: [
      {
        hook: "patient-view",
        id: SERVICE_ID,
        title: "HF GDMT Optimizer",
        description: "Flags heart-failure patients below guideline-directed medical therapy and links to the optimizer.",
        prefetch: {
          patient: "Patient/{{context.patientId}}",
          conditions: "Condition?patient={{context.patientId}}",
          medications: "MedicationRequest?patient={{context.patientId}}",
          observations: "Observation?patient={{context.patientId}}&_sort=-date"
        }
      }
    ]
  };
}

// api-src/cds-discovery.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var cds_discovery_default = {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return new Response(JSON.stringify(discovery()), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
};
export {
  cds_discovery_default as default
};
