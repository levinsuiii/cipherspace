import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localDatabase } from "../local-storage/database";
import { WorkspaceKeyProvider, useWorkspaceKey } from "./WorkspaceKeyContext";

const mocks = vi.hoisted(() => ({
  key: {} as CryptoKey
}));

vi.mock("@cipherspace/crypto", () => ({
  generateWorkspaceKey: vi.fn(async () => mocks.key),
  protectWorkspaceKey: vi.fn(async () => ({
    algorithm: "AES-GCM",
    ciphertext: "protected-key",
    iterations: 600_000,
    kdf: "PBKDF2",
    nonce: "AAAAAAAAAAAAAAAA",
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    version: 1
  })),
  unlockWorkspaceKey: vi.fn(async () => mocks.key)
}));

const userId = "00000000-0000-4000-8000-000000000091";
const workspaceId = "10000000-0000-4000-8000-000000000091";
const storageKey = `${userId}:${workspaceId}`;

function Harness() {
  const workspaceKey = useWorkspaceKey(workspaceId);
  const [keyError, setKeyError] = useState("");
  const readKey = async () => {
    try {
      await workspaceKey.getKey();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Key unavailable";
      setKeyError(message);
    }
  };

  return (
    <div>
      <span>{workspaceKey.status}</span>
      <button onClick={() => void workspaceKey.create("correct horse battery")} type="button">
        Create key
      </button>
      <button onClick={() => void readKey()} type="button">Read key</button>
      <span data-key-error>{keyError}</span>
    </div>
  );
}

describe("WorkspaceKeyProvider background locking", () => {
  let visibilityState: DocumentVisibilityState;

  beforeEach(async () => {
    await localDatabase.workspace_keys.delete(storageKey);
    visibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await localDatabase.workspace_keys.delete(storageKey);
  });

  it("removes in-memory workspace keys when the app becomes hidden", async () => {
    render(
      <WorkspaceKeyProvider userId={userId}>
        <Harness />
      </WorkspaceKeyProvider>
    );

    expect(await screen.findByText("missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByText("unlocked")).toBeInTheDocument();

    visibilityState = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByText("locked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Read key" }));
    await waitFor(() => {
      expect(document.querySelector("[data-key-error]")).toHaveTextContent(
        "Unlock this workspace before syncing."
      );
    });
  });
});
