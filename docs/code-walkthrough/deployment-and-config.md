# Deployment, Build und Konfiguration

## Betriebsmodelle

CipherSpace unterstützt zwei Grundformen:

- Same-origin: Nginx liefert die PWA und proxyt `/api` an Fastify. Cookie kann `SameSite=Strict` bleiben; `VITE_API_BASE_URL` ist leer.
- Getrennte Origins: statisches Frontend verbindet sich mit einer exakt einkompilierten API-Origin. Die API braucht exaktes credentialed CORS, `SameSite=None; Secure` und korrektes `TRUST_PROXY` hinter einer vertrauenswürdigen TLS-Edge.

Die Datenbankmigration läuft vor dem API-Start. Der Service Worker ist nur für statische App-Ressourcen zuständig; IndexedDB bleibt die lokale Datenspeicherung.

## Root-Konfiguration

### `package.json`

**Verantwortung:** npm-Workspace-Wurzel für `apps/*` und `packages/*`, Node >= 22 sowie einheitliche Befehle.

**Wichtige Scripts:** `build:production` führt erst Typecheck und dann Workspace-Build aus; `build`, `test`, `typecheck` fan-out über Workspaces. `db:migrate` nutzt TS lokal, `db:migrate:deploy` kompiliertes JS. `dev` startet aus historischen Gründen die API; `dev:web` ist separat.

**Defense-Notiz:** Web-Scripts bauen das Crypto-Paket über `prebuild`/`pretest`/`pretypecheck` zuerst. So verwendet der Consumer die aktuelle Paketoberfläche.

### `tsconfig.base.json`

**Verantwortung:** Gemeinsame strikte TypeScript-Basis mit NodeNext, ES2022, konsistenter Schreibweise und `noUncheckedIndexedAccess`.

**Relevanz:** Strikte Typisierung reduziert versehentliche Null-/Indexfehler, ersetzt aber keine Laufzeitvalidierung externer JSON-Daten.

### `.env.example` — **sicherheitsrelevant**

**Verantwortung:** Dokumentiert alle Runtime-/Compose-/Buildvariablen ohne echte Secrets.

**Wichtige Gruppen:** DB-/Migrations-URLs, Pool, Host/Port/Loglevel, Session-Secret/SameSite/TTL, Request-/Rate-Limits, exakte CORS-Origins, Proxy-Vertrauen, öffentliche `VITE_API_BASE_URL` sowie lokale PostgreSQL-/Bind-Adressen.

**Security:** `SESSION_SECRET` muss zufällig und geheim sein; DB-Passwörter ebenfalls. `VITE_*` landet im Browserbundle und darf nie geheim sein. Die tatsächliche `.env` ist absichtlich nicht dokumentiert oder gelesen/wiedergegeben.

### `.gitignore`

**Verantwortung:** Schließt Dependencies, Build/Testausgaben, Logs, lokale DBs, Editorzustand, `.env` und private Key-/Recovery-Dateien aus.

**Security:** Die Recovery-/PEM-Muster reduzieren versehentliche Commits sensitiver Schlüssel. Ignore-Regeln sind kein Ersatz für Secret-Scanning oder Entfernen bereits versionierter Secrets.

### `.dockerignore`

**Verantwortung:** Verkleinert Buildkontext und hält `.env`, Git, Agentdateien, Dependencies, Buildoutput, Logs sowie Key-/Recovery-Dateien aus Docker-Buildschichten.

**Security:** Besonders wichtig, weil selbst nicht kopierte Dateien in einem übertragenen Buildkontext oder Cache sichtbar werden könnten.

### `docker-compose.yml`

**Verantwortung:** Lokaler Stack aus PostgreSQL 16, API und Nginx-Web.

**Wichtige Logik:** PostgreSQL hat Healthcheck und persistentes Volume; Bind-Adressen sind standardmäßig Loopback. API wartet auf gesunde DB, verlangt `SESSION_SECRET`, mountet nur tmpfs, läuft read-only, droppt alle Capabilities und setzt `no-new-privileges`. Web baut mit optionaler öffentlicher API-Origin und proxyt im Normalfall intern.

**Nicht leichtfertig ändern:** Öffentliche Bind-Adressen, Standardpasswort, `TRUST_PROXY`, Cookie-SameSite und CORS müssen als zusammenhängende Deploymententscheidung behandelt werden.

### `render.yaml`

**Verantwortung:** Render-Blueprint für den API-Docker-Service mit `/health`, Productionmodus, kleinem Pool, extern gesetzten DB-/CORS-Variablen und generiertem Session-Secret.

**Wichtige Logik:** `SESSION_COOKIE_SAME_SITE=none` und `TRUST_PROXY=true` gehen von separatem HTTPS-Frontend und vertrauenswürdiger Render-Edge aus. `MIGRATIONS_DATABASE_URL` kann eine direkte, nicht gepoolte URL sein.

