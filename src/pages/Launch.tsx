import { useState } from "react";
import { Link } from "react-router-dom";
import { beginAuth, type SmartConfig } from "../smartAuth";

const SMART_CONFIG: SmartConfig = {
    iss:         import.meta.env.VITE_SMART_ISS,
    clientId:    import.meta.env.VITE_SMART_CLIENT_ID,
    redirectUri: import.meta.env.VITE_SMART_REDIRECT_URI,
    scope:       import.meta.env.VITE_SMART_SCOPE,
};

export default function Launch() 
{
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
        <div className="page-center">
            <div className="card">
                {/* Header */}
                <div className="card-header">
                    <div className="pulse-ring" />
                        <span className="badge">SMART on FHIR</span>
                    </div>

                    <h1>OAuth / PKCE Dry Run</h1>
                    <p className="subtitle">
                    Smoke-tests your <code>smartAuth.ts</code> against the configured
                    SMART on FHIR endpoint using OAuth 2.0 + PKCE.
                    </p>

                {/* Config preview */}
                <div className="config-block">
                    <div className="config-row">
                        <span className="config-label">ISS</span>
                        <span className="config-value">{new URL(import.meta.env.VITE_SMART_ISS).host}</span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">Client ID</span>
                        <span className="config-value">{import.meta.env.VITE_SMART_CLIENT_ID}</span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">Redirect</span>
                        <span className="config-value">{import.meta.env.VITE_SMART_REDIRECT_URI}</span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">PKCE</span>
                        <span className="config-value config-green">S256 ✓</span>
                    </div>
                </div>

                {/* Flow steps */}
                <ol className="flow-steps">
                    <li><span className="step-num">1</span> Discover <code>.well-known/smart-configuration</code></li>
                    <li><span className="step-num">2</span> Generate PKCE pair + redirect to authorize</li>
                    <li><span className="step-num">3</span> Pick a patient in the sandbox UI</li>
                    <li><span className="step-num">4</span> Exchange code for tokens on <code>/callback</code></li>
                </ol>

                {error && (
                    <div className="error-box">
                        <strong>Discovery failed:</strong> {error}
                    </div>
                )}

                <button
                    className={`connect-btn ${status === "discovering" ? "loading" : ""}`}
                    onClick={handleConnect}
                    disabled={status === "discovering"}
                >
                {status === "discovering" ? (
                    <>
                        <span className="spinner" />
                        Discovering SMART config…
                    </>
                ) : (
                    "Connect →"
                )}
                </button>

                <p className="footnote">
                    Configure ISS, Client ID, and scopes in <code>.env</code>.
                </p>

                <p className="footnote">
                    Or open the <Link to="/patients">Patient Management</Link> module
                    (public FHIR server, no login).
                </p>
            </div>
        </div>
    );
}