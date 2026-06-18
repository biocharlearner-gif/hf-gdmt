import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession } from "../session";
import { loadPatientData, type PatientData } from "../data/loadPatient";
import { createTaskForPillar, createLabOrder, createCarePlanFor } from "../data/writeActions";
import type { PillarResult, PillarStatus } from "../engine/types";

const STATUS_LABEL: Record<PillarStatus, string> = {
    ON_TARGET: "On target",
    ON_SUBTARGET: "On — sub-target",
    GAP_ELIGIBLE: "Gap — eligible",
    GAP_LABS_NEEDED: "Labs needed",
    CONTRAINDICATED: "Contraindicated",
    INSUFFICIENT_DATA: "Insufficient data",
};

const STATUS_CLASS: Record<PillarStatus, string> = {
    ON_TARGET: "st-on-target",
    ON_SUBTARGET: "st-subtarget",
    GAP_ELIGIBLE: "st-gap",
    GAP_LABS_NEEDED: "st-labs",
    CONTRAINDICATED: "st-contra",
    INSUFFICIENT_DATA: "st-insufficient",
};

const TASK_STATUSES = new Set<PillarStatus>(["GAP_ELIGIBLE", "ON_SUBTARGET"]);

interface ActionState { status: "idle" | "busy" | "done" | "error"; msg?: string }
const IDLE: ActionState = { status: "idle" };

