# Project State

CipherSpace is a private beta with a runnable responsive React frontend, an installable Progressive Web App shell, Fastify backend, PostgreSQL persistence, authentication, workspace membership, recipient-specific end-to-end encrypted workspace-key sharing, encrypted-note/version APIs, encrypted note comments and replies, an isolated client crypto package, durable local-first note storage, encrypted-note push/pull, local workspace lock/unlock, encrypted identity recovery-kit export/import, manual sync, manual note-edit conflict resolution, and configuration for a no-cost private-beta deployment. Automated device pairing, identity replacement, rotation, cryptographic revocation, automatic merging, and offline comment sync remain separate future work.

## Current Status

- `apps/api` contains a TypeScript/Node.js Fastify service.
- `apps/web` contains a React and TypeScript Vite application using React Router and TanStack Query.
- The frontend includes login and registration pages, HTTP-only cookie session bootstrap/logout, protected routing, a responsive authenticated layout, and touch-friendly navigation.
- Layouts are usable around 360px width: workspace/note rows remain readable, note creation moves ahead of long lists, editor actions stack, inputs avoid iOS focus zoom, nested comments limit indentation, conflict snapshots remain scrollable, and primary controls use at least 44px touch targets.
- The frontend ships a valid web app manifest with CipherSpace names, theme/background colors, standalone display mode, 192px/512px PNG icons, a maskable icon, an Apple touch icon, and safe-area viewport metadata.
- Production builds register a static-only service worker with an app-shell/offline fallback. It caches generated frontend assets, icons, the manifest, and a plaintext-free offline page while explicitly bypassing `/api/*`, `/health`, non-GET, and cross-origin requests.
- A reproducible icon generator and `npm run check:pwa` validate required built manifest fields, icon dimensions/purpose, iOS metadata, service-worker safety exclusions, and offline assets.
- Authenticated users can list and create workspaces, open workspace details, and view the backend-supported member directory with role labels.
- Workspace note pages list the durable local cache, show explicit loading/error/empty/offline states, and expose cached encrypted server-version metadata separately from the local editor payload.
- Local and server-backed note envelopes are decrypted only after workspace unlock and displayed from memory. Locking immediately replaces list/detail titles with an encrypted placeholder, clears rendered editor values plus new-note/comment/conflict-merge drafts, and disables editing; wrong-key states expose no partial plaintext.
- Explicit lock, document hiding, and `pagehide` remove all unwrapped workspace keys from memory. A generation check prevents a slow create/unlock operation from restoring a key after the app was backgrounded.
- Selecting **Save local change** encrypts the current title/body with a fresh nonce and a version 2
  envelope bound to the workspace ID, note ID, and next local revision before atomically storing the
  local note and pending update. New note, queue, conflict, and resolved-conflict records persist
  ciphertext rather than plaintext.
