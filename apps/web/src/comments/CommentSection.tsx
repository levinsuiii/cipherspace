import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { EncryptedComment, WorkspaceRole } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useWorkspaceKey, type WorkspaceKeyStatus } from "../key-management/WorkspaceKeyContext";
import { queryKeys } from "../queryKeys";
import { formatDate, shortenOpaqueValue } from "../utils";
import { decryptApiComment, encryptCommentForApi } from "./crypto";

interface CommentNode extends EncryptedComment {
  replies: CommentNode[];
}

function buildThread(comments: EncryptedComment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>(
    comments.map((comment) => [comment.id, { ...comment, replies: [] }])
  );
  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id)!;
    const parent = comment.parentCommentId ? nodes.get(comment.parentCommentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

function DecryptedCommentBody({
  comment,
  getKey,
  keyStatus,
  noteId,
  workspaceId
}: {
  comment: EncryptedComment;
  getKey: () => Promise<CryptoKey>;
  keyStatus: WorkspaceKeyStatus;
  noteId: string;
  workspaceId: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    if (comment.deletedAt || keyStatus !== "unlocked") return () => { active = false; };
    void getKey()
      .then((key) => decryptApiComment(comment, key, { noteId, workspaceId }))
      .then((plaintext) => { if (active) setContent(plaintext); })
      .catch(() => { if (active) setError("Der Kommentar konnte nicht entschlüsselt werden."); });
    return () => { active = false; };
  }, [comment, getKey, keyStatus, noteId, workspaceId]);

  if (comment.deletedAt) return <p className="comment-placeholder">Kommentar gelöscht.</p>;
  if (keyStatus !== "unlocked") {
    return <p className="comment-placeholder">Entsperre den Workspace-Schlüssel, um den Kommentar zu lesen.</p>;
  }
  if (error) return <p className="comment-placeholder comment-placeholder--error">{error}</p>;
  if (content === null) return <p className="comment-placeholder">Kommentar wird entschlüsselt…</p>;
  return <p className="comment-content">{content}</p>;
}

interface CommentItemProps {
  comment: CommentNode;
  currentUserId: string;
  getKey: () => Promise<CryptoKey>;
  keyStatus: WorkspaceKeyStatus;
  memberNames: ReadonlyMap<string, string>;
  onDelete: (comment: EncryptedComment) => Promise<void>;
  onReply: (comment: EncryptedComment) => void;
  noteId: string;
  role: WorkspaceRole;
  workspaceId: string;
}

function CommentItem(props: CommentItemProps) {
  const {
    comment,
    currentUserId,
    getKey,
    keyStatus,
    memberNames,
    noteId,
    onDelete,
    onReply,
    role,
    workspaceId
  } = props;
  const canDelete = !comment.deletedAt &&
    (role === "owner" || (role === "editor" && comment.authorId === currentUserId));
  const canReply = !comment.deletedAt && role !== "viewer";
  const author = comment.authorId === currentUserId
    ? "Du"
    : memberNames.get(comment.authorId) ?? shortenOpaqueValue(comment.authorId, "Mitglied");

  return (
    <article className="comment-item">
      <header className="comment-item__header">
        <strong>{author}</strong>
        <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
      </header>
      <DecryptedCommentBody
        comment={comment}
        getKey={getKey}
        keyStatus={keyStatus}
        noteId={noteId}
        workspaceId={workspaceId}
      />
      {canReply || canDelete ? (
        <div className="comment-item__actions">
          {canReply ? <button onClick={() => onReply(comment)} type="button">Antworten</button> : null}
          {canDelete ? (
            <button onClick={() => void onDelete(comment)} type="button">Löschen</button>
          ) : null}
        </div>
      ) : null}
      {comment.replies.length > 0 ? (
        <div className="comment-replies">
          {comment.replies.map((reply) => <CommentItem key={reply.id} {...props} comment={reply} />)}
        </div>
      ) : null}
    </article>
  );
}