**Grenze:** Diese Datei deployt nur die API. Das statische Frontend braucht einen separaten Host, passende `_headers` und `VITE_API_BASE_URL`.

## API-Build und Runtime

### `apps/api/package.json`

Definiert Fastify-, PostgreSQL-, Zod-, Argon2- und Security-Plugins sowie Scripts. `start:deploy` führt Migrationen vor `start` aus. `type: module` passt zu NodeNext-Ausgabe.

### `apps/api/tsconfig.json`

Kompiliert ausschließlich `src/**/*.ts` nach `dist`, erzeugt Declarations/Sourcemaps und übernimmt Root-Strictness. Tests werden nicht in Runtimeoutput kompiliert.

### `apps/api/vitest.config.ts`

Setzt 15 Sekunden Testtimeout, weil Argon2 und Integration-Flows mehr Zeit als reine Unit-Tests benötigen können.

### `apps/api/Dockerfile`

**Verantwortung:** Multi-stage API-Image.

**Build:** Node 22 Alpine, reproduzierbares `npm ci`, Kopie der Workspace-Manifeste, nur benötigte API-Quellen, TypeScript-Build und `npm prune --omit=dev`.

**Runtime:** Kopiert Production-Dependencies, dist und SQL-Migrationen; wechselt zu unprivilegiertem `node`; startet `start:deploy` auf Port 3000.

**Security:** Keine Source-Secrets im Image, unprivilegierter Benutzer und kleine Runtime-Schicht. Alpine/native Argon2-Kompatibilität ist bei Upgrades zu prüfen.

## Web-Build, Dev-Proxy und Nginx

### `apps/web/package.json`

Definiert React 19, React Router, TanStack Query, Dexie, Zod und das lokale Crypto-Paket. `build` kombiniert TypeScript Project References und Vite; Lifecycle-Scripts bauen vorher Crypto. `check:pwa` validiert den fertigen Build.

### `apps/web/tsconfig.json`

Root für Project References auf Browser- und Node-Konfiguration; enthält selbst keine Quellen.

### `apps/web/tsconfig.app.json`

Strikte Browser-/React-Konfiguration mit DOM-Libs, Bundler-Auflösung, Vite-/Vitest-/jest-dom-Typen und `noEmit`.

### `apps/web/tsconfig.node.json`

Strikte Composite-Konfiguration für `vite.config.ts` und `vitest.config.ts` mit Node-Typen.

### `apps/web/vite.config.ts`

**Verantwortung:** React-Plugin, Dev-Port 5173, Preview-Port 4173 und Same-origin-Proxies für `/api` sowie `/health` zu `localhost:3000`.

**Security:** Der Proxy vermeidet lokale Cross-origin-Cookies. Er ist keine Production-CORS-Policy.

### `apps/web/vitest.config.ts`

Konfiguriert jsdom und `src/test/setup.ts` für Komponenten-/Browsernahe Tests.

### `apps/web/Dockerfile`

**Verantwortung:** Multi-stage Frontendimage.

**Build:** `VITE_API_BASE_URL` wird als öffentliche Build-ARG/ENV gesetzt; npm installiert Workspaces; Crypto wird vor Web gebaut; Vite erzeugt `dist`.

**Runtime:** Nginx 1.27 Alpine bekommt nur Konfiguration und statische Ausgabe. Keine Node-Runtime oder Quellgeheimnisse werden benötigt.

### `apps/web/nginx.conf` — **sicherheitskritisch**

**Verantwortung:** Statische SPA-Auslieferung und Same-origin-Reverse-Proxy.

**Wichtige Logik:** 1.500-KiB-Bodylimit; server tokens off; restriktive CSP; COOP/CORP; deaktivierte Kamera/Geolocation/Mikrofon; no-referrer; nosniff; Frame-Deny. `/api/` und `/health` werden an `api:3000` weitergereicht. SPA-Fallback liefert `index.html`; Service Worker/Manifest sind explizit und der Worker wird nicht langfristig gecacht.

**Security:** `proxy_set_header X-Forwarded-*` passt zum API-Proxy-Vertrauen. CSP `connect-src 'self'` gilt für das Same-origin-Containerdeployment; ein separater API-Origin benötigt die statische `_headers`-Variante.

### `apps/web/index.html`

Vite-Einstieg und PWA-Metadaten. Es gibt keine Inline-Scripts/-Styles; das ermöglicht die CSP ohne `'unsafe-inline'`.

## Statisches Hosting, PWA und CSP

### `apps/web/public/_headers` — **sicherheitskritisch**

**Verantwortung:** Headerdatei für unterstützende Static Hosts.

