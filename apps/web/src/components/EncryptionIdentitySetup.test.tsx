import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthContext";
import { inspectUserCryptoIdentity } from "../key-management/userIdentity";
import { EncryptionIdentitySetup } from "./EncryptionIdentitySetup";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../key-management/userIdentity", () => ({ inspectUserCryptoIdentity: vi.fn() }));

const user = {
  createdAt: "2026-08-24T12:00:00.000Z",
  email: "new-user@example.com",
  id: "00000000-0000-4000-8000-000000000010"
};

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(cleanup);

function renderSetup(ensureIdentity = vi.fn(async () => undefined)) {
  vi.mocked(useAuth).mockReturnValue({
    ensureIdentity,
    error: null,
    identityError: null,
    identityRestored: vi.fn(),
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    user
  });
  render(
    <MemoryRouter>
      <EncryptionIdentitySetup />
    </MemoryRouter>
  );
  return ensureIdentity;
}

describe("EncryptionIdentitySetup", () => {
  it("offers first-device identity creation and recommends recovery export afterward", async () => {
    vi.mocked(inspectUserCryptoIdentity)
      .mockResolvedValueOnce("missing-unregistered")
      .mockResolvedValueOnce("ready");
    const ensureIdentity = renderSetup();

    expect(
      await screen.findByRole("heading", { name: "Dieses Gerät für Verschlüsselung einrichten" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Wiederherstellungspaket importieren" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Account-Passwort/), {
      target: { value: "new user account password" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Verschlüsselungsidentität erstellen" }));

    await waitFor(() => expect(ensureIdentity).toHaveBeenCalledWith("new user account password"));
    expect(
      await screen.findByRole("heading", { name: "Verschlüsselungsidentität erstellt" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wiederherstellungspaket exportieren" })).toHaveAttribute(
      "href",
      "/account/security/recovery"
    );
  });

  it("keeps recovery import as the action when the account already has a public key", async () => {
    vi.mocked(inspectUserCryptoIdentity).mockResolvedValue("missing-registered");
    renderSetup();

    expect(
      await screen.findByRole("heading", { name: "Deine private Verschlüsselungsidentität fehlt" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wiederherstellungspaket importieren" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verschlüsselungsidentität erstellen" })).not.toBeInTheDocument();
  });
});
