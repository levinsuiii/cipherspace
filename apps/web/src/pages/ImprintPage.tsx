import { LegalPageLayout } from "../layouts/LegalPageLayout";

export function ImprintPage() {
  return (
    <LegalPageLayout
      eyebrow="Anbieterkennzeichnung"
      intro="Angaben zum Anbieter dieses kostenlosen Beta-Dienstes."
      title="Impressum"
    >
      <section>
        <h2>Angaben gemäß § 5 DDG</h2>
        <address>
          Levin Strecke<br />
          Nikolaus-Becker-Straße 1, 55131 Mainz
        </address>
      </section>

      <section>
        <h2>Kontakt</h2>
        <p>E-Mail: levin.strecke@yahoo.de</p>
      </section>

      <section>
        <h2>Hinweis</h2>
        <p>
          CipherSpace wird in der aktuellen öffentlichen Beta als kostenloser Dienst einer
          Einzelperson angeboten. Noch offene Betreiberangaben sind vor der Veröffentlichung
          durch die oben gekennzeichneten Angaben zu ersetzen.
        </p>
      </section>
    </LegalPageLayout>
  );
}