- Owners and editors can create and edit local notes; owners can add local tombstones. Viewers remain read-only. These local actions do not call the direct encrypted-note API.
- The typed frontend API client sends credentials with every request and preserves structured backend error messages. Vite and Nginx proxy API traffic so the browser session remains same-origin.
- Frontend tests verify cookie credential handling, structured error propagation, and live auth-state cleanup on logout.
- `apps/web/src/local-storage` implements a user-scoped Dexie/IndexedDB database for workspace metadata, encrypted local note envelopes, cached encrypted versions, encrypted pending changes, per-workspace sync metadata, and encrypted unresolved/resolved conflict history.
- Owners and editors can create and edit notes locally without an API mutation. Owners can soft-delete local notes. Every mutation atomically persists the note and a pending `create_note`, `update_note`, or `delete_note` record before the UI reports success.
- Local notes, tombstones, local revisions, and pending changes survive browser reloads. Repeated edits coalesce into the existing pending update operation.
- Workspace and note pages use the local database as their durable display source and refresh caches from successful API reads. Cached pages remain editable when those API reads fail.
- Note and workspace surfaces show unsynced and conflict badges based on durable local records.
- Conflict badges open a dedicated resolution view showing the preserved local snapshot, the client-decrypted remote snapshot, and remote/base version metadata.
- Keep-local, accept-remote, and manual-merge actions atomically preserve resolution history, retire conflicting queue entries, rebase one new local version to the remote version, and leave it pending for encrypted sync.
- Editing is paused on an unresolved note conflict so users choose a resolution before creating more ordinary edits. Sync status reports `conflict` until the unresolved count clears.
- Note mutations encrypt create/update snapshots through `@cipherspace/crypto` before IndexedDB persistence. Opening a workspace first scans notes, pending changes, and conflicts for legacy plaintext and blocks note, comment, conflict, and sync routes until those records are handled. After the original key is unlocked, migration validates every legacy payload, verifies any existing envelope, atomically writes encrypted envelopes, clears the plaintext fields, and performs a post-write scan. A malformed, mismatched, wrong-key, or concurrently changed record aborts the migration without overwriting source data. If the original key cannot be recovered or migration cannot complete, the UI offers a separately confirmed deletion of all active local records for affected notes; it never creates a replacement key or silently deletes data. Comments are online-only and have no IndexedDB records to scan.
- The workspace UI creates a random workspace key, protects it locally under a separate unlock password, unlocks it after reload, and supplies the in-memory key to the sync engine.
- After account authentication, the client compares the current user's registered public identity
  with the protected identity in user-scoped IndexedDB. A newly registered account with neither is
  offered explicit first-device setup; setup generates the versioned RSA-OAEP identity locally,
  registers only its SPKI public key, and encrypts its PKCS8 private key in IndexedDB with a PBKDF2
  key derived locally from the account password. Workspace creation stays disabled until the local
  and registered identities match.
- Owners fetch an existing user's registered public key, wrap the already-unlocked workspace AES key with RSA-OAEP, and atomically upload the ciphertext while adding membership. The API stores no plaintext workspace or identity private key.
- A recipient retrieves only their active share, unlocks their client-only identity private key, unwraps the same logical workspace key, and protects it with their own independent local workspace password before using the normal lock/unlock flow.
- The Account / Security recovery page reports both local-private-key and backend-public-key state,
  distinguishing first-device setup, incomplete registration, matching identity, recovery-required,
  mismatch, and unavailable status. It exports a strict version 1 JSON kit containing public
  identity metadata and the PKCS8 private key encrypted under a separate recovery passphrase, as
  either a download or copyable text. It never serializes workspace keys, notes, comments,
  passwords, or auth tokens.
- A logged-in user can import that kit on a new browser/device. Import validates the strict schema
  and account ID, decrypts and verifies the key pair locally, compares the public key with the
  backend identity (or registers it if absent), re-protects the private key with the current account
  password, and then stores it in user-scoped IndexedDB. Existing local identity records require an
  explicit overwrite confirmation.
- A missing local identity with no backend public key is first-device setup and offers identity
  creation. A missing local identity when the backend already has a public key is a new-device or
  lost-browser-data state and directs the user to recovery import. It warns that a new unrelated
  identity cannot open existing shares. Replacement identity plus member re-sharing is not exposed
  because the backend and crypto format do not yet support a versioned identity migration. After
  first-device setup, the workspace page recommends exporting a recovery kit.