**CSP:** default/self, keine base-uri/objects/Frames, nur Self-Scripts/Styles/Fonts/Worker/Manifest/Images plus Data-Images; `connect-src` erlaubt Self und den konkreten Render-API-Origin. Ergänzt HSTS, COOP/CORP, Permissions-Policy, no-referrer, nosniff und DENY.

**Nicht leichtfertig ändern:** Der API-Origin ist deployment-spezifisch. Änderungen müssen mit `VITE_API_BASE_URL` und API-`CORS_ORIGINS` übereinstimmen. Breite Wildcards oder `'unsafe-inline'` vergrößern das Risiko, weil ein XSS im entsperrten Client Klartext/Keys erreichen könnte.

### `apps/web/public/service-worker.js`

Produktions-PWA-Cache. Zwei versionierte Cache-Namen trennen Shell und Laufzeitassets. API/Health, non-GET und cross-origin werden vollständig ignoriert. Navigation ist network-first; Assets cache-first. Diese Trennung verhindert, dass Benutzer- oder Syncantworten in Cache Storage landen.

### `apps/web/public/manifest.webmanifest`

PWA-Identität, Rootscope, Standalone-Anzeige und Iconreferenzen. Theme-/Background-Farben sollten mit `index.html` und Offline-CSS konsistent bleiben.

### `apps/web/public/offline.html` und `apps/web/public/offline.css`

Statischer, benutzerneutraler Fallback. Es werden keine Workspace-Inhalte gerendert. Die echte Offlinefunktion entsteht erst durch gecachte App-Shell plus IndexedDB.

### `apps/web/scripts/check-pwa.mjs`

Build-Verifikation, die Manifest, Icons, HTML-Metadaten, Worker-Bypass, Offline-Dateien und Assets prüft. Sie sollte nach `npm run build:web` mit `npm run check:pwa` laufen.

### `apps/web/scripts/generate-pwa-icons.mjs`

Erzeugt reproduzierbare PNG-Icons programmgesteuert. Relevant für Wartung, aber die resultierenden Binärdateien sind generierte Assets und aus dem Einzeldatei-Walkthrough ausgeschlossen.

## Architekturkontext aus bestehenden Dokumenten

### `README.md`

Projektüberblick, lokale Start-/Prüfbefehle, aktueller Status, Security-Modell und Links zu Detaildokumenten. Für Neueinsteiger ist dies vor dem Code-Walkthrough die kürzeste Orientierung.

### `docs/ARCHITECTURE.md`

Normative High-Level-Architektur: Komponenten, Datenmodell, Sichtbarkeitsgrenze, implementierte Frontend-/Crypto-/Storage-Flows und Grenzen. Dieses Walkthrough konkretisiert sie auf Dateiebene.

### `docs/SYNC_PROTOCOL.md`

Protokollbeschreibung für lokale Queue, Push/Pull, Idempotenz, Cursor, Konflikte und Resolution. Bei Änderungen an SyncEngine oder API-Sync muss dieses Dokument als Entwurfsreferenz geprüft werden.

### `docs/THREAT_MODEL.md`

Bedrohungsmodell, Assets, Trust Boundaries, Angreiferannahmen, mitigierte und verbleibende Risiken. Für eine Thesis ist es die Grundlage, Sicherheitsbehauptungen auf den tatsächlich implementierten Schutzumfang zu begrenzen.

### `docs/DEPLOYMENT.md`

Betriebsanleitung für lokale/produktive Konfiguration, Datenbankmigration, CORS/Cookies/Proxy und Hosting. Sie ergänzt die dateibezogene Erklärung hier.

### `docs/PROJECT_STATE.md`

Momentaufnahme implementierter und noch nicht implementierter Funktionen. Nützlich, um Plantext in Architekturdocs nicht mit vorhandener Funktionalität zu verwechseln.

### `docs/NUTZUNGSANLEITUNG.md`

Benutzerabläufe und UI-Begriffe. Für Code-Defense hilfreich, um technische Flows auf sichtbare Aktionen abzubilden; keine normative Implementierungsquelle.

## Deployment-Checkliste für die Defense

1. `SESSION_SECRET` und DB-Credentials kommen aus Secret Stores, nicht aus Git oder `VITE_*`.
2. Frontend-Origin, `VITE_API_BASE_URL`, API-`CORS_ORIGINS`, Cookie-SameSite und TLS-Modell stimmen exakt überein.
3. `TRUST_PROXY` ist nur hinter einer vertrauenswürdigen Edge aktiv.
4. Migrationen laufen einmalig/gesperrt vor Traffic; angewandte Dateien werden nie editiert.
5. CSP/Headers sind am tatsächlich verwendeten Host verifiziert, nicht nur im Repository vorhanden.
6. Service Worker umgeht API/Health weiterhin und sein Cache-Namespace wird bei Shelländerungen versioniert.
7. Build, Typecheck, Tests und PWA-Check laufen mit Node 22.
