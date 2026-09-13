import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { App } from "../App";

afterEach(cleanup);

describe("public legal pages", () => {
  const routes = [
    ["/privacy", "Datenschutzerklärung"],
    ["/terms", "Nutzungsbedingungen"],
    ["/imprint", "Impressum"]
  ] as const;

  it.each(routes)("renders %s without an authenticated route guard", (route, title) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", "/login");
  });
});
