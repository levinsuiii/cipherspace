import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { AuthPage } from "./AuthPage";
import { useAuth } from "../auth/AuthContext";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("registration legal integration", () => {
  it("shows all legal links and requires Terms acceptance before registration", async () => {
    const register = vi.fn(async () => "verification_pending" as const);
    mockedUseAuth.mockReturnValue({
      ensureIdentity: vi.fn(),
      error: null,
      identityError: null,
      identityRestored: vi.fn(),
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      register,
      user: null
    });

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthPage mode="register" />
      </MemoryRouter>
    );

    expect(screen.getAllByRole("link", { name: "Nutzungsbedingungen" })[0]).toHaveAttribute(
      "href",
      "/terms"
    );
    expect(screen.getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute(
      "href",
      "/privacy"
    );
    expect(screen.getByRole("link", { name: "Impressum" })).toHaveAttribute("href", "/imprint");

    const checkbox = screen.getByRole("checkbox", { name: /Ich akzeptiere/ });
    expect(checkbox).toBeRequired();

    const form = screen.getByRole("button", { name: "Account erstellen" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Nutzungsbedingungen");

    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: "person@example.com" }
    });
    fireEvent.change(screen.getByLabelText(/Passwort/), {
      target: { value: "correct horse battery staple" }
    });
    fireEvent.click(checkbox);
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        email: "person@example.com",
        password: "correct horse battery staple"
      })
    );
  });
});
