import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuards";
import { AuthenticatedLayout } from "./layouts/AuthenticatedLayout";
import { WorkspaceLayout } from "./layouts/WorkspaceLayout";
import { AuthPage } from "./pages/AuthPage";
import { ConflictResolutionPage } from "./pages/ConflictResolutionPage";
import { NoteDetailPage } from "./pages/NoteDetailPage";
import { NotesPage } from "./pages/NotesPage";
import { WorkspaceOverviewPage } from "./pages/WorkspaceOverviewPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AuthenticatedLayout />}>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/workspaces/:workspaceId" element={<WorkspaceLayout />}>
            <Route index element={<WorkspaceOverviewPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="notes/:noteId/conflict" element={<ConflictResolutionPage />} />
            <Route path="notes/:noteId" element={<NoteDetailPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/workspaces" />} />
    </Routes>
  );
}
