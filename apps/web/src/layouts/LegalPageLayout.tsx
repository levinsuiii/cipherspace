import type { PropsWithChildren, ReactNode } from "react";
import { Link } from "react-router-dom";

import { LegalLinks } from "../components/LegalLinks";

interface LegalPageLayoutProps extends PropsWithChildren {
  eyebrow: string;
  intro: ReactNode;
  title: string;
}

export function LegalPageLayout({ children, eyebrow, intro, title }: LegalPageLayoutProps) {
  return (
    <main className="landing-page legal-page">
      <header className="public-nav">
        <Link className="brand" to="/" aria-label="CipherSpace Startseite">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>CipherSpace</span>
        </Link>
        <nav aria-label="Seitennavigation">
          <Link to="/">Startseite</Link>
          <Link className="button button--quiet" to="/login">Anmelden</Link>
        </nav>
      </header>

      <header className="legal-header">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>

      <div className="legal-content">{children}</div>

      <footer className="public-footer legal-footer">
        <span>CipherSpace</span>
        <LegalLinks />
      </footer>
    </main>
  );
}
