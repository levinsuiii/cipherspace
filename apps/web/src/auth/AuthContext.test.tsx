import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "../api/client";
import { ensureLocalUserCryptoIdentity } from "../key-management/userIdentity";
import { AuthProvider, useAuth } from "./AuthContext";
import { cacheOfflineUser } from "./offlineUserCache";

vi.mock("../key-management/userIdentity", () => ({
  ensureLocalUserCryptoIdentity: vi.fn()
}));

const user = {
  createdAt: "2026-08-19T12:00:00.000Z",
  email: "person@example.test",
  emailVerifiedAt: null,
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

function RegistrationHarness() {
  const auth = useAuth();
  const [status, setStatus] = useState("idle");
  if (auth.isLoading) return <p>Loading</p>;
  return (
    <div>
      <span>{auth.user?.email ?? "Signed out"}</span>
      <button
        onClick={() => {
          void auth.register({
            email: "outsider@example.com",
            password: "correct horse battery staple"
          }).then(
            () => setStatus("registered"),
            () => setStatus("rejected")
          );
        }}
        type="button"
      >
        Register
      </button>
      <span>{status}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
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

  it("migrates a pre-verification offline user cache to unverified state", async () => {
    localStorage.setItem(
      "cipherspace:offline-user",
      JSON.stringify({ createdAt: user.createdAt, email: user.email, id: user.id })
    );
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
    expect(JSON.parse(localStorage.getItem("cipherspace:offline-user") ?? "{}")).not.toEqual({});
  });

  it("creates no local auth or encryption-identity state when closed beta rejects registration", async () => {
    vi.spyOn(api.auth, "me").mockRejectedValue(
      new ApiError("Authentication is required.", 401, "unauthorized")
    );
    vi.spyOn(api.auth, "register").mockRejectedValue(
      new ApiError("Registration is closed.", 403, "registration_closed")
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RegistrationHarness />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("rejected")).toBeInTheDocument();
    expect(ensureLocalUserCryptoIdentity).not.toHaveBeenCalled();
    expect(localStorage.getItem("cipherspace:offline-user")).toBeNull();
    expect(queryClient.getQueryData(["auth", "me"])).toBeNull();
  });
});
