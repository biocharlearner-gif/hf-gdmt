import { useEffect, useState } from "react";
import { beginAuth } from "../smartAuth";

export default function EhrLaunch() {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const iss    = params.get("iss");
        const launch = params.get("launch");

        if (!iss || !launch) {
            setError("Missing ?iss or ?launch parameter. This page must be opened by Epic, not directly.");
            return;
        }

        beginAuth({
            iss,
            launch,
            clientId:    import.meta.env.VITE_SMART_CLIENT_ID,
            redirectUri: import.meta.env.VITE_SMART_REDIRECT_URI,
            // EHR launch: the patient comes from Epic's `launch` context, so
            // patient-scoped reads + `launch`/`online_access` are enough. Falls
            // back to the legacy single VITE_SMART_SCOPE when unset.
            scope:       import.meta.env.VITE_SMART_SCOPE_EHR || import.meta.env.VITE_SMART_SCOPE,
        }).catch((err) => {
            setError(err instanceof Error ? err.message : "Unknown error");
        });
    }, []);

    if (error) {
        return (
            <div className="page-center">
                <div className="card card-narrow">
                    <div className="status-icon error-icon">✕</div>
                    <h2>EHR Launch failed</h2>
                    <div className="error-box">{error}</div>
                    <p className="subtitle">
                        This app must be launched from within Epic (Hyperspace).
                        Configure the Launch URL in your open.epic.com app registration.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="page-center">
            <div className="card card-narrow">
                <div className="exchanging-animation">
                    <div className="orbit-ring" />
                    <div className="orbit-core" />
                </div>
                <h2>Launching from Epic…</h2>
                <p className="subtitle">Reading EHR context and redirecting to authorize.</p>
            </div>
        </div>
    );
}
