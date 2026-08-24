import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, buildApiUrl, normalizeApiBaseUrl } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it("normalizes an optional public API origin and rejects unsafe values", () => {
    expect(normalizeApiBaseUrl(undefined)).toBe("");
    expect(normalizeApiBaseUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(() => normalizeApiBaseUrl("/api")).toThrow(/absolute HTTP\(S\) origin/);
    expect(() => normalizeApiBaseUrl("https://api.example.com/v1")).toThrow(/without a path/);
  });

  it("adds the API prefix to origin-only production and same-origin URLs", () => {
    expect(buildApiUrl("https://cipherspace-api.onrender.com", "/crypto/identity")).toBe(
      "https://cipherspace-api.onrender.com/api/crypto/identity"
    );
    expect(buildApiUrl("", "/auth/register")).toBe("/api/auth/register");
    expect(() => buildApiUrl("https://api.example.com", "/api/workspaces")).toThrow(
      /omit the \/api prefix/
    );
  });

  it("uses the API prefix for every frontend API family", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response("{}", { headers: { "Content-Type": "application/json" }, status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      api.auth.login({} as never),
      api.auth.logout(),
      api.auth.me(),
      api.auth.register({} as never),
      api.cryptoIdentity.get(),
      api.cryptoIdentity.register({} as never),
      api.comments.create("workspace id", "note id", {} as never),
      api.comments.delete("workspace id", "note id", "comment id"),
      api.comments.list("workspace id", "note id"),
      api.workspaces.addMember("workspace id", {} as never),
      api.workspaces.create("Workspace"),
      api.workspaces.get("workspace id"),
      api.workspaces.getInviteeKey("workspace id", { email: "person@example.com" }),
      api.workspaces.getInviteeKey("workspace id", { userId: "user id" }),
      api.workspaces.getKeyAccess("workspace id"),
      api.workspaces.getOwnKeyShare("workspace id"),
      api.workspaces.list(),
      api.workspaces.listMembers("workspace id"),
      api.workspaces.putKeyShare("workspace id", "user id", {} as never),
      api.notes.create("workspace id", {} as never),
      api.notes.get("workspace id", "note id"),
      api.notes.list("workspace id"),
      api.sync.pull("workspace id", null),
      api.sync.pull("workspace id", "cursor value"),
      api.sync.push("workspace id", "client id", [])
    ]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/auth/register",
      "/api/crypto/identity",
      "/api/crypto/identity",
      "/api/workspaces/workspace%20id/notes/note%20id/comments",
      "/api/workspaces/workspace%20id/notes/note%20id/comments/comment%20id",
      "/api/workspaces/workspace%20id/notes/note%20id/comments",
      "/api/workspaces/workspace%20id/members",
      "/api/workspaces",
      "/api/workspaces/workspace%20id",
      "/api/workspaces/workspace%20id/invitee-key?email=person%40example.com",
      "/api/workspaces/workspace%20id/invitee-key?userId=user%20id",
      "/api/workspaces/workspace%20id/key-access",
      "/api/workspaces/workspace%20id/key-share",
      "/api/workspaces",
      "/api/workspaces/workspace%20id/members",
      "/api/workspaces/workspace%20id/key-shares/user%20id",
      "/api/workspaces/workspace%20id/notes",
      "/api/workspaces/workspace%20id/notes/note%20id",
      "/api/workspaces/workspace%20id/notes",
      "/api/workspaces/workspace%20id/sync/pull",
      "/api/workspaces/workspace%20id/sync/pull?cursor=cursor%20value",
      "/api/workspaces/workspace%20id/sync/push"
    ]);
  });

  it("includes browser credentials on authenticated requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ workspaces: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.workspaces.list()).resolves.toEqual({ workspaces: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("preserves structured backend errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "invalid_credentials", message: "Invalid email or password." }
          }),
          { headers: { "Content-Type": "application/json" }, status: 401 }
        )
      )
    );

    const error = await api.auth.me().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "invalid_credentials",
      message: "Invalid email or password.",
      status: 401
    });
  });
});
