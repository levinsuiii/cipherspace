import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSyncControls } from "./WorkspaceSyncControls";

afterEach(cleanup);

function props() {
  return {
    conflictCount: 0,
    keyAccess: { canInitialize: true, keyShareAvailable: false },
    keyStatus: "unlocked" as const,
    onCreateKey: vi.fn(async () => undefined),
    onLock: vi.fn(),
    onSync: vi.fn(async () => ({ conflicts: 0, pulled: 0, pushed: 2 })),
    onSetupShared: vi.fn(async () => undefined),
    onUnlock: vi.fn(async () => undefined),
    pendingCount: 2
  };
}

describe("WorkspaceSyncControls", () => {
  it("invokes manual sync and exposes the successful status", async () => {
    const controls = props();
    render(<WorkspaceSyncControls {...controls} />);

    expect(screen.getByText("2 lokale Änderungen warten auf den Abgleich.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Synchronisieren" }));

    await waitFor(() => expect(controls.onSync).toHaveBeenCalledOnce());
    expect(await screen.findByText("aktuell")).toBeInTheDocument();
  });

  it("creates a protected key only after matching unlock passwords", async () => {
    const controls = { ...props(), keyStatus: "missing" as const };
    render(<WorkspaceSyncControls {...controls} />);

    expect(screen.queryByRole("button", { name: "Synchronisieren" })).not.toBeInTheDocument();
    const fields = screen.getAllByLabelText(/Entsperrpasswort/i);
    fireEvent.change(fields[0]!, { target: { value: "correct horse battery" } });
    fireEvent.change(fields[1]!, { target: { value: "different password" } });
    fireEvent.click(screen.getByRole("button", { name: "Schlüssel erstellen und entsperren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stimmen nicht überein");
    expect(controls.onCreateKey).not.toHaveBeenCalled();

    fireEvent.change(fields[1]!, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Schlüssel erstellen und entsperren" }));
    await waitFor(() =>
      expect(controls.onCreateKey).toHaveBeenCalledWith("correct horse battery")
    );
  });

  it("sets up a recipient key share with separate identity and workspace passwords", async () => {
    const controls = {
      ...props(),
      keyAccess: { canInitialize: false, keyShareAvailable: true },
      keyStatus: "missing" as const
    };
    render(<WorkspaceSyncControls {...controls} />);

    fireEvent.change(screen.getByLabelText("Account-Passwort"), {
      target: { value: "recipient account password" }
    });
    const workspacePasswords = screen.getAllByLabelText(/Entsperrpasswort/i);
    fireEvent.change(workspacePasswords[0]!, { target: { value: "recipient workspace password" } });
    fireEvent.change(workspacePasswords[1]!, { target: { value: "recipient workspace password" } });
    fireEvent.click(screen.getByRole("button", { name: "Verschlüsselten Zugriff einrichten" }));

    await waitFor(() =>
      expect(controls.onSetupShared).toHaveBeenCalledWith(
        "recipient account password",
        "recipient workspace password"
      )
    );
    expect(controls.onCreateKey).not.toHaveBeenCalled();
  });

  it("never offers a replacement key while legacy plaintext requires the original key", () => {
    const controls = { ...props(), keyStatus: "missing" as const };
    render(<WorkspaceSyncControls {...controls} legacyMigrationRequired />);

    expect(screen.getByText("Migration nötig")).toBeInTheDocument();
    expect(screen.getByText(/Ersatzschlüssel/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Schlüssel erstellen und entsperren" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Synchronisieren" })).not.toBeInTheDocument();
  });

  it("labels fetch failures as server unavailable without mislabeling API errors", async () => {
    const controls = props();
    controls.onSync.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { rerender } = render(<WorkspaceSyncControls {...controls} />);
    fireEvent.click(screen.getByRole("button", { name: "Synchronisieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server ist nicht erreichbar");

    const rejected = props();
    rejected.onSync.mockRejectedValueOnce(new Error("The response was invalid."));
    rerender(<WorkspaceSyncControls {...rejected} />);
    fireEvent.click(screen.getByRole("button", { name: "Synchronisieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The response was invalid.");
  });

  it("reports a detected conflict until the conflict count is resolved", async () => {
    const controls = props();
    controls.onSync.mockResolvedValueOnce({ conflicts: 1, pulled: 1, pushed: 0 });
    const { rerender } = render(<WorkspaceSyncControls {...controls} conflictCount={1} />);

    fireEvent.click(screen.getByRole("button", { name: "Synchronisieren" }));
    expect(await screen.findByText("Konflikt")).toBeInTheDocument();
    expect(screen.getByText("1 Konflikt muss manuell gelöst werden.")).toBeInTheDocument();

    rerender(<WorkspaceSyncControls {...controls} conflictCount={0} pendingCount={1} />);
    await waitFor(() => expect(screen.getByText("bereit")).toBeInTheDocument());
  });
});
