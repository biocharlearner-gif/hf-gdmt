/**
 * Bundle the Vercel serverless functions into self-contained JS.
 *
 * Vercel's Node runtime compiles each /api entry individually but does NOT bundle
 * TypeScript imported from OUTSIDE /api (../src, ../server) — those imports fail at
 * runtime with "Cannot find module". So we author the handlers in api-src/ and esbuild
 * them (bundle: true) into api/*.js with every shared import inlined. The shared logic
 * still lives once in src/ + server/; it is only copied into the function at build time.
 *
 * Run: `node scripts/build-api.mjs` (also part of the Vercel buildCommand).
 */
import { build } from "esbuild";

const entries = [
  { in: "api-src/fhir-proxy.ts", out: "api/fhir-proxy.js" },
  { in: "api-src/notify.ts", out: "api/notify.js" },
  { in: "api-src/rationale.ts", out: "api/rationale.js" },
  { in: "api-src/health.ts", out: "api/health.js" },
  { in: "api-src/cds-discovery.ts", out: "api/cds-services.js" },
  { in: "api-src/cds-card.ts", out: "api/cds-services/[service].js" },
];

await Promise.all(
  entries.map((e) =>
    build({
      entryPoints: [e.in],
      outfile: e.out,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      // Node built-ins stay external; everything from src/server is inlined.
      packages: "external",
      logLevel: "info",
    }),
  ),
);

console.log(`Bundled ${entries.length} Vercel function(s) → api/`);
