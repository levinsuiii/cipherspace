import { Link } from "react-router-dom";
import { LegalLinks } from "../components/LegalLinks";

export function LandingPage() {
  return (
    <main className="landing-page">
      <header className="public-nav">
        <Link className="brand" to="/" aria-label="CipherSpace Startseite">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>CipherSpace</span>
        </Link>
        <nav aria-label="Seitennavigation">
          <a href="#arbeitsweise">Arbeitsweise</a>
          <a href="#projekt">Projekt</a>
          <Link className="public-help-link" to="/hilfe">Kurzanleitung</Link>
          <Link className="button button--quiet" to="/login">Anmelden</Link>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__copy">
          <p className="eyebrow">Verschlüsselte Zusammenarbeit</p>
          <h1 id="landing-title">Gemeinsam schreiben.<br />Im Browser verschlüsseln.</h1>
          <p className="landing-lead">
            CipherSpace ist ein kleiner Kollaborationseditor für private Notizen. Inhalte werden
            auf deinem Gerät verschlüsselt und erst danach mit dem Server synchronisiert.
          </p>
          <div className="landing-actions">
            <Link className="button button--primary" to="/login">CipherSpace öffnen</Link>
            <Link className="button button--secondary" to="/register">Account erstellen</Link>
          </div>
        </div>

        <div className="document-study" aria-label="Schematische Darstellung einer verschlüsselten Notiz">
          <div className="document-study__meta"><span>NOTIZ / 07</span><span>LOKAL</span></div>
          <div className="document-study__title" />
          <div className="document-study__line document-study__line--long" />
          <div className="document-study__line" />
          <div className="document-study__line document-study__line--short" />
          <div className="document-study__cipher">
            <span>VERSCHLÜSSELT</span>
            <span aria-hidden="true">4f · a2 · 91 · c8</span>
          </div>
        </div>
      </section>

      <section className="landing-section workflow" id="arbeitsweise" aria-labelledby="workflow-title">
        <div className="landing-section__heading">
          <p className="section-number">01</p>
          <div>
            <p className="eyebrow">Arbeitsweise</p>
            <h2 id="workflow-title">Von der Notiz zum verschlüsselten Datensatz.</h2>
          </div>
        </div>
        <ol className="workflow-list">
          <li><span>01</span><strong>Workspace anlegen</strong><p>Ein gemeinsamer Bereich mit klaren Rollen.</p></li>
          <li><span>02</span><strong>Notiz schreiben</strong><p>Änderungen landen zuerst im lokalen Speicher.</p></li>
          <li><span>03</span><strong>Inhalte verschlüsseln</strong><p>Der Browser erstellt den verschlüsselten Inhalt.</p></li>
          <li><span>04</span><strong>Änderungen abgleichen</strong><p>Der Server erhält Chiffrat und notwendige Metadaten.</p></li>
        </ol>
      </section>

      <section className="landing-section product-facts" aria-labelledby="facts-title">
        <div className="landing-section__heading">
          <p className="section-number">02</p>
          <div>
            <p className="eyebrow">Was CipherSpace tut</p>
            <h2 id="facts-title">Ein praktischer Arbeitsbereich, kein Sicherheitsversprechen.</h2>
          </div>
        </div>
        <div className="fact-columns">
          <p>
            Workspaces bündeln Mitglieder, Notizen und Diskussionen. Lokale Änderungen bleiben
            erhalten, wenn die Verbindung ausfällt, und werden später synchronisiert.
          </p>
          <p>
            Notiz- und Kommentarinhalte werden clientseitig verschlüsselt. Metadaten wie
            Workspace-Namen, Mitgliedschaften, Zeitpunkte und Datensatzgrößen bleiben für den
            Server sichtbar.
          </p>
        </div>
      </section>

      <section className="landing-section project-note" id="projekt" aria-labelledby="project-title">
        <p className="section-number">03</p>
        <div>
          <p className="eyebrow">Projektstatus</p>
          <h2 id="project-title">Unabhängig entwickelt, bewusst transparent.</h2>
          <p>
            CipherSpace ist ein eigenständig entwickelter Prototyp für lokale, verschlüsselte
            Zusammenarbeit. Er ist nicht unabhängig sicherheitsgeprüft und schützt nicht vor
            kompromittierten Geräten, Browser-Erweiterungen oder manipuliert ausgeliefertem
            Frontend-Code.
          </p>
        </div>
        <Link className="text-link" to="/register">Account erstellen <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="public-footer">
        <span>CipherSpace</span>
        <LegalLinks />
      </footer>
    </main>
  );
}