export default function PatientView() {
    const navigate = useNavigate();
    const [data, setData] = useState<PatientData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // write-back state, keyed by pillar id; plus collected Task refs + CarePlan state
    const [actions, setActions] = useState<Record<string, ActionState>>({});
    const [taskRefs, setTaskRefs] = useState<string[]>([]);
    const [carePlan, setCarePlan] = useState<ActionState>(IDLE);

    useEffect(() => {
        if (!getSession()) {
            navigate("/", { replace: true });
            return;
        }
        loadPatientData()
            .then(setData)
            .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"));
    }, [navigate]);

    const setAction = (id: string, s: ActionState) =>
        setActions((prev) => ({ ...prev, [id]: s }));

    async function handleCreateTask(pillar: PillarResult) {
        setAction(pillar.id, { status: "busy" });
        try {
            const id = await createTaskForPillar(pillar);
            setTaskRefs((prev) => [...prev, `Task/${id}`]);
            setAction(pillar.id, { status: "done", msg: `Task created (${id})` });
        } catch (err) {
            setAction(pillar.id, { status: "error", msg: err instanceof Error ? err.message : "Failed" });
        }
    }

    async function handleOrderLabs(pillar: PillarResult) {
        setAction(pillar.id, { status: "busy" });
        try {
            const id = await createLabOrder();
            setAction(pillar.id, { status: "done", msg: `Lab order created (${id})` });
        } catch (err) {
            setAction(pillar.id, { status: "error", msg: err instanceof Error ? err.message : "Failed" });
        }
    }

    async function handleCarePlan() {
        if (!data) return;
        setCarePlan({ status: "busy" });
        try {
            const id = await createCarePlanFor(data.assessment, taskRefs);
            setCarePlan({ status: "done", msg: `CarePlan created (${id})` });
        } catch (err) {
            setCarePlan({ status: "error", msg: err instanceof Error ? err.message : "Failed" });
        }
    }

    if (error) {
        return (
            <div className="page-center">
                <div className="card card-narrow">
                    <div className="status-icon error-icon">✕</div>
                    <h2>Could not load patient</h2>
                    <div className="error-box">{error}</div>
                    <button className="connect-btn" onClick={() => navigate("/")}>← Back</button>
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="page-center">
                <div className="card card-narrow">
                    <div className="exchanging-animation">
                        <div className="orbit-ring" />
                        <div className="orbit-core" />
                    </div>
                    <h2>Loading patient & GDMT assessment…</h2>
                    <p className="subtitle">Reading FHIR resources and running the rule engine.</p>
                </div>
            </div>
        );
    }

    const { patient, assessment } = data;

    return (
        <div className="page-center">
            <div className="card">
                {/* Patient header */}
                <div className="card-header">
                    <span className="badge">SMART on FHIR · Epic</span>
                </div>
                <h1>{patient.name}</h1>
                <div className="config-block">
                    <div className="config-row">
                        <span className="config-label">Age / Sex</span>
                        <span className="config-value">
                            {patient.age ?? "?"} · {patient.gender ?? "unknown"}
                        </span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">MRN</span>
                        <span className="config-value">{patient.mrn ?? "—"}</span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">LVEF</span>
                        <span className="config-value">
                            {assessment.lvef !== undefined ? `${assessment.lvef}%` : "unknown"}
                        </span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">Phenotype</span>
                        <span className="config-value config-green">{assessment.phenotype}</span>
                    </div>
                </div>

                {/* GDMT score */}
                <div className="gdmt-score">
                    <span className="gdmt-score-num">{assessment.gdmtScore}</span>
                    <span className="gdmt-score-of">/ 4 pillars on therapy</span>
                    <span className="gdmt-opt">{Math.round(assessment.optimizationPct * 100)}% at target</span>
                </div>

                {/* Pillar panel */}
                <div className="pillar-list">
                    {assessment.pillars.map((p) => {
                        const a = actions[p.id] ?? IDLE;
                        const canTask = TASK_STATUSES.has(p.status);
                        const canLabs = p.status === "GAP_LABS_NEEDED";
                        return (
                            <div className="pillar-row" key={p.id}>
                                <div className="pillar-head">
                                    <span className="pillar-label">{p.label}</span>
                                    <span className={`pillar-status ${STATUS_CLASS[p.status]}`}>
                                        {STATUS_LABEL[p.status]}
                                    </span>
                                </div>
                                {p.agent && (
                                    <div className="pillar-agent">
                                        {p.agent.name}
                                        {p.agent.dailyDoseMg ? ` · ${p.agent.dailyDoseMg} mg/day` : ""}
                                        {p.agent.targetDoseMg ? ` (target ${p.agent.targetDoseMg})` : ""}
                                    </div>
                                )}
                                <div className="pillar-reason">{p.reason}</div>
                                <div className="pillar-cite">Source: {p.citationRef}</div>

                                {(canTask || canLabs) && (
                                    <div className="pillar-actions">
                                        {canTask && (
                                            <button
                                                className="action-btn"
                                                disabled={a.status === "busy" || a.status === "done"}
                                                onClick={() => handleCreateTask(p)}
                                            >
                                                {a.status === "busy" ? "Creating…"
                                                    : a.status === "done" ? "✓ Task created"
                                                    : p.suggestedAction?.text ?? "Create Task"}
                                            </button>
                                        )}
                                        {canLabs && (
                                            <button
                                                className="action-btn"
                                                disabled={a.status === "busy" || a.status === "done"}
                                                onClick={() => handleOrderLabs(p)}
                                            >
                                                {a.status === "busy" ? "Ordering…"
                                                    : a.status === "done" ? "✓ Labs ordered"
                                                    : "Order labs"}
                                            </button>
                                        )}
                                        {a.status === "error" && <span className="action-err">{a.msg}</span>}
                                        {a.status === "done" && a.msg && <span className="action-ok">{a.msg}</span>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* CarePlan */}
                <div className="careplan-bar">
                    <button
                        className="connect-btn"
                        disabled={carePlan.status === "busy" || carePlan.status === "done"}
                        onClick={handleCarePlan}
                    >
                        {carePlan.status === "busy" ? "Generating CarePlan…"
                            : carePlan.status === "done" ? "✓ CarePlan created"
                            : "Generate GDMT CarePlan"}
                    </button>
                    {carePlan.status === "error" && <span className="action-err">{carePlan.msg}</span>}
                    {carePlan.status === "done" && carePlan.msg && <span className="action-ok">{carePlan.msg}</span>}
                </div>

                <button className="connect-btn secondary" onClick={() => navigate("/")}>
                    ← Disconnect
                </button>
            </div>
        </div>
    );
}
