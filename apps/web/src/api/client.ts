import type {
  CreateNoteInput,
  Credentials,
  EncryptedNote,
  EncryptedNoteDetail,
  User,
  Workspace,
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

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
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
  return `/api/workspaces/${encodeURIComponent(workspaceId)}`;
}

export const api = {
  auth: {
    login: (credentials: Credentials) =>
      request<{ user: User }>("/api/auth/login", {
        body: JSON.stringify(credentials),
        method: "POST"
      }),
    logout: () => request<void>("/api/auth/logout", { method: "POST" }),
    me: () => request<{ user: User }>("/api/auth/me"),
    register: (credentials: Credentials) =>
      request<{ user: User }>("/api/auth/register", {
        body: JSON.stringify(credentials),
        method: "POST"
      })
  },
  workspaces: {
    create: (name: string) =>
      request<{ workspace: Workspace }>("/api/workspaces", {
        body: JSON.stringify({ name }),
        method: "POST"
      }),
    get: (workspaceId: string) =>
      request<{ workspace: Workspace }>(workspacePath(workspaceId)),
    list: () => request<{ workspaces: Workspace[] }>("/api/workspaces"),
    listMembers: (workspaceId: string) =>
      request<{ members: WorkspaceMember[] }>(`${workspacePath(workspaceId)}/members`)
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
  }
};
