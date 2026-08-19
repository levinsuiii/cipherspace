import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";

import { api } from "../api/client";
import type { CreateNoteInput } from "../api/types";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import type { WorkspaceOutletContext } from "../layouts/WorkspaceLayout";
import { queryKeys } from "../queryKeys";
import { formatDate, shortenOpaqueValue } from "../utils";

const initialForm = {
  algorithm: "AES-GCM",
  clientVersion: "",
  contentNonce: "BwgJCgsMDQ4PEBES",
  encryptedContent: "2RhjKslREPA=",
  encryptedTitle: "",
  encryptedTitleNonce: "",
  envelopeVersion: "1",
  keyId: "workspace-key-dev"
};

export function NotesPage() {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const canCreate = workspace.role !== "viewer";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const notesQuery = useQuery({
    queryKey: queryKeys.notes(workspace.id),
    queryFn: () => api.notes.list(workspace.id)
  });
  const createMutation = useMutation({
    mutationFn: (input: CreateNoteInput) => api.notes.create(workspace.id, input),
    onSuccess: async ({ note }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes(workspace.id) });
      navigate(`/workspaces/${workspace.id}/notes/${note.id}`);
    }
  });

  const updateField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const hasTitle = Boolean(form.encryptedTitle.trim());
    const hasTitleNonce = Boolean(form.encryptedTitleNonce.trim());
    if (hasTitle !== hasTitleNonce) {
      setFormError("Encrypted title and title nonce must be supplied together.");
      return;
    }

    const input: CreateNoteInput = {
      contentNonce: form.contentNonce.trim(),
      encryptedContent: form.encryptedContent.trim(),
      encryptionMetadata: {
        algorithm: form.algorithm.trim(),
        envelopeVersion: Number(form.envelopeVersion),
        keyId: form.keyId.trim()
      }
    };
    if (form.clientVersion.trim()) input.clientVersion = form.clientVersion.trim();
    if (hasTitle) {
      input.encryptedTitle = form.encryptedTitle.trim();
      input.encryptedTitleNonce = form.encryptedTitleNonce.trim();
    }
    createMutation.mutate(input);
  };

  return (
    <div className="notes-layout">
      <section>
        <div className="section-heading section-heading--page">
          <div>
            <p className="eyebrow">Opaque server records</p>
            <h2>Notes</h2>
          </div>
          <span className="count-badge">{notesQuery.data?.notes.length ?? "—"}</span>
        </div>
        {notesQuery.isLoading ? <LoadingState label="Loading notes…" /> : null}
        {notesQuery.isError ? (
          <ErrorState error={notesQuery.error} onRetry={() => void notesQuery.refetch()} />
        ) : null}
        {notesQuery.data?.notes.length === 0 ? (
          <EmptyState
            description={canCreate ? "Use the development form to create the first opaque note record." : "No notes have been created in this workspace."}
            title="No notes yet"
          />
        ) : null}
        {notesQuery.data?.notes.length ? (
          <div className="note-list">
            {notesQuery.data.notes.map((note, index) => (
              <Link key={note.id} to={note.id}>
                <div className="note-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <h3>{shortenOpaqueValue(note.encryptedTitle, "Untitled encrypted note")}</h3>
                  <p>Updated {formatDate(note.updatedAt)}</p>
                </div>
                <span className="mono note-id">{note.id.slice(0, 8)}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <aside className="panel panel--sticky">
        {canCreate ? (
          <>
            <p className="eyebrow">Development input</p>
            <h2>Create opaque note</h2>
            <div className="warning-callout">
              No encryption happens here. Values are sent as opaque base64 placeholders and must
              not contain sensitive plaintext.
            </div>
            <form className="form-stack compact-form" onSubmit={handleCreate}>
              <label>
                Encrypted content (base64)
                <textarea required rows={3} value={form.encryptedContent} onChange={(event) => updateField("encryptedContent", event.target.value)} />
              </label>
              <label>
                Content nonce (base64)
                <input required value={form.contentNonce} onChange={(event) => updateField("contentNonce", event.target.value)} />
              </label>
              <div className="form-grid">
                <label>
                  Algorithm
                  <input maxLength={100} required value={form.algorithm} onChange={(event) => updateField("algorithm", event.target.value)} />
                </label>
                <label>
                  Envelope version
                  <input max={32767} min={1} required type="number" value={form.envelopeVersion} onChange={(event) => updateField("envelopeVersion", event.target.value)} />
                </label>
              </div>
              <label>
                Key ID
                <input maxLength={255} required value={form.keyId} onChange={(event) => updateField("keyId", event.target.value)} />
              </label>
              <details>
                <summary>Optional metadata and title envelope</summary>
                <div className="form-stack details-content">
                  <label>
                    Client version
                    <input maxLength={255} value={form.clientVersion} onChange={(event) => updateField("clientVersion", event.target.value)} />
                  </label>
                  <label>
                    Encrypted title (base64)
                    <input value={form.encryptedTitle} onChange={(event) => updateField("encryptedTitle", event.target.value)} />
                  </label>
                  <label>
                    Title nonce (base64)
                    <input value={form.encryptedTitleNonce} onChange={(event) => updateField("encryptedTitleNonce", event.target.value)} />
                  </label>
                </div>
              </details>
              {formError || createMutation.error ? (
                <div className="form-error" role="alert">{formError ?? createMutation.error?.message}</div>
              ) : null}
              <button className="button button--primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create note record"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="eyebrow">Read-only access</p>
            <h2>Viewer role</h2>
            <p>You can inspect note envelopes, but only owners and editors can create notes.</p>
          </>
        )}
      </aside>
    </div>
  );
}