- Legacy memberships expose `missing` key-share status and can be repaired by an owner. A missing local key cannot initialize an existing/shared workspace; initialization is allowed only for a new empty one-owner workspace.
- An explicit **Sync** action pushes pending encrypted operations, pulls remote events from the durable cursor, and exposes `idle`, `syncing`, `synced`, `conflict`, `failed`, or `locked`. Dexie live queries update unsynced and conflict counts after sync or resolution state transitions.
- The last verified non-secret user profile is cached to select the correct local data scope during a network outage; online requests still require the backend's HTTP-only session and authorization.
- Local storage tests use `fake-indexeddb` and cover encrypted creation/editing, absence of plaintext in note and queue records, legacy plaintext migration after unlock, database reopen/reload durability, tombstone deletion, protected-key persistence, and unlock after database reopen.
- `GET /health` checks PostgreSQL connectivity and returns `200` when the database is reachable or `503` when it is unavailable.
- Production deployment configuration supports a pooled hosted-Postgres `DATABASE_URL`, an optional direct `MIGRATIONS_DATABASE_URL`, and a bounded `DATABASE_POOL_MAX`.
- Compiled deployment scripts run checksum-verified migrations before API startup. The API Docker image uses the same `start:deploy` path.
- `render.yaml` describes a free Docker API service with generated session secret, explicit hosted-database/CORS inputs, trusted proxy handling, and `/health` readiness checks.
- The frontend accepts a validated, public build-time `VITE_API_BASE_URL`; an empty value retains the existing local Vite/Nginx same-origin proxy behavior.
- Static builds include provider-readable security headers, and `docs/DEPLOYMENT.md` documents the Neon + Render + Cloudflare Pages beta path, migrations, health checks, functional verification, and free-tier constraints.
- PostgreSQL access uses a small `pg` connection-pool adapter.
- An ordered SQL migration runner records migration filenames and checksums in `schema_migrations`.
- The initial migration prepares `users`, `workspaces`, `workspace_members`, `encrypted_notes`, `note_versions`, and `sync_changes`, with foreign keys, constraints, and lookup indexes.
- Migration `0005_note_sync_protocol.sql` adds durable operation outcomes and request fingerprints for idempotent note sync.
- The authentication migration makes `users.password_hash` required and adds expiring `sessions` records with token-digest, user, and expiry indexes.
- Docker Compose runs the API and PostgreSQL 16, waits for database readiness, and applies migrations before API startup.
- Docker Compose binds web, API, and PostgreSQL ports to loopback by default. The API runtime runs as the unprivileged `node` user with a read-only root filesystem, dropped capabilities, `no-new-privileges`, and a temporary `/tmp` mount. The Nginx frontend sends a restrictive browser-header policy.
- Users can register and log in with a normalized email and a 12-to-128-character password through `/api/auth/register` and `/api/auth/login`.
- Passwords are stored as Argon2id hashes with explicit 19 MiB memory, two-iteration, one-lane, 32-byte-hash parameters. Plaintext passwords are neither persisted nor returned.
- Registration and login create database-backed opaque sessions in host-only, HTTP-only, high-priority cookies. Only HMAC-SHA-256 token digests are stored; production cookies are also marked `Secure`. Same-site policy defaults to `strict` and can be explicitly set to `none` for the documented separate HTTPS frontend/API deployment.
- Registration and login share a configurable IP-based rate limit (10 attempts per 60 seconds by default). The current limiter is in-memory and per API process.
- Credentialed CORS accepts only exact configured origins, rejects wildcards/path origins/embedded credentials, and requires an explicit production policy. Same-origin-only deployments may configure an empty origin list.
- Helmet applies restrictive API security headers and production HSTS. API responses are non-cacheable, auth request bodies are capped at 4 KiB, the global body limit is configurable, and malformed/oversized/unexpected failures use safe response bodies.
- Request bodies are not logged; cookie, authorization, and response cookie headers are redacted. Unexpected errors log only an error class plus request metadata rather than exception messages or submitted envelopes.
- `GET /api/auth/me` returns the authenticated user, and `POST /api/auth/logout` invalidates the current session.
- Authenticated users can create and list their own workspaces through `/api/workspaces`; the creator is atomically added as the first owner.
- Workspace members can read workspace details and membership lists. Non-members receive a not-found response for workspace-scoped reads.
- Owners can immediately add existing users by normalized email or user ID only with a recipient-specific encrypted workspace-key share, assign `owner`, `editor`, or `viewer`, update roles, repair missing legacy shares, and remove members.
- Editors and viewers cannot manage membership. Transactional workspace locking prevents the final owner from being removed or downgraded, including under concurrent owner-management requests.
- The workspace migration renames the legacy single-owner column to `creator_user_id` and converts legacy `member` roles to `editor`; active ownership is represented by membership roles.
- Request validation rejects malformed emails, weak/oversized passwords, and extra credential fields. Login failures use the same response whether the email is unknown or the password is wrong.
- Vitest covers health responses; authentication behavior; workspace creation and user-scoped listing; member and non-member access; owner-managed membership; role validation; non-owner denial; and final-owner protection.
- Authenticated workspace owners and editors can create encrypted notes with an initial immutable version and append later encrypted versions. Viewers have read-only note access.
- Note lists expose server-visible metadata and optional encrypted title envelopes but omit content versions. Note detail returns metadata and the latest encrypted version, while a separate endpoint returns ordered version history.
- Every appended version receives a monotonically increasing server version number and records the previously current version as `parentVersionId`. Optional `clientVersion` metadata is retained for future client/sync work.
- Owners can soft-delete notes. Deleted notes and version rows remain in PostgreSQL but are excluded from normal list, detail, append, and history endpoints.
- Note authorization is checked against current workspace membership. Non-members receive workspace-not-found responses, viewers cannot mutate notes, and only owners can delete notes.
- The backend validates UUIDs, strict request shapes, canonical base64, version 1 or 2 AES-GCM
  metadata, exact 12-byte nonces, minimum authentication-tag length, and decoded ciphertext limits
  without decrypting or interpreting note data. Version 2 direct creates require the client-selected
  object ID needed before encryption.
