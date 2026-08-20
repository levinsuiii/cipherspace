import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

import type { LocalConflict } from "../local-storage/types";
import { ConflictResolutionPage } from "./ConflictResolutionPage";

const mocks = vi.hoisted(() => ({
  conflict: null as LocalConflict | null,
  decryptRemote: vi.fn(async () => ({ body: "Remote body", title: "Remote title" })),
  getKey: vi.fn(async () => ({}) as CryptoKey),
  resolveConflict: vi.fn(async () => ({}))
}));

vi.mock("../local-storage/LocalDataContext", () => ({
  useLocalData: () => ({
    getUnresolvedConflictForNote: vi.fn(),
    resolveConflict: mocks.resolveConflict
  }),
  useLocalQuery: () => ({ data: mocks.conflict, error: null, isLoading: false })
}));

vi.mock("../key-management/WorkspaceKeyContext", () => ({
  useWorkspaceKey: () => ({ getKey: mocks.getKey, status: "unlocked" })
}));

vi.mock("../sync/crypto", () => ({
  decryptCachedNoteVersion: mocks.decryptRemote
}));

const workspaceId = "10000000-0000-4000-8000-000000000001";
const noteId = "30000000-0000-4000-8000-000000000001";

function localVersion(id: string, versionNumber: number) {
  return {
    client_version: String(versionNumber),
    content_nonce: "AAAAAAAAAAAAAAAA",
    created_at: `2026-08-20T10:0${versionNumber}:00.000Z`,
    created_by: "00000000-0000-4000-8000-000000000001",
    encrypted_content: "AAAAAAAAAAAAAAAAAAAAAA==",
    encryption_algorithm: "AES-GCM",
    envelope_version: 1,
    id,
    key: `user:${id}`,
    key_id: "workspace-key-v1",
    note_id: noteId,
    parent_version_id: versionNumber === 1 ? null : "50000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000001",
    version_number: versionNumber,
    workspace_id: workspaceId
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/notes/${noteId}/conflict`]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId"
          element={
            <Outlet context={{
              workspace: {
                createdAt: "2026-08-20T10:00:00.000Z",
                id: workspaceId,
                name: "Test workspace",
                role: "owner",
                updatedAt: "2026-08-20T10:00:00.000Z"
              }
            }} />
          }
        >
          <Route path="notes/:noteId/conflict" element={<ConflictResolutionPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("ConflictResolutionPage", () => {
  beforeEach(() => {
    mocks.resolveConflict.mockClear();
    mocks.conflict = {
      base_version: localVersion("50000000-0000-4000-8000-000000000001", 1),
      base_version_id: "50000000-0000-4000-8000-000000000001",
      detected_at: "2026-08-20T10:03:00.000Z",
      id: "conflict-id",
      key: "user:conflict-id",
      local_encrypted_payload: null,
      local_note_payload: { body: "Local body", title: "Local title" },
      local_revision: 2,
      note_id: noteId,
      pending_change_id: "40000000-0000-4000-8000-000000000001",
      remote_version: localVersion("50000000-0000-4000-8000-000000000002", 2),
      resolution: null,
      resolution_pending_change_id: null,
      resolved_at: null,
      resolved_note_payload: null,
      status: "unresolved",
      user_id: "00000000-0000-4000-8000-000000000001",
      workspace_id: workspaceId
    };
  });

  afterEach(cleanup);

  it("shows both versions and invokes keep-local and accept-remote actions", async () => {
    const first = renderPage();
    expect(screen.getByText("Local title")).toBeInTheDocument();
    expect(await screen.findByText("Remote title")).toBeInTheDocument();
    expect(screen.getByText("Base version")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep local" }));
    await waitFor(() =>
      expect(mocks.resolveConflict).toHaveBeenCalledWith("conflict-id", {
        action: "keep_local"
      })
    );
    first.unmount();

    mocks.resolveConflict.mockClear();
    renderPage();
    await screen.findByText("Remote title");
    fireEvent.click(screen.getByRole("button", { name: "Accept remote" }));
    await waitFor(() =>
      expect(mocks.resolveConflict).toHaveBeenCalledWith("conflict-id", {
        action: "accept_remote",
        remote_payload: { body: "Remote body", title: "Remote title" }
      })
    );
  });

  it("submits user-edited manual merge content", async () => {
    renderPage();
    await screen.findByText("Remote title");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Merged title" } });
    fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Merged body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual merge" }));

    await waitFor(() =>
      expect(mocks.resolveConflict).toHaveBeenCalledWith("conflict-id", {
        action: "manual_merge",
        merged_payload: { body: "Merged body", title: "Merged title" }
      })
    );
  });
});
