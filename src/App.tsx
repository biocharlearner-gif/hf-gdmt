import { Routes, Route, Navigate } from "react-router-dom";
import Launch from "./pages/Launch";
import EhrLaunch from "./pages/EhrLaunch";
import Callback from "./pages/Callback";
import PatientSelect from "./pages/PatientSelect";
import PatientView from "./pages/PatientView";
import AppLayout from "./layout/AppLayout";
import PatientListPage from "./patients/PatientListPage";
import PatientViewPage from "./patients/PatientViewPage";
import DemographicsPage from "./patients/DemographicsPage";
import ClinicalTab from "./patients/ClinicalTab";
import GdmtTab from "./patients/GdmtTab";
import VitalsTab from "./patients/VitalsTab";
import PatientTasksPage from "./patients/PatientTasksPage";
import TasksPage from "./patients/TasksPage";

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Launch />} />
            <Route path="/launch" element={<EhrLaunch />} />
            <Route path="/callback" element={<Callback />} />
            <Route path="/select" element={<PatientSelect />} />
            <Route path="/patient" element={<PatientView />} />
            <Route element={<AppLayout />}>
                <Route path="/patients" element={<PatientListPage />} />
                <Route path="/patients/:id" element={<PatientViewPage />}>
                    <Route index element={<Navigate to="demographics" replace />} />
                    <Route path="demographics" element={<DemographicsPage />} />
                    <Route path="clinical" element={<ClinicalTab />} />
                    <Route path="gdmt" element={<GdmtTab />} />
                    <Route path="vitals" element={<VitalsTab />} />
                    <Route path="tasks" element={<PatientTasksPage />} />
                </Route>
                <Route path="/tasks" element={<TasksPage />} />
            </Route>
        </Routes>
    );
}