- Vitest also covers owner/editor note creation, viewer mutation denial, non-member denial, version appends and parent chains, viewer history access, owner-only deletion, and deleted-note filtering.
- Sync route tests cover accepted push, pull, opaque cursor continuation, repeated-push idempotency, stale-base conflict detection, and non-member denial.
- Frontend sync tests cover crypto-package preparation, successful status transition, cursor persistence across database reopen, safe retry metadata, conflict snapshots, protection of unsynced drafts during pull, all three resolution choices, remote snapshot decryption, and successful sync of a resolved version.
- Root npm scripts provide development, build, type-check, test, and migration commands.
- `packages/crypto` contains browser-compatible TypeScript wrappers around the platform Web Crypto API and has no runtime dependencies.
- The crypto package generates extractable AES-256-GCM workspace keys and fresh 96-bit nonces,
  encrypts and decrypts UTF-8 note/comment content with 128-bit authentication tags, and serializes
  strict version 2 envelopes as canonical base64. Version 1 envelopes remain readable as legacy
  data.
- Version 2 deterministic AES-GCM AAD binds notes to content class, workspace ID, note ID, local
  revision, algorithm, envelope version, and key version. It binds comments to content class,
  workspace ID, note ID, comment ID, author ID, optional parent comment ID, algorithm, envelope
  version, and key version. Runtime validation rejects missing/extra context, unsupported algorithms
  or versions, malformed base64, incorrect nonce lengths, oversized ciphertext, tampering, wrong
  keys, and metadata swaps without returning plaintext.
