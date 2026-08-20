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
  keyStatus
}: {
  comment: EncryptedComment;
  getKey: () => Promise<CryptoKey>;
  keyStatus: WorkspaceKeyStatus;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    if (comment.deletedAt || keyStatus !== "unlocked") return () => { active = false; };
    void getKey()
      .then((key) => decryptApiComment(comment, key))
      .then((plaintext) => { if (active) setContent(plaintext); })
      .catch(() => { if (active) setError("This comment could not be decrypted."); });
    return () => { active = false; };
  }, [comment, getKey, keyStatus]);

  if (comment.deletedAt) return <p className="comment-placeholder">Comment deleted.</p>;
  if (keyStatus !== "unlocked") {
    return <p className="comment-placeholder">Unlock the workspace key to read this comment.</p>;
  }
  if (error) return <p className="comment-placeholder comment-placeholder--error">{error}</p>;
  if (content === null) return <p className="comment-placeholder">Decrypting comment…</p>;
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
  role: WorkspaceRole;
}

function CommentItem(props: CommentItemProps) {
  const { comment, currentUserId, getKey, keyStatus, memberNames, onDelete, onReply, role } = props;
  const canDelete = !comment.deletedAt &&
    (role === "owner" || (role === "editor" && comment.authorId === currentUserId));
  const canReply = !comment.deletedAt && role !== "viewer";
  const author = comment.authorId === currentUserId
    ? "You"
    : memberNames.get(comment.authorId) ?? shortenOpaqueValue(comment.authorId, "Member");

  return (
    <article className="comment-item">
      <header className="comment-item__header">
        <strong>{author}</strong>
        <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
      </header>
      <DecryptedCommentBody comment={comment} getKey={getKey} keyStatus={keyStatus} />
      {canReply || canDelete ? (
        <div className="comment-item__actions">
          {canReply ? <button onClick={() => onReply(comment)} type="button">Reply</button> : null}
          {canDelete ? (
            <button onClick={() => void onDelete(comment)} type="button">Delete</button>
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

  if (!isServerBacked) {
    return (
      <section className="panel comment-section" aria-labelledby="note-comments-heading">
        <div className="section-heading">
          <div>
            <h2 id="note-comments-heading">Discussion</h2>
            <p>Encrypted comments scoped to this note.</p>
          </div>
          <span className="count-badge">0</span>
        </div>
        <p className="comment-empty">Sync this local note before starting a discussion.</p>
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
      const input = await encryptCommentForApi(content, replyTo?.id ?? null, key);
      const created = await api.comments.create(workspaceId, noteId, input);
      queryClient.setQueryData<{ comments: EncryptedComment[] }>(commentsKey, (current) => ({
        comments: [...(current?.comments ?? []), created.comment]
      }));
      setDraft("");
      setReplyTo(null);
      void queryClient.invalidateQueries({ queryKey: commentsKey });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comment could not be created.");
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
      setError(caught instanceof Error ? caught.message : "The comment could not be deleted.");
    }
  };

  return (
    <section className="panel comment-section" aria-labelledby="note-comments-heading">
      <div className="section-heading">
        <div>
          <h2 id="note-comments-heading">Discussion</h2>
          <p>Encrypted comments scoped to this note.</p>
        </div>
        <span className="count-badge">{commentsQuery.data?.comments.length ?? 0}</span>
      </div>

      {commentsQuery.isLoading ? <p>Loading comments…</p> : null}
      {commentsQuery.isError ? (
        <div className="form-error" role="alert">Comments require an online connection.</div>
      ) : null}
      {!commentsQuery.isLoading && !commentsQuery.isError && thread.length === 0 ? (
        <p className="comment-empty">No comments yet. Start a focused discussion about this note.</p>
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
            onDelete={handleDelete}
            onReply={setReplyTo}
            role={role}
          />
        ))}
      </div>

      {role === "viewer" ? (
        <p className="read-only-message">Viewers can read discussion but cannot add comments.</p>
      ) : (
        <form className="form-stack comment-form" onSubmit={(event) => void handleSubmit(event)}>
          {replyTo ? (
            <div className="comment-replying">
              Replying to {memberNames.get(replyTo.authorId) ?? "a workspace member"}.
              <button onClick={() => setReplyTo(null)} type="button">Cancel</button>
            </div>
          ) : null}
          <label>
            {replyTo ? "Reply" : "Comment"}
            <textarea
              disabled={isSubmitting || keyStatus !== "unlocked"}
              maxLength={16_000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={keyStatus === "unlocked" ? "Add context or ask a question…" : "Unlock the workspace key to comment."}
              rows={4}
              value={draft}
            />
          </label>
          {keyStatus !== "unlocked" ? (
            <p className="comment-key-message">Comments can be read or created after this workspace is unlocked.</p>
          ) : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button
            className="button button--primary"
            disabled={isSubmitting || keyStatus !== "unlocked" || !draft.trim()}
          >
            {isSubmitting ? "Encrypting and posting…" : replyTo ? "Post reply" : "Add comment"}
          </button>
        </form>
      )}
    </section>
  );
}
