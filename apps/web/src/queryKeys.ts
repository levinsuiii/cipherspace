export const queryKeys = {
  members: (workspaceId: string) => ["workspaces", workspaceId, "members"] as const,
  note: (workspaceId: string, noteId: string) =>
    ["workspaces", workspaceId, "notes", noteId] as const,
  notes: (workspaceId: string) => ["workspaces", workspaceId, "notes"] as const,
  workspace: (workspaceId: string) => ["workspaces", workspaceId] as const,
  workspaces: ["workspaces"] as const
};
