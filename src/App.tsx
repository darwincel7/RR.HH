/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import DashboardLayout from "./components/layout/DashboardLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Vacancies from "./pages/Vacancies";
import Apply from "./pages/Apply";
import KanbanBoard from "./pages/KanbanBoard";
import CandidateProfile from "./pages/CandidateProfile";
import WhatsAppSettings from "./pages/WhatsAppSettings";
import Stage2Form from "./pages/Stage2Form";
import Interviews from "./pages/Interviews";
import Ranking from "./pages/Ranking";
import CandidateTest from "./pages/CandidateTest";
import FormsSettings from "./pages/FormsSettings";
import CandidatesList from "./pages/CandidatesList";
import Careers from "./pages/Careers";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/apply/:vacancyId" element={<Apply />} />
          <Route path="/eval/:applicationId" element={<Stage2Form />} />
          <Route path="/test/:applicationId" element={<CandidateTest />} />
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="vacancies" element={<Vacancies />} />
            <Route
              path="vacancies/:vacancyId/kanban"
              element={<KanbanBoard />}
            />
            <Route path="vacancies/:vacancyId/ranking" element={<Ranking />} />
            <Route path="interviews" element={<Interviews />} />
            <Route
              path="candidates/:candidateId"
              element={<CandidateProfile />}
            />
            <Route path="candidates" element={<CandidatesList />} />
            <Route path="settings" element={<WhatsAppSettings />} />
            <Route path="forms" element={<FormsSettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
