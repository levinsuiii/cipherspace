import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

import type { EncryptedNoteDetail } from "../api/types";
import type { LocalNote, LocalNoteVersion } from "../local-storage/types";
import { NoteDetailPage } from "./NoteDetailPage";

const mocks = vi.hoisted(() => ({
  cacheServerNoteDetail: vi.fn(async () => undefined),
  decryptLocal: vi.fn(),
  decryptRemote: vi.fn(),
  deleteNote: vi.fn(async () => undefined),
  editEncryptedNote: vi.fn(async () => undefined),
  getKey: vi.fn(async () => ({}) as CryptoKey),
  getServerNote: vi.fn(async () => ({} as EncryptedNoteDetail)),
  note: null as LocalNote | null,
  status: "unlocked" as "checking" | "locked" | "missing" | "unlocked",
  version: undefined as LocalNoteVersion | undefined
}));

vi.mock("../api/client", () => ({
  api: { notes: { get: mocks.getServerNote } }
}));

vi.mock("../comments/CommentSection", () => ({
  CommentSection: () => <div data-testid="comments" />
}));

vi.mock("../key-management/WorkspaceKeyContext", () => ({
  useWorkspaceKey: () => ({ getKey: mocks.getKey, status: mocks.status })
}));

vi.mock("../local-storage/LocalDataContext", () => ({
  useLocalData: () => ({
    cacheServerNoteDetail: mocks.cacheServerNoteDetail,
    countConflictsForNote: () => 0,
    countPendingChangesForNote: () => 0,
    deleteNote: mocks.deleteNote,
    editEncryptedNote: mocks.editEncryptedNote,
    getLatestVersion: () => mocks.version,
    getNote: () => mocks.note
  }),
  useLocalQuery: (query: () => unknown) => ({ data: query(), error: null, isLoading: false })
}));

vi.mock("../sync/crypto", () => ({
  decryptCachedNoteVersion: mocks.decryptRemote
}));

vi.mock("../local-storage/notePayloadCrypto", () => ({
  decryptLocalNotePayload: mocks.decryptLocal
}));

const workspaceId = "10000000-0000-4000-8000-000000000001";
const noteId = "30000000-0000-4000-8000-000000000001";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/workspaces/${workspaceId}/notes/${noteId}`]}>
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
            <Route path="notes/:noteId" element={<NoteDetailPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.cacheServerNoteDetail.mockClear();
  mocks.decryptLocal.mockReset();
  mocks.decryptRemote.mockReset();
  mocks.deleteNote.mockClear();
  mocks.editEncryptedNote.mockClear();
  mocks.getKey.mockClear();
  mocks.getServerNote.mockClear();
  mocks.status = "unlocked";
  mocks.note = {
    base_version_id: "50000000-0000-4000-8000-000000000001",
    created_at: "2026-08-20T10:00:00.000Z",
    created_by: "00000000-0000-4000-8000-000000000001",
    deleted_at: null,
    encrypted_title: null,
    encrypted_title_nonce: null,
    id: noteId,
    key: `user:${noteId}`,
    local_encrypted_payload: null,
    local_note_payload: null,
    local_revision: 0,
    server_updated_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
    user_id: "00000000-0000-4000-8000-000000000001",
    workspace_id: workspaceId
  };
  mocks.version = {
    client_version: "1",
    content_nonce: "AAAAAAAAAAAAAAAA",
    created_at: "2026-08-20T10:00:00.000Z",
    created_by: "00000000-0000-4000-8000-000000000001",
    encrypted_content: "AAAAAAAAAAAAAAAAAAAAAA==",
    encryption_algorithm: "AES-GCM",
    envelope_version: 1,
    id: "50000000-0000-4000-8000-000000000001",
    key: "user:version",
    key_id: "workspace-key-v1",
    note_id: noteId,
    parent_version_id: null,
    user_id: "00000000-0000-4000-8000-000000000001",
    version_number: 1,
    workspace_id: workspaceId
  };
});

afterEach(cleanup);

describe("NoteDetailPage decryption", () => {
  it("decrypts an encrypted local draft in memory before displaying it", async () => {
    mocks.note!.local_encrypted_payload = {
      algorithm: "AES-GCM",
      ciphertext: "local-ciphertext",
      envelopeVersion: 1,
      keyVersion: 1,
      nonce: "local-nonce"
    };
    mocks.version = undefined;
    mocks.decryptLocal.mockResolvedValue({ body: "Local secret body", title: "Local secret" });

    renderPage();

    expect(await screen.findByDisplayValue("Local secret")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Local secret body")).toBeInTheDocument();
    expect(mocks.decryptLocal).toHaveBeenCalledWith(
      mocks.note!.local_encrypted_payload,
      expect.anything(),
      { localRevision: 0, noteId, workspaceId }
    );
    expect(mocks.decryptRemote).not.toHaveBeenCalled();
  });

  it("decrypts a cached server note after unlock and can save it as a local draft", async () => {
    mocks.decryptRemote.mockResolvedValue({
      body: "Readable server body",
      title: "Readable server title"
    });
    renderPage();

    expect(await screen.findByDisplayValue("Readable server title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Readable server body")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Readable server title" })).toBeInTheDocument();
    expect(screen.getByText(/Decrypted in memory/)).toBeInTheDocument();
    expect(mocks.decryptRemote).toHaveBeenCalledWith(mocks.version, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Save local change" }));
    await waitFor(() => expect(mocks.editEncryptedNote).toHaveBeenCalledWith(
      noteId,
      { body: "Readable server body", title: "Readable server title" },
      expect.anything()
    ));
  });

  it("keeps encrypted fields disabled while the workspace is locked", () => {
    mocks.status = "locked";
    mocks.note!.local_note_payload = { body: "must stay hidden", title: "Hidden title" };
    renderPage();

    expect(screen.getByText(/Unlock the workspace key above/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Encrypted note" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Note body")).toBeDisabled();
    expect(screen.getByLabelText("Note body")).toHaveValue("");
    expect(screen.queryByText("Hidden title")).not.toBeInTheDocument();
    expect(mocks.decryptRemote).not.toHaveBeenCalled();
  });

  it("shows a safe error and prevents editing when decryption fails", async () => {
    mocks.decryptRemote.mockRejectedValue(new Error("authentication failed"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("different key");
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save local change" })).not.toBeInTheDocument();
  });
});
