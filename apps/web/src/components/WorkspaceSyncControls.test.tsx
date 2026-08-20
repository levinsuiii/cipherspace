import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSyncControls } from "./WorkspaceSyncControls";

afterEach(cleanup);

function props() {
  return {
    conflictCount: 0,
    keyStatus: "unlocked" as const,
    onCreateKey: vi.fn(async () => undefined),
    onLock: vi.fn(),
    onSync: vi.fn(async () => ({ conflicts: 0, pulled: 0, pushed: 2 })),
    onUnlock: vi.fn(async () => undefined),
    pendingCount: 2
  };
}

describe("WorkspaceSyncControls", () => {
  it("invokes manual sync and exposes the successful status", async () => {
    const controls = props();
    render(<WorkspaceSyncControls {...controls} />);

    expect(screen.getByText("2 local changes ready to sync.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() => expect(controls.onSync).toHaveBeenCalledOnce());
    expect(await screen.findByText("synced")).toBeInTheDocument();
  });

  it("creates a protected key only after matching unlock passwords", async () => {
    const controls = { ...props(), keyStatus: "missing" as const };
    render(<WorkspaceSyncControls {...controls} />);

    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
    const fields = screen.getAllByLabelText(/unlock password/i);
    fireEvent.change(fields[0]!, { target: { value: "correct horse battery" } });
    fireEvent.change(fields[1]!, { target: { value: "different password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and unlock key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
    expect(controls.onCreateKey).not.toHaveBeenCalled();

    fireEvent.change(fields[1]!, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and unlock key" }));
    await waitFor(() =>
      expect(controls.onCreateKey).toHaveBeenCalledWith("correct horse battery")
    );
  });

  it("labels fetch failures as server unavailable without mislabeling API errors", async () => {
    const controls = props();
    controls.onSync.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { rerender } = render(<WorkspaceSyncControls {...controls} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");

    const rejected = props();
    rejected.onSync.mockRejectedValueOnce(new Error("The response was invalid."));
    rerender(<WorkspaceSyncControls {...rejected} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The response was invalid.");
  });

  it("reports a detected conflict until the conflict count is resolved", async () => {
    const controls = props();
    controls.onSync.mockResolvedValueOnce({ conflicts: 1, pulled: 1, pushed: 0 });
    const { rerender } = render(<WorkspaceSyncControls {...controls} conflictCount={1} />);

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(await screen.findByText("conflict")).toBeInTheDocument();
    expect(screen.getByText("1 conflict needs manual resolution.")).toBeInTheDocument();

    rerender(<WorkspaceSyncControls {...controls} conflictCount={0} pendingCount={1} />);
    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
  });
});
