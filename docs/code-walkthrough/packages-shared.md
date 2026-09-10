# `packages/shared`

## Aktueller Stand

Im untersuchten Repository existiert kein Verzeichnis `packages/shared`. Es wurde daher kein Quellcode dafür erfunden oder dokumentiert. Diese Datei hält die Abwesenheit ausdrücklich fest, damit die Inventur vollständig und die Architektur nicht missverständlich ist.

## Wo die gemeinsamen Verträge derzeit liegen

- Frontend-HTTP-Typen befinden sich in `apps/web/src/api/types.ts`.
- Backend-Domänen- und Transporttypen liegen in den jeweiligen `service.ts`- und `repository.ts`-Dateien unter `apps/api/src`.
- Kryptografische Umschläge und Kontexttypen werden aus `packages/crypto/src/types.ts` exportiert.
- Die tatsächliche Laufzeitvalidierung erfolgt auf beiden Seiten getrennt: Zod-Schemas in API-Routen und in `apps/web/src/sync/protocol.ts`.

Diese Duplizierung ist bewusst relevant für die Code-Defense: TypeScript-Typen existieren nur zur Compile-Zeit und schützen keine Netzwerkgrenze. Deshalb validieren Backend und Sync-Client fremde JSON-Daten jeweils zur Laufzeit. Ein späteres Shared-Package könnte Drift reduzieren, wäre aber eine Architekturänderung und ist nicht Teil dieser Dokumentationsaufgabe.

## Sicherheitsrelevanz

Ein zukünftiges `packages/shared` dürfte keine Server-Secrets, privaten Schlüssel oder Browser-Klartexte enthalten. Außerdem darf das Teilen von Typen nicht dazu verleiten, die unabhängige Laufzeitvalidierung untrusted Daten zu entfernen.
