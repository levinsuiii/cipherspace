import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { LandingPage } from "./LandingPage";

afterEach(cleanup);

describe("LandingPage", () => {
  it("presents the product in German without overstating its security", () => {
    render(<LandingPage />, { wrapper: MemoryRouter });

    expect(
      screen.getByRole("heading", { name: "Gemeinsam schreiben. Im Browser verschlüsseln." })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CipherSpace öffnen" })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(screen.getAllByRole("link", { name: "Account erstellen" })[0]).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByText(/nicht unabhängig sicherheitsgeprüft/)).toBeInTheDocument();
    expect(screen.getByText(/Metadaten wie Workspace-Namen/)).toBeInTheDocument();
  });
});
