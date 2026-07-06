import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { beginAuth, type SmartConfig } from "../smartAuth";

const SMART_CONFIG: SmartConfig = {
    iss:         import.meta.env.VITE_SMART_ISS,
    clientId:    import.meta.env.VITE_SMART_CLIENT_ID,
    redirectUri: import.meta.env.VITE_SMART_REDIRECT_URI,
    scope:       import.meta.env.VITE_SMART_SCOPE,
};

const FEATURES = [
    {
        icon: "⚙️",
        title: "Deterministic GDMT engine",
        body: "A pure, guideline-coded rule engine decides every recommendation. AI only explains — never prescribes.",
    },
    {
        icon: "🩺",
        title: "Two-gate eligibility",
        body: "HF cohort via a terminology server, then LVEF phenotyping — four-pillar therapy scored for HFrEF only.",
    },
    {
        icon: "📚",
        title: "Cited rationale (RAG)",
        body: "Every care gap is explained against the 2022 AHA/ACC/HFSA guideline with grounded citations.",
    },
    {
        icon: "🔁",
        title: "Closed-loop writeback",
        body: "Accepted gaps become FHIR Tasks and a CarePlan — read from Epic, write to a configured server.",
    },
];

export default function Launch()
{
    const navigate = useNavigate();
    const [status, setStatus] = useState<"idle" | "discovering" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    async function handleConnect()
    {
        setStatus("discovering");
        setError(null);

        try {
            // beginAuth() discovers the sandbox, stores PKCE state in sessionStorage,
            // then redirects the browser — so nothing after this line runs.
            await beginAuth(SMART_CONFIG);
        } catch (err) {
            setStatus("error");
            setError(err instanceof Error ? err.message : "Unknown error");
        }
    }

    return (
        <div className="login-split">
            {/* ── Left: project explainer (branded) ───────────────────────── */}
            <aside className="login-hero">
                <div className="login-hero-top">
                    <div className="login-brand">
                        <span className="pulse-ring" />
                        <span>HF GDMT Optimizer</span>
                    </div>
                    <h1 className="login-hero-title">
                        Guideline-directed therapy for heart failure, scored end&#8209;to&#8209;end.
                    </h1>
                    <p className="login-hero-tagline">
                        A SMART on FHIR app that finds GDMT gaps in HFrEF patients,
                        explains each with citations, and writes FHIR Tasks to close the loop.
                    </p>
                </div>

                <ul className="login-features">
                    {FEATURES.map((f) => (
                        <li key={f.title} className="login-feature">
                            <span className="login-feature-icon">{f.icon}</span>
                            <div>
                                <span className="login-feature-title">{f.title}</span>
                                <p className="login-feature-body">{f.body}</p>
                            </div>
                        </li>
                    ))}
                </ul>

                <p className="login-hero-foot">Medblocks FHIR App Challenge · FHIR R4</p>
            </aside>

            {/* ── Right: sign-in (light) ──────────────────────────────────── */}
            <main className="login-panel">
                <div className="login-card">
                    <span className="login-card-badge">Sign in</span>
                    <h2 className="login-card-title">Choose how to start</h2>
                    <p className="login-card-sub">
                        Connect a real EHR via SMART on FHIR, or explore instantly with
                        the demo data set.
                    </p>

                    {/* Flow 1 — SMART on FHIR (OAuth2 + PKCE) */}
                    <button
                        className={`login-btn login-btn-primary ${status === "discovering" ? "is-loading" : ""}`}
                        onClick={handleConnect}
                        disabled={status === "discovering"}
                    >
                        {status === "discovering" ? (
                            <>
                                <span className="spinner" />
                                Discovering SMART config…
                            </>
                        ) : (
                            "Connect with Epic (SMART on FHIR)"
                        )}
                    </button>

                    {error && (
                        <div className="login-error">
                            <strong>SMART connect failed:</strong> {error}
                        </div>
                    )}

                    <div className="login-divider"><span>or</span></div>

                    {/* Flow 2 — no-friction demo (public FHIR server, no auth) */}
                    <button
                        className="login-btn login-btn-secondary"
                        onClick={() => navigate("/patients")}
                        disabled={status === "discovering"}
                    >
                        Continue with Demo Account
                    </button>

                    <p className="login-card-foot">
                        Demo uses a public FHIR sandbox — no login, no real patient data.
                    </p>
                </div>
            </main>
        </div>
    );
}
