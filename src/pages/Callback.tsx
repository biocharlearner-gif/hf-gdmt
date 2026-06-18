import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeAuth } from "../smartAuth";
import { setSession } from "../session";

type Status = "exchanging" | "error";

// The OAuth authorization code is single-use. React StrictMode (and any remount)
// invokes the effect twice, which would POST the code twice — the second attempt
// fails with invalid_grant. Cache the promise so both invocations share one
// exchange and the same result.
let exchangePromise: ReturnType<typeof completeAuth> | null = null;
function exchangeOnce() {
    if (!exchangePromise) exchangePromise = completeAuth();
    return exchangePromise;
}

export default function Callback()
{
    const [status, setStatus] = useState<Status>("exchanging");
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        // exchangeOnce() reads ?code and ?state from the URL, verifies CSRF,
        // then POSTs to the token endpoint and returns tokens. Cached so the
        // single-use code is exchanged exactly once even under StrictMode.
        exchangeOnce()
        .then((t) => {
            setSession(t);
            // Patient standalone supplies a patient context; provider standalone does
            // not, so the provider picks a patient first.
            navigate(t.patient ? "/patient" : "/select", { replace: true });
        })
        .catch((err) => {
            setError(err instanceof Error ? err.message : "Unknown error");
            setStatus("error");
        });
    }, [navigate]); // runs once on mount

    // ── Exchanging ──────────────────────────────────────────────────────────────
    if (status === "exchanging") {
        return (
            <div className="page-center">
                <div className="card card-narrow">
                    <div className="exchanging-animation">
                        <div className="orbit-ring" />
                        <div className="orbit-core" />
                    </div>
                    <h2>Exchanging code for tokens…</h2>
                    <p className="subtitle">POSTing to token endpoint with PKCE verifier.</p>
                </div>
            </div>
        );
    }

    // ── Error ───────────────────────────────────────────────────────────────────
    return (
        <div className="page-center">
            <div className="card card-narrow">
                <div className="status-icon error-icon">✕</div>
                <h2>Token exchange failed</h2>
                <div className="error-box">{error}</div>
                <p className="subtitle">Common causes:</p>
                <ul className="cause-list">
                    <li>Redirect URI mismatch — must be exactly <code>{import.meta.env.VITE_SMART_REDIRECT_URI}</code></li>
                    <li>sessionStorage was cleared mid-flow (e.g. browser opened new tab)</li>
                    <li>State mismatch — you hit /callback without going through /</li>
                </ul>
                <button className="connect-btn" onClick={() => navigate("/")}>
                    ← Try again
                </button>
            </div>
        </div>
    );
}
