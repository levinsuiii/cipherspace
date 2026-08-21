import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { generateWorkspaceKey } from "@cipherspace/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import type { EncryptedComment } from "../api/types";
import { CommentSection } from "./CommentSection";
import { decryptApiComment, encryptCommentForApi } from "./crypto";

const mocks = vi.hoisted(() => ({
  getKey: vi.fn<() => Promise<CryptoKey>>(),
  status: "unlocked" as "checking" | "locked" | "missing" | "unlocked"
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-000000000001" } })
}));

vi.mock("../key-management/WorkspaceKeyContext", () => ({
  useWorkspaceKey: () => ({ getKey: mocks.getKey, status: mocks.status })
}));

const workspaceId = "10000000-0000-4000-8000-000000000001";
const noteId = "30000000-0000-4000-8000-000000000001";
let workspaceKey: CryptoKey;

function commentFromInput(
  id: string,
  authorId: string,
  input: Awaited<ReturnType<typeof encryptCommentForApi>>
): EncryptedComment {
  return {
    authorId,
    contentNonce: input.contentNonce,
    createdAt: "2026-08-20T12:00:00.000Z",
    deletedAt: null,
    encryptedContent: input.encryptedContent,
    encryptionMetadata: input.encryptionMetadata,
    id,
    noteId,
    parentCommentId: input.parentCommentId ?? null,
    updatedAt: "2026-08-20T12:00:00.000Z",
    workspaceId
  };
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const section = () => (
    <QueryClientProvider client={queryClient}>
      <CommentSection isServerBacked noteId={noteId} role="editor" workspaceId={workspaceId} />
    </QueryClientProvider>
  );
  const rendered = render(section());
  return { ...rendered, rerenderSection: () => rendered.rerender(section()) };
}

beforeEach(async () => {
  workspaceKey = await generateWorkspaceKey();
  mocks.getKey.mockReset();
  mocks.getKey.mockResolvedValue(workspaceKey);
  mocks.status = "unlocked";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CommentSection", () => {
  it("decrypts listed comments and encrypts new comments before transport", async () => {
    const existingInput = await encryptCommentForApi("Existing encrypted comment", null, workspaceKey);
    const existing = commentFromInput(
      "70000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      existingInput
    );
    vi.spyOn(api.comments, "list").mockResolvedValue({ comments: [existing] });
    vi.spyOn(api.workspaces, "listMembers").mockResolvedValue({
      members: [
        {
          addedAt: "2026-08-20T10:00:00.000Z",
          email: "editor@example.com",
          keyShareStatus: "available",
          role: "editor",
          userId: existing.authorId
        }
      ]
    });
    const create = vi.spyOn(api.comments, "create").mockImplementation(
      async (_workspaceId, _noteId, input) => ({
        comment: commentFromInput(
          "70000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000001",
          input
        )
      })
    );

    renderSection();
    expect(await screen.findByText("Existing encrypted comment")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "New plaintext comment" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const transported = create.mock.calls[0]![2];
    expect(transported.encryptedContent).not.toContain("New plaintext comment");
    expect(
      await decryptApiComment(
        commentFromInput(
          "70000000-0000-4000-8000-000000000003",
          "00000000-0000-4000-8000-000000000001",
          transported
        ),
        workspaceKey
      )
    ).toBe("New plaintext comment");
  });

  it("keeps viewer discussion read-only", async () => {
    vi.spyOn(api.comments, "list").mockResolvedValue({ comments: [] });
    vi.spyOn(api.workspaces, "listMembers").mockResolvedValue({ members: [] });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <CommentSection isServerBacked noteId={noteId} role="viewer" workspaceId={workspaceId} />
      </QueryClientProvider>
    );

    expect(await screen.findByText(/Viewers can read discussion/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
  });

  it("clears a plaintext comment draft immediately when the workspace locks", async () => {
    vi.spyOn(api.comments, "list").mockResolvedValue({ comments: [] });
    vi.spyOn(api.workspaces, "listMembers").mockResolvedValue({ members: [] });
    const rendered = renderSection();
    const draft = await screen.findByLabelText("Comment");
    fireEvent.change(draft, { target: { value: "unique plaintext draft marker" } });
    expect(draft).toHaveValue("unique plaintext draft marker");

    mocks.status = "locked";
    rendered.rerenderSection();

    await waitFor(() => expect(screen.getByLabelText("Comment")).toHaveValue(""));
    expect(screen.queryByDisplayValue("unique plaintext draft marker")).not.toBeInTheDocument();
  });
});
