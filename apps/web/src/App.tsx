import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuards";
import { AuthenticatedLayout } from "./layouts/AuthenticatedLayout";
import { WorkspaceLayout } from "./layouts/WorkspaceLayout";
import { AuthPage } from "./pages/AuthPage";
import { AccountRecoveryPage } from "./pages/AccountRecoveryPage";
import { ConflictResolutionPage } from "./pages/ConflictResolutionPage";
import { NoteDetailPage } from "./pages/NoteDetailPage";
import { NotesPage } from "./pages/NotesPage";
import { LandingPage } from "./pages/LandingPage";
import { HelpPage } from "./pages/HelpPage";
import { WorkspaceOverviewPage } from "./pages/WorkspaceOverviewPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { ImprintPage } from "./pages/ImprintPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/hilfe" element={<HelpPage />} />
      <Route path="/imprint" element={<ImprintPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AuthenticatedLayout />}>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/account/security/recovery" element={<AccountRecoveryPage />} />
          <Route path="/workspaces/:workspaceId" element={<WorkspaceLayout />}>
            <Route index element={<WorkspaceOverviewPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="notes/:noteId/conflict" element={<ConflictResolutionPage />} />
            <Route path="notes/:noteId" element={<NoteDetailPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
