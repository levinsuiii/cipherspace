import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
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
