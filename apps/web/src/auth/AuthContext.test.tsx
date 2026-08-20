import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import { AuthProvider, useAuth } from "./AuthContext";
import { cacheOfflineUser } from "./offlineUserCache";

const user = {
  createdAt: "2026-08-19T12:00:00.000Z",
  email: "person@example.test",
  id: "00000000-0000-4000-8000-000000000001"
};

function AuthHarness() {
  const auth = useAuth();
  if (auth.isLoading) return <p>Loading</p>;
  return (
    <div>
      <span>{auth.user?.email ?? "Signed out"}</span>
      <button onClick={() => void auth.logout()} type="button">Sign out</button>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("AuthProvider", () => {
  it("updates the live auth state when logout clears application data", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue({ user });
    vi.spyOn(api.auth, "logout").mockResolvedValue();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText(user.email)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    expect(api.auth.logout).toHaveBeenCalledOnce();
  });

  it("uses the cached user identity when session verification is offline", async () => {
    cacheOfflineUser(user);
    vi.spyOn(api.auth, "me").mockRejectedValue(new TypeError("Failed to fetch"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText(user.email)).toBeInTheDocument();
  });
});
