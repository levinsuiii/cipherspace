import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { confirmEmail, requestEmailVerification } = vi.hoisted(() => ({
  confirmEmail: vi.fn(),
  requestEmailVerification: vi.fn()
}));

vi.mock("../api/client", () => ({
  api: {
    auth: {
      confirmEmail,
      requestEmailVerification
    }
  }
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: {
      createdAt: "2026-01-01T00:00:00.000Z",
      email: "migrated@example.com",
      emailVerifiedAt: null,
      id: "migrated-user"
    }
  })
}));

import { VerifyEmailPage } from "./VerifyEmailPage";

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    confirmEmail.mockReset();
    requestEmailVerification.mockReset();
    window.history.replaceState({}, "", "/verify-email");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("takes the fragment token, removes it from browser history, and submits it in the POST body", async () => {
    const token = "a".repeat(43);
    window.history.replaceState({}, "", `/verify-email#token=${token}`);
    confirmEmail.mockResolvedValue({ user: {} });
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");

    render(
      <StrictMode>
        <MemoryRouter>
          <VerifyEmailPage />
        </MemoryRouter>
      </StrictMode>
    );

    expect(screen.getByLabelText("Bestätigungscode")).toHaveValue(token);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(token);

    fireEvent.change(screen.getByLabelText("Account-Passwort"), {
      target: { value: "correct horse battery staple" }
    });
    fireEvent.click(screen.getByRole("button", { name: "E-Mail bestätigen" }));

    await waitFor(() => expect(confirmEmail).toHaveBeenCalledWith(
      token,
      "correct horse battery staple"
    ));
    expect(window.location.href).not.toContain(token);
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("lets an authenticated migrated unverified user request a verification email", async () => {
    requestEmailVerification.mockResolvedValue({ message: "generic" });
    render(<VerifyEmailPage />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }));

    await waitFor(() => expect(requestEmailVerification).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("wurde eine neue E-Mail gesendet");
  });

  it("shows a generic error without provider details", async () => {
    requestEmailVerification.mockRejectedValue(new Error("Resend provider secret detail"));
    render(<VerifyEmailPage />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bitte versuche es später erneut");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Resend provider secret detail");
  });
});
