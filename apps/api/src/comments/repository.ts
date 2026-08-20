import type { Database } from "../database/database.js";

export interface StoredComment {
  authorUserId: string;
  contentKeyId: string | null;
  contentNonce: Buffer | null;
  createdAt: Date;
  deletedAt: Date | null;
  encryptedContent: Buffer | null;
  encryptionAlgorithm: string | null;
  envelopeVersion: number | null;
  id: string;
  noteId: string;
  parentCommentId: string | null;
  updatedAt: Date;
  workspaceId: string;
}

export interface CreateStoredCommentInput {
  authorUserId: string;
  contentKeyId: string;
  contentNonce: Buffer;
  encryptedContent: Buffer;
  encryptionAlgorithm: string;
  envelopeVersion: number;
  id: string;
  noteId: string;
  parentCommentId: string | null;
  workspaceId: string;
}

export interface CommentRepository {
  createComment(input: CreateStoredCommentInput): Promise<StoredComment | null>;
  findActiveNote(workspaceId: string, noteId: string): Promise<boolean>;
  findComment(workspaceId: string, noteId: string, commentId: string): Promise<StoredComment | null>;
  listComments(workspaceId: string, noteId: string, userId: string): Promise<StoredComment[]>;
  softDeleteComment(
    workspaceId: string,
    noteId: string,
    commentId: string,
    userId: string
  ): Promise<boolean>;
}

interface CommentRow {
  author_user_id: string;
  content_key_id: string | null;
  content_nonce: Buffer | null;
  created_at: Date;
  deleted_at: Date | null;
  encrypted_content: Buffer | null;
  encryption_algorithm: string | null;
  envelope_version: number | null;
  id: string;
  note_id: string;
  parent_comment_id: string | null;
  updated_at: Date;
  workspace_id: string;
}

const commentColumns = `id, workspace_id, note_id, author_user_id, parent_comment_id,
  encrypted_content, content_nonce, envelope_version, encryption_algorithm, content_key_id,
  deleted_at, created_at, updated_at`;
const qualifiedCommentColumns = `encrypted_comments.id, encrypted_comments.workspace_id,
  encrypted_comments.note_id, encrypted_comments.author_user_id,
  encrypted_comments.parent_comment_id, encrypted_comments.encrypted_content,
  encrypted_comments.content_nonce, encrypted_comments.envelope_version,
  encrypted_comments.encryption_algorithm, encrypted_comments.content_key_id,
  encrypted_comments.deleted_at, encrypted_comments.created_at, encrypted_comments.updated_at`;

function mapComment(row: CommentRow): StoredComment {
  return {
    authorUserId: row.author_user_id,
    contentKeyId: row.content_key_id,
    contentNonce: row.content_nonce,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    encryptedContent: row.encrypted_content,
    encryptionAlgorithm: row.encryption_algorithm,
    envelopeVersion: row.envelope_version,
    id: row.id,
    noteId: row.note_id,
    parentCommentId: row.parent_comment_id,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id
  };
}

export class PostgresCommentRepository implements CommentRepository {
  public constructor(private readonly database: Database) {}

  public async createComment(input: CreateStoredCommentInput): Promise<StoredComment | null> {
    const result = await this.database.query<CommentRow>(
      `INSERT INTO encrypted_comments (
         id, workspace_id, note_id, author_user_id, parent_comment_id, encrypted_content,
         content_nonce, envelope_version, encryption_algorithm, content_key_id
       )
       SELECT $1, encrypted_notes.workspace_id, encrypted_notes.id, $4, $5, $6, $7, $8, $9, $10
       FROM encrypted_notes
       JOIN workspace_members
         ON workspace_members.workspace_id = encrypted_notes.workspace_id
        AND workspace_members.user_id = $4
        AND workspace_members.role IN ('owner', 'editor')
       WHERE encrypted_notes.workspace_id = $2
         AND encrypted_notes.id = $3
         AND encrypted_notes.deleted_at IS NULL
         AND (
           $5::uuid IS NULL
           OR EXISTS (
             SELECT 1 FROM encrypted_comments parent
             WHERE parent.id = $5 AND parent.note_id = encrypted_notes.id
           )
         )
       RETURNING ${commentColumns}`,
      [
        input.id,
        input.workspaceId,
        input.noteId,
        input.authorUserId,
        input.parentCommentId,
        input.encryptedContent,
        input.contentNonce,
        input.envelopeVersion,
        input.encryptionAlgorithm,
        input.contentKeyId
      ]
    );
    const comment = result.rows[0];
    return comment ? mapComment(comment) : null;
  }

  public async findActiveNote(workspaceId: string, noteId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1
       FROM encrypted_notes
       WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [workspaceId, noteId]
    );
    return result.rowCount === 1;
  }

  public async findComment(
    workspaceId: string,
    noteId: string,
    commentId: string
  ): Promise<StoredComment | null> {
    const result = await this.database.query<CommentRow>(
      `SELECT ${commentColumns}
       FROM encrypted_comments
       WHERE workspace_id = $1 AND note_id = $2 AND id = $3
       LIMIT 1`,
      [workspaceId, noteId, commentId]
    );
    const comment = result.rows[0];
    return comment ? mapComment(comment) : null;
  }

  public async listComments(
    workspaceId: string,
    noteId: string,
    userId: string
  ): Promise<StoredComment[]> {
    const result = await this.database.query<CommentRow>(
      `SELECT ${qualifiedCommentColumns}
       FROM encrypted_comments
       JOIN encrypted_notes ON encrypted_notes.id = encrypted_comments.note_id
       JOIN workspace_members
         ON workspace_members.workspace_id = encrypted_comments.workspace_id
        AND workspace_members.user_id = $3
       WHERE encrypted_comments.workspace_id = $1
         AND encrypted_comments.note_id = $2
         AND encrypted_notes.deleted_at IS NULL
       ORDER BY encrypted_comments.created_at ASC, encrypted_comments.id ASC`,
      [workspaceId, noteId, userId]
    );
    return result.rows.map(mapComment);
  }

  public async softDeleteComment(
    workspaceId: string,
    noteId: string,
    commentId: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE encrypted_comments
       SET encrypted_content = NULL,
           content_nonce = NULL,
           envelope_version = NULL,
           encryption_algorithm = NULL,
           content_key_id = NULL,
           deleted_at = now(),
           updated_at = now()
       WHERE workspace_id = $1 AND note_id = $2 AND id = $3 AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM workspace_members
           WHERE workspace_id = $1 AND user_id = $4
             AND (
               role = 'owner'
               OR (role = 'editor' AND encrypted_comments.author_user_id = $4)
             )
         )`,
      [workspaceId, noteId, commentId, userId]
    );
    return result.rowCount === 1;
  }
}
