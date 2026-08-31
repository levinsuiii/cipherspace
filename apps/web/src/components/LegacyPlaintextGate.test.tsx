import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LegacyPlaintextGate } from "./LegacyPlaintextGate";

afterEach(cleanup);

describe("LegacyPlaintextGate", () => {
  it("blocks normal workspace content while legacy plaintext exists", () => {
    render(
      <LegacyPlaintextGate
        accessControls={<div>Original key unlock controls</div>}
        error={null}
        inspection={{ conflicts: 1, notes: 2, pendingChanges: 3, totalRecords: 6 }}
        isMigrating={false}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      >
        <div>Normal workspace notes and comments</div>
      </LegacyPlaintextGate>
    );

    expect(screen.getByText("Legacy plaintext blocks this workspace")).toBeInTheDocument();
    expect(screen.getByText("Original key unlock controls")).toBeInTheDocument();
    expect(screen.queryByText("Normal workspace notes and comments")).not.toBeInTheDocument();
  });

  it("requires a second explicit confirmation before deleting affected records", async () => {
    const onDelete = vi.fn(async () => undefined);
    render(
      <LegacyPlaintextGate
        accessControls={null}
        error="Migration could not verify a legacy record."
        inspection={{ conflicts: 0, notes: 1, pendingChanges: 1, totalRecords: 2 }}
        isMigrating={false}
        onDelete={onDelete}
        onRetry={vi.fn()}
      >
        <div>Normal workspace</div>
      </LegacyPlaintextGate>
    );

    expect(screen.getByText("Migration could not verify a legacy record.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Permanently delete affected local records" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review permanent delete option" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Permanently delete affected local records" })
    );
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
  });

  it("renders normal workspace content only after inspection is clean", () => {
    render(
      <LegacyPlaintextGate
        accessControls={<div>Unlock controls</div>}
        error={null}
        inspection={{ conflicts: 0, notes: 0, pendingChanges: 0, totalRecords: 0 }}
        isMigrating={false}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      >
        <div>Normal workspace</div>
      </LegacyPlaintextGate>
    );

    expect(screen.getByText("Normal workspace")).toBeInTheDocument();
    expect(screen.queryByText("Unlock controls")).not.toBeInTheDocument();
  });
});
