import type {
  CreateCommentInput,
  CreateNoteInput,
  Credentials,
  EncryptedComment,
  EncryptedNote,
  EncryptedNoteDetail,
  EncryptedWorkspaceKeyInput,
  InviteePublicKey,
  SyncPullResponse,
  SyncPushChange,
  SyncPushResponse,
  User,
  UserCryptoIdentity,
  Workspace,
  WorkspaceKeyAccess,
  WorkspaceKeyShare,
  WorkspaceMember
} from "./types";

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeApiBaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    return "";
  }

  const normalized = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("VITE_API_BASE_URL must be an absolute HTTP(S) origin");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== normalized ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("VITE_API_BASE_URL must be an absolute HTTP(S) origin without a path");
  }

  return normalized;
}

const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const apiPathPrefix = "/api";

export function buildApiUrl(apiOrigin: string, path: string): string {
  if (!path.startsWith("/") || path === apiPathPrefix || path.startsWith(`${apiPathPrefix}/`)) {
    throw new Error("API client paths must start with / and omit the /api prefix");
  }

  return `${apiOrigin}${apiPathPrefix}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildApiUrl(apiBaseUrl, path), {
    ...init,
    credentials: "include",
    headers
  });

  if (!response.ok) {
    let payload: ApiErrorPayload | undefined;
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // A proxy or network layer may return a non-JSON error page.
    }

    throw new ApiError(
      payload?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      payload?.error?.code ?? "request_failed"
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function workspacePath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}

export const api = {
  auth: {
    login: (credentials: Credentials) =>
      request<{ user: User }>("/auth/login", {
        body: JSON.stringify(credentials),
        method: "POST"
      }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    me: () => request<{ user: User }>("/auth/me"),
    register: (credentials: Credentials) =>
      request<{ user: User }>("/auth/register", {
        body: JSON.stringify(credentials),
        method: "POST"
      })
  },
  cryptoIdentity: {
    get: () => request<{ identity: UserCryptoIdentity }>("/crypto/identity"),
    register: (identity: Pick<UserCryptoIdentity, "algorithm" | "keyVersion" | "publicKey">) =>
      request<{ identity: UserCryptoIdentity }>("/crypto/identity", {
        body: JSON.stringify(identity),
        method: "PUT"
      })
  },
  comments: {
    create: (workspaceId: string, noteId: string, input: CreateCommentInput) =>
      request<{ comment: EncryptedComment }>(
        `${workspacePath(workspaceId)}/notes/${encodeURIComponent(noteId)}/comments`,
        { body: JSON.stringify(input), method: "POST" }
      ),
    delete: (workspaceId: string, noteId: string, commentId: string) =>
      request<void>(
        `${workspacePath(workspaceId)}/notes/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(commentId)}`,
        { method: "DELETE" }
      ),
    list: (workspaceId: string, noteId: string) =>
      request<{ comments: EncryptedComment[] }>(
        `${workspacePath(workspaceId)}/notes/${encodeURIComponent(noteId)}/comments`
      )
  },
  workspaces: {
    addMember: (
      workspaceId: string,
      input: { email: string; keyShare: EncryptedWorkspaceKeyInput; role: WorkspaceMember["role"] }
    ) =>
      request<{ member: WorkspaceMember }>(`${workspacePath(workspaceId)}/members`, {
        body: JSON.stringify(input),
        method: "POST"
      }),
    create: (name: string) =>
      request<{ workspace: Workspace }>("/workspaces", {
        body: JSON.stringify({ name }),
        method: "POST"
      }),
    get: (workspaceId: string) =>
      request<{ workspace: Workspace }>(workspacePath(workspaceId)),
    getInviteeKey: (workspaceId: string, reference: { email: string } | { userId: string }) => {
      const query = "email" in reference
        ? `email=${encodeURIComponent(reference.email)}`
        : `userId=${encodeURIComponent(reference.userId)}`;
      return request<{ invitee: InviteePublicKey }>(
        `${workspacePath(workspaceId)}/invitee-key?${query}`
      );
    },
    getKeyAccess: (workspaceId: string) =>
      request<{ keyAccess: WorkspaceKeyAccess }>(`${workspacePath(workspaceId)}/key-access`),
    getOwnKeyShare: (workspaceId: string) =>
      request<{ keyShare: WorkspaceKeyShare }>(`${workspacePath(workspaceId)}/key-share`),
    list: () => request<{ workspaces: Workspace[] }>("/workspaces"),
    listMembers: (workspaceId: string) =>
      request<{ members: WorkspaceMember[] }>(`${workspacePath(workspaceId)}/members`),
    putKeyShare: (workspaceId: string, userId: string, input: EncryptedWorkspaceKeyInput) =>
      request<{ keyShare: WorkspaceKeyShare }>(
        `${workspacePath(workspaceId)}/key-shares/${encodeURIComponent(userId)}`,
        { body: JSON.stringify(input), method: "PUT" }
      )
  },
  notes: {
    create: (workspaceId: string, input: CreateNoteInput) =>
      request<EncryptedNoteDetail>(`${workspacePath(workspaceId)}/notes`, {
        body: JSON.stringify(input),
        method: "POST"
      }),
    get: (workspaceId: string, noteId: string) =>
      request<EncryptedNoteDetail>(
        `${workspacePath(workspaceId)}/notes/${encodeURIComponent(noteId)}`
      ),
    list: (workspaceId: string) =>
      request<{ notes: EncryptedNote[] }>(`${workspacePath(workspaceId)}/notes`)
  },
  sync: {
    pull: (workspaceId: string, cursor: string | null) => {
      const query = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      return request<SyncPullResponse>(`${workspacePath(workspaceId)}/sync/pull${query}`);
    },
    push: (workspaceId: string, clientId: string, changes: SyncPushChange[]) =>
      request<SyncPushResponse>(`${workspacePath(workspaceId)}/sync/push`, {
        body: JSON.stringify({ changes, clientId }),
        method: "POST"
      })
  }
};
