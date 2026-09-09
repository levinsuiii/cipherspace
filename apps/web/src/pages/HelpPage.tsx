import { Link } from "react-router-dom";

const helpSteps = [
  {
    title: "Account erstellen",
    text: <>Öffne <strong>Account erstellen</strong> und registriere dich mit E-Mail-Adresse und einem Passwort mit mindestens 12 Zeichen.</>
  },
  {
    title: "Verschlüsselung einrichten",
    text: <>Gib auf der Seite <strong>Workspaces</strong> dein Account-Passwort ein und wähle <strong>Verschlüsselungsidentität erstellen</strong>. Sichere danach unter <strong>Sicherheit</strong> ein Wiederherstellungspaket.</>
  },
  {
    title: "Workspace erstellen",
    text: <>Vergib unter <strong>Workspace erstellen</strong> einen Namen. Lege im neuen Workspace anschließend ein eigenes lokales Entsperrpasswort über <strong>Schlüssel erstellen und entsperren</strong> fest.</>
  },
  {
    title: "Notizen schreiben",
    text: <>Öffne den Reiter <strong>Notizen</strong>. Mit <strong>Notiz erstellen</strong> und <strong>Änderung speichern</strong> landen Inhalte zuerst verschlüsselt auf diesem Gerät.</>
  },
  {
    title: "Änderungen abgleichen",
    text: <>Wähle <strong>Synchronisieren</strong>, um ausstehende Notizänderungen zu senden und Serveränderungen abzurufen. Der Abgleich startet nicht automatisch; Kommentare benötigen eine Onlineverbindung.</>
  },
  {
    title: "Mitglieder hinzufügen",
    text: <>Besitzer können in der <strong>Übersicht</strong> die E-Mail eines bereits registrierten Accounts eingeben und die Rolle <strong>Editor</strong> oder <strong>Leser</strong> wählen. Dafür muss der Workspace entsperrt sein.</>
  },
  {
    title: "Später entsperren und wiederherstellen",
    text: <>Nach einem Neuladen entsperrst du den Workspace mit <strong>Workspace entsperren</strong> und deinem lokalen Entsperrpasswort. Das Wiederherstellungspaket unter <strong>Sicherheit</strong> sichert deine persönliche Verschlüsselungsidentität, aber keine Notizen oder Workspace-Schlüssel.</>
  }
];

export function HelpPage() {
  return (
    <main className="landing-page help-page">
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

      <header className="help-header">
        <p className="eyebrow">Kurzanleitung</p>
        <h1>CipherSpace verwenden</h1>
        <p>
          Diese Schritte führen von der Registrierung bis zur ersten synchronisierten Notiz.
          Account-Passwort und lokales Entsperrpasswort haben unterschiedliche Aufgaben.
        </p>
      </header>

      <ol className="help-steps">
        {helpSteps.map((step, index) => (
          <li key={step.title}>
            <span className="help-step-number">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="help-note" aria-labelledby="help-note-title">
        <h2 id="help-note-title">Wichtig</h2>
        <p>
          CipherSpace ist ein Prototyp. Bewahre Wiederherstellungspaket und Passphrase getrennt
          auf. Nicht synchronisierte lokale Änderungen lassen sich nach einem Verlust der
          Browserdaten nicht wiederherstellen.
        </p>
        <Link className="button button--primary" to="/register">Account erstellen</Link>
      </section>
    </main>
  );
}
