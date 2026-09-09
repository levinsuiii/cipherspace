import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { HelpPage } from "./HelpPage";

afterEach(cleanup);

describe("HelpPage", () => {
  it("shows the compact first-use flow with current UI labels", () => {
    render(<HelpPage />, { wrapper: MemoryRouter });

    expect(screen.getByRole("heading", { name: "CipherSpace verwenden" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("Verschlüsselungsidentität erstellen")).toBeInTheDocument();
    expect(screen.getByText("Schlüssel erstellen und entsperren")).toBeInTheDocument();
    expect(screen.getByText("Synchronisieren")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", "/login");
  });
});