- Raw 32-byte workspace keys can be exported and imported for wrapping. The v1 local flow protects them with PBKDF2-HMAC-SHA-256 (random 128-bit salt, 600,000 iterations) and AES-256-GCM before IndexedDB persistence; unwrapped keys remain in memory only.
- RSA-OAEP-3072/SHA-256 member wrapping, local recipient setup, and manual encrypted identity transfer through recovery kits are implemented. Automatic device pairing, identity replacement, parameter migration, key rotation, and cryptographic revocation are not.
- Crypto unit tests cover Unicode and empty-content round trips, fresh nonce use, key generation and portability, protected-key round trips, wrong password/context, wrong-key and ciphertext-authentication failures, and malformed payloads.
- Migration `0006_encrypted_comments.sql` adds note-scoped encrypted comments, optional same-note parent links, role-safe content lifecycle constraints, and indexes for ordered discussion reads.
- Migration `0007_workspace_key_sharing.sql` adds versioned public user identities and recipient-specific workspace key shares with sender/recipient version metadata and revocation timestamps.
- Owners and editors can create encrypted comments. All workspace members can list comments on active notes; viewers remain read-only and non-members receive workspace-not-found responses.
- Editors can soft-delete their own comments, while owners can soft-delete any comment. Deletion preserves the thread placeholder and metadata but clears ciphertext, nonce, and encryption metadata from PostgreSQL and API responses.
- The note detail UI lists and decrypts comments after workspace unlock, supports parent-linked replies, updates query state immediately after create/delete, and shows role-aware controls.
- Comment encryption uses AES-256-GCM through `@cipherspace/crypto` with fresh 96-bit nonces and the
  version 2 comment context. Focused crypto tests verify round trips, fresh nonces, separation from
  note envelopes, and failure after changing the note, comment, author, or parent-thread metadata.
- Comments deliberately use direct authenticated API calls and TanStack Query rather than IndexedDB or the note sync engine. A note must have a server version before discussion is enabled. Drafts exist only in component state, so comments require a live connection and have no offline retry or conflict behavior.

The established stack is React, TypeScript, Vite, React Router, TanStack Query, Dexie, and IndexedDB for the frontend, plus Node.js 22+, Fastify, `pg`, PostgreSQL, Zod environment validation, Argon2id password hashing, database-backed cookie sessions, exact-origin CORS, Helmet security headers, auth rate limiting, and Vitest. `fake-indexeddb` provides deterministic local persistence tests.

## MVP Scope

The v1 MVP should prove the core local-first encrypted notes workflow without attempting full enterprise collaboration.

Included in v1:

- User accounts with email and password authentication.
- Workspace creation by an authenticated user.
- Workspace member invitations by email.
- Client-side encryption of note content before upload.
- Create, edit, list, and delete encrypted notes.
- Local durable note storage for offline reading and editing.
- Explicit sync from local changes to a backend when online.
- Version-based conflict detection.
- Manual conflict resolution when concurrent edits occur.
- Basic note version history.
- Basic workspace role model: owner, editor, and viewer.
- Server-side authorization for workspace, note, and sync access.
- Encrypted comments and lightweight replies under notes.

Deferred until after the current collaboration slice:

- Offline comment persistence and sync.
- Rich-text editing beyond a simple structured document or Markdown field.
- Advanced sharing permissions.
- Recovery beyond the manual encrypted identity kit, including password reset, automatic device
  pairing, and versioned identity replacement/re-sharing.

## Non-Goals For v1

- Real-time collaborative editing.
- CRDT-based merging.
- Operational transform.
- Enterprise-grade E2EE guarantees.
- Hardware-backed keys.
- SSO, SCIM, audit-log exports, legal hold, or compliance features.
- Public note sharing links.
- Native Android/iOS apps. The web frontend is installable as a PWA.
- Background push sync.
- Attachment storage.
- Search over encrypted note bodies on the server.
- Server-side plaintext processing of note content.

## Recommended Tech Stack

The backend, frontend foundation, local persistence, client crypto, first sync protocol, local unlock, and v1 multi-user key sharing are installed:

- Frontend: TypeScript, React, Vite, React Router, TanStack Query (implemented foundation).
- Local storage: IndexedDB through Dexie.
- Backend: TypeScript, Node.js, Fastify (implemented).
- Database: PostgreSQL (implemented).
- Validation: Zod at API and sync boundaries.
- Authentication: password auth with Argon2id password hashing and secure HTTP-only sessions (implemented).
- Crypto: Web Crypto API using AES-256-GCM for content/local protection, PBKDF2-HMAC-SHA-256 for local password wrapping, RSA-OAEP-3072/SHA-256 for recipient key shares, and platform secure randomness.
- Testing: Vitest for backend and frontend unit tests (implemented); Playwright remains recommended for core browser flows.
- Formatting/linting: not established yet; add Prettier and ESLint when the broader TypeScript workspace is introduced.