export function CommentSection({
  isServerBacked,
  noteId,
  role,
  workspaceId
}: {
  isServerBacked: boolean;
  noteId: string;
  role: WorkspaceRole;
  workspaceId: string;
}) {
  const { user } = useAuth();
  const { getKey, status: keyStatus } = useWorkspaceKey(workspaceId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<EncryptedComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const commentsKey = queryKeys.comments(workspaceId, noteId);
  const commentsQuery = useQuery({
    enabled: isServerBacked,
    queryKey: commentsKey,
    queryFn: () => api.comments.list(workspaceId, noteId),
    retry: false
  });
  const membersQuery = useQuery({
    enabled: isServerBacked,
    queryKey: queryKeys.members(workspaceId),
    queryFn: () => api.workspaces.listMembers(workspaceId),
    retry: false
  });
  const memberNames = useMemo(
    () => new Map((membersQuery.data?.members ?? []).map((member) => [member.userId, member.email])),
    [membersQuery.data]
  );
  const thread = useMemo(() => buildThread(commentsQuery.data?.comments ?? []), [commentsQuery.data]);

  useEffect(() => {
    if (keyStatus === "unlocked") return;
    setDraft("");
    setReplyTo(null);
    setError(null);
  }, [keyStatus]);

  if (!isServerBacked) {
    return (
      <section className="panel comment-section" aria-labelledby="note-comments-heading">
        <div className="section-heading">
          <div>
            <h2 id="note-comments-heading">Diskussion</h2>
            <p>Verschlüsselte Kommentare zu dieser Notiz.</p>
          </div>
          <span className="count-badge">0</span>
        </div>
        <p className="comment-empty">Synchronisiere die lokale Notiz, bevor du einen Kommentar schreibst.</p>
      </section>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || role === "viewer") return;
    setError(null);
    setIsSubmitting(true);
    try {
      const key = await getKey();
      if (!user) throw new Error("Melde dich erneut an, bevor du einen Kommentar erstellst.");
      const input = await encryptCommentForApi(content, {
        authorId: user.id,
        commentId: crypto.randomUUID(),
        noteId,
        parentCommentId: replyTo?.id ?? null,
        workspaceId
      }, key);
      const created = await api.comments.create(workspaceId, noteId, input);
      queryClient.setQueryData<{ comments: EncryptedComment[] }>(commentsKey, (current) => ({
        comments: [...(current?.comments ?? []), created.comment]
      }));
      setDraft("");
      setReplyTo(null);
      void queryClient.invalidateQueries({ queryKey: commentsKey });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der Kommentar konnte nicht erstellt werden.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (comment: EncryptedComment) => {
    setError(null);
    try {
      await api.comments.delete(workspaceId, noteId, comment.id);
      const deletedAt = new Date().toISOString();
      queryClient.setQueryData<{ comments: EncryptedComment[] }>(commentsKey, (current) => ({
        comments: (current?.comments ?? []).map((item) => item.id === comment.id
          ? {
              ...item,
              contentNonce: null,
              deletedAt,
              encryptedContent: null,
              encryptionMetadata: null,
              updatedAt: deletedAt
            }
          : item)
      }));
      void queryClient.invalidateQueries({ queryKey: commentsKey });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der Kommentar konnte nicht gelöscht werden.");
    }
  };

  return (
    <section className="panel comment-section" aria-labelledby="note-comments-heading">
      <div className="section-heading">
        <div>
          <h2 id="note-comments-heading">Diskussion</h2>
          <p>Verschlüsselte Kommentare zu dieser Notiz.</p>
        </div>
        <span className="count-badge">{commentsQuery.data?.comments.length ?? 0}</span>
      </div>

      {commentsQuery.isLoading ? <p>Kommentare werden geladen…</p> : null}
      {commentsQuery.isError ? (
        <div className="form-error" role="alert">Kommentare benötigen eine Onlineverbindung.</div>
      ) : null}
      {!commentsQuery.isLoading && !commentsQuery.isError && thread.length === 0 ? (
        <p className="comment-empty">Noch keine Kommentare.</p>
      ) : null}
      <div className="comment-thread">
        {thread.map((comment) => (
          <CommentItem
            comment={comment}
            currentUserId={user?.id ?? ""}
            getKey={getKey}
            key={comment.id}
            keyStatus={keyStatus}
            memberNames={memberNames}
            noteId={noteId}
            onDelete={handleDelete}
            onReply={setReplyTo}
            role={role}
            workspaceId={workspaceId}
          />
        ))}
      </div>

      {role === "viewer" ? (
        <p className="read-only-message">Leser können Kommentare lesen, aber keine hinzufügen.</p>
      ) : (
        <form className="form-stack comment-form" onSubmit={(event) => void handleSubmit(event)}>
          {replyTo ? (
            <div className="comment-replying">
              Antwort an {memberNames.get(replyTo.authorId) ?? "ein Workspace-Mitglied"}.
              <button onClick={() => setReplyTo(null)} type="button">Abbrechen</button>
            </div>
          ) : null}
          <label>
            {replyTo ? "Antwort" : "Kommentar"}
            <textarea
              disabled={isSubmitting || keyStatus !== "unlocked"}
              maxLength={16_000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={keyStatus === "unlocked" ? "Hinweis ergänzen oder Frage stellen…" : "Zum Kommentieren den Workspace entsperren."}
              rows={4}
              value={draft}
            />
          </label>
          {keyStatus !== "unlocked" ? (
            <p className="comment-key-message">Kommentare sind nach dem Entsperren des Workspace verfügbar.</p>
          ) : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button
            className="button button--primary"
            disabled={isSubmitting || keyStatus !== "unlocked" || !draft.trim()}
          >
            {isSubmitting ? "Wird verschlüsselt und gesendet…" : replyTo ? "Antwort senden" : "Kommentar hinzufügen"}
          </button>
        </form>
      )}
    </section>
  );
}
