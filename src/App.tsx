/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import DashboardLayout from "./components/layout/DashboardLayout";

// Route-level code splitting: each page loads on demand instead of shipping one
// ~1.6MB bundle to everyone. A candidate opening /apply no longer downloads the
// entire recruiter dashboard (Kanban, charts, dnd, etc.).
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Vacancies = lazy(() => import("./pages/Vacancies"));
const Apply = lazy(() => import("./pages/Apply"));
const KanbanBoard = lazy(() => import("./pages/KanbanBoard"));
const CandidateProfile = lazy(() => import("./pages/CandidateProfile"));
const WhatsAppSettings = lazy(() => import("./pages/WhatsAppSettings"));
const Stage2Form = lazy(() => import("./pages/Stage2Form"));
const Interviews = lazy(() => import("./pages/Interviews"));
const Ranking = lazy(() => import("./pages/Ranking"));
const CandidateTest = lazy(() => import("./pages/CandidateTest"));
const FormsSettings = lazy(() => import("./pages/FormsSettings"));
const CandidatesList = lazy(() => import("./pages/CandidatesList"));
const Careers = lazy(() => import("./pages/Careers"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600"></div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
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
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