## Roadmap As Independent Codex Tasks

1. Scaffold TypeScript workspace with frontend, backend, shared package, linting, formatting, and test commands. Frontend, backend, and crypto workspaces and tests are complete; a shared package, linting, and formatting remain.
2. Define shared domain types and validation schemas for users, workspaces, members, notes, versions, sync operations, and conflicts.
3. Build local IndexedDB persistence for notes, versions, pending operations, and workspace key material references. Complete, including user/workspace-scoped protected-key envelopes; raw keys are not persisted.
4. Implement client crypto helpers using Web Crypto API, including key generation, AES-GCM encryption, nonce handling, envelope formats, local password protection, RSA-OAEP user identities, member key sharing, and encrypted identity recovery kits. Complete for v1; automatic device pairing and identity replacement remain separate.
5. Add backend authentication and session management with password hashing. Complete for registration, login, current-user lookup, and current-session logout.
6. Add database schema and migrations for users, workspaces, memberships, invitations, encrypted notes, versions, devices, and sync cursors. The core backend tables are complete; invitations, devices, and sync cursors remain deferred.
7. Implement workspace creation and member invitation APIs. Workspace creation and atomic membership plus encrypted-key sharing for existing users are complete; pending invitations and email delivery remain deferred.
8. Implement encrypted note CRUD APIs without sync batching. Complete for create, list, detail/latest version, append version, version history, and soft deletion.
9. Implement local-first note editor flow that persists locally before network sync. Complete for create, edit, tombstone delete, reload durability, cached offline access, and unsynced indicators.
10. Implement sync operation queue, push/pull endpoints, idempotency, retry behavior, and manual UI invocation. Complete for explicit user-triggered sync; automatic scheduling is deferred.
11. Add version-based conflict detection and manual resolution UI. Complete for note-edit conflicts, including keep local, accept remote, manual merge, preserved resolution metadata, and resolved-version sync.
12. Add version history UI and restore-from-version behavior.
13. Add comments after note sync is stable, using encrypted content and lightweight parent-linked replies. Complete for online comments; offline comment sync and versioning remain deferred.
14. Add end-to-end tests for authentication, offline edit durability, sync, conflicts, and access control.
15. Add Docker Compose only after the backend and database shape are real. Complete for the backend foundation.
16. Add mobile-responsive layouts and a safely scoped installable PWA shell. Complete for 360px layouts, icons/manifest, static-only offline fallback, background locking, install documentation, and static installability checks.

## Known Limitations

