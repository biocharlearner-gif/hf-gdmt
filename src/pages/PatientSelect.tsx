import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, getClient, setSelectedPatient } from "../session";

interface Hit { id: string; name: string; birthDate?: string; gender?: string }

function humanName(p: any): string {
    const n = p?.name?.[0];
    if (!n) return "Unknown";
    if (n.text) return n.text;
    return [(n.given ?? []).join(" "), n.family].filter(Boolean).join(" ") || "Unknown";
}

export default function PatientSelect() {
    const navigate = useNavigate();
    const [family, setFamily] = useState("");
    const [given, setGiven] = useState("");
    const [byId, setById] = useState("");
    const [hits, setHits] = useState<Hit[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!getSession()) navigate("/", { replace: true });
    }, [navigate]);

    function open(id: string) {
        setSelectedPatient(id);
        navigate("/patient");
    }

    async function search(e: React.FormEvent) {
        e.preventDefault();
        if (!family.trim() && !given.trim()) {
            setError("Enter at least a family or given name.");
            return;
        }
        setBusy(true); setError(null); setHits(null);
        try {
            const params: Record<string, string> = {};
            if (family.trim()) params.family = family.trim();
            if (given.trim()) params.given = given.trim();
            const bundle = await getClient().search("Patient", params);
            const found: Hit[] = (bundle.entry ?? [])
                .map((en: any) => en.resource)
                .filter((r: any) => r?.resourceType === "Patient")
                .map((p: any) => ({ id: p.id, name: humanName(p), birthDate: p.birthDate, gender: p.gender }));
            setHits(found);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Search failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="page-center">
            <div className="card">
                <div className="card-header">
                    <span className="badge">Provider · Select patient</span>
                </div>
                <h1>Find a patient</h1>
                <p className="subtitle">Search the Epic sandbox, or open a known patient by FHIR id.</p>

                <form onSubmit={search} className="select-form">
                    <input className="text-input" placeholder="Family name" value={family}
                           onChange={(e) => setFamily(e.target.value)} />
                    <input className="text-input" placeholder="Given name (optional)" value={given}
                           onChange={(e) => setGiven(e.target.value)} />
                    <button className="connect-btn" type="submit" disabled={busy}>
                        {busy ? "Searching…" : "Search"}
                    </button>
                </form>

                <div className="select-byid">
                    <input className="text-input" placeholder="…or paste a Patient FHIR id" value={byId}
                           onChange={(e) => setById(e.target.value)} />
                    <button className="action-btn" disabled={!byId.trim()} onClick={() => open(byId.trim())}>
                        Open by id
                    </button>
                </div>

                {error && <div className="error-box">{error}</div>}

                {hits && (
                    <div className="hit-list">
                        {hits.length === 0 && <p className="subtitle">No patients found.</p>}
                        {hits.map((h) => (
                            <button className="hit-row" key={h.id} onClick={() => open(h.id)}>
                                <span className="hit-name">{h.name}</span>
                                <span className="hit-meta">{h.gender ?? "?"} · {h.birthDate ?? "?"}</span>
                            </button>
                        ))}
                    </div>
                )}

                <button className="connect-btn secondary" onClick={() => navigate("/")}>← Disconnect</button>
            </div>
        </div>
    );
}