- Initial authentication still requires the API. After a user has been verified once, the cached profile can reopen that user's local workspace/note data during an outage; this does not establish server authorization.
- Notes and comments are encrypted client-side before upload, and the backend stores ciphertext envelopes rather than plaintext content. Local note titles and bodies, pending create/update payloads, and conflict-resolution content are encrypted in IndexedDB. Operational metadata and ciphertext sizes remain visible, and ciphertext remains in the browser profile after logout.
- Browser databases created by older releases can still contain plaintext before the user handles the mandatory workspace gate. Until then, normal workspace routes remain blocked. Successful migration removes the legacy plaintext fields; explicit cleanup permanently loses unsynced/local-only data for affected notes, while encrypted server versions can be downloaded again.
- Workspace lock removes the unwrapped key from memory and hides readable note UI state. Backgrounding or hiding the app locks immediately, but there is no inactivity timeout while the app stays visible, hardware-backed key storage, or local ciphertext cleanup on logout. JavaScript cannot perfectly clear plaintext or keys from runtime memory, and CipherSpace cannot guarantee confidentiality on compromised devices or against malicious browser extensions. Recovery kits restore the identity used to retrieve server-held shares, not currently unlocked workspace keys, forgotten local workspace passwords, or unsynced local-only data.
- PWA installation requires a secure context in deployment. Provider/browser install UI and cross-site-cookie behavior vary, and the service worker offers static-shell navigation fallback rather than background sync or offline comments.
- The frontend has focused API-client and auth-state unit coverage but no automated browser end-to-end coverage yet.
- Authentication is intentionally basic: there is no email verification, password reset/recovery, breached-password check, MFA, multi-session listing/revocation, or automatic expired-session cleanup. Rate limiting is per-process memory rather than a shared distributed store.
- The free private-beta topology uses cross-site provider domains and therefore `SameSite=None`. Browser third-party-cookie controls may still block sessions, and the relaxed cookie policy leaves logout CSRF as a documented residual risk; exact credentialed CORS and JSON/preflight boundaries must not be loosened.
- Free hosting has cold starts, storage/compute/build limits, ephemeral API filesystems, and no SLA. Provider quotas and policies can change after this documentation is published.
- Authorization is implemented for workspace, membership, note, note-version, comment, and sync endpoints. Non-members receive workspace-not-found responses.
- Push/pull, retry state, cursor advancement, idempotency, conflict detection, local key unlock, manual sync, and manual note-edit conflict resolution are implemented. Automatic scheduling and automatic merging are not.
- The editor never directly submits its plaintext payload, and note endpoints cannot verify that callers encrypted meaningful plaintext correctly.
- A recipient can provision the same workspace key on another browser after importing a matching encrypted recovery kit. There is no key transparency or strong protection against substituted public keys. Automatic pairing, server escrow, account-password recovery, identity replacement, parameter migration, rotation, cryptographic revocation, and cryptographic deletion are absent; removing a member cannot erase old keys or data already retained by that member.
- Losing the account password, local workspace password, both the private identity and usable recovery kit, or unsynced browser data can still make ciphertext/data unrecoverable. A newly generated identity cannot decrypt shares made for the lost key.
- Direct version appends still parent to the current version and do not perform sync base checks or idempotency. They now emit pull events; clients requiring conflict protection must mutate through the sync endpoint.
- Soft-deleted note ciphertext and history remain stored and are not available through normal note endpoints. Restore, purge, and cryptographic deletion are not implemented.
- Server change events and idempotency outcomes are durable. Pull cursors and conflict records are device-local in IndexedDB rather than server cursor/conflict tables.
- Pending invitations, email delivery, offline comment sync, and delete-conflict resolution remain planned. Adding a member requires an existing account with a registered public identity and takes effect immediately with an encrypted key share.
- Comment bodies are encrypted before transport, but comment IDs, note/workspace links, authors, parent links, timestamps, deletion state, ciphertext sizes, and discussion activity remain server-visible metadata. Comments are not cached in IndexedDB and cannot be created or read offline.
- Browser storage schema version 2 upgrades version 1 pending records with retry fields and adds conflict/client metadata; version 3 adds protected workspace-key envelopes; version 4 adds conflict-resolution metadata; version 5 adds encrypted local/resolved payload fields; version 6 adds protected user identity records. Legacy plaintext note, queue, and conflict payloads are encrypted and cleared lazily after a successful workspace unlock because a Dexie schema upgrade cannot access the in-memory workspace key.
- Route tests use in-memory auth, workspace, and note repositories; database migration execution and an end-to-end note API flow are verified manually through the local PostgreSQL setup rather than an automated integration test.
- Authentication, local encryption, identity generation, recovery export/import, wrong-passphrase
  and malformed-kit failure, non-overwrite behavior, recovered-identity workspace-share decryption,
  wrapping/unwrapping, context-bound note/comment decryption, ciphertext-swap rejection, public-key
  APIs, key-share authorization, and role regressions have automated coverage. The private-beta
  design has not received an independent security audit or cryptographic review. Its current model
  mainly protects against passive backend or database inspection, not actively malicious hosting,
  backend behavior, or frontend delivery.
- v1 intentionally accepts metadata leakage described in `docs/THREAT_MODEL.md`.

