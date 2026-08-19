# Project State

CipherSpace now has a runnable React frontend foundation, Fastify backend, PostgreSQL persistence, user authentication, workspace membership management, encrypted-note/version APIs, and an isolated client-side crypto package. Frontend encryption integration, key sharing, local persistence, and local-first sync remain in the planning phase.

## Current Status

- `apps/api` contains a TypeScript/Node.js Fastify service.
- `apps/web` contains a React and TypeScript Vite application using React Router and TanStack Query.
- The frontend includes login and registration pages, HTTP-only cookie session bootstrap/logout, protected routing, a responsive authenticated layout, and basic navigation.
- Authenticated users can list and create workspaces, open workspace details, and view the backend-supported member directory with role labels.
- Workspace note pages list active encrypted-note metadata, show explicit loading/error/empty states, and provide a detail shell for the latest opaque version envelope.
- Owners and editors can create a note through a development-only form that maps to the existing encrypted-note API. The form uses opaque base64 placeholders and performs no encryption or plaintext processing; viewers receive a read-only state.
- The typed frontend API client sends credentials with every request and preserves structured backend error messages. Vite and Nginx proxy API traffic so the browser session remains same-origin.
- Frontend tests verify cookie credential handling, structured error propagation, and live auth-state cleanup on logout.
- `GET /health` checks PostgreSQL connectivity and returns `200` when the database is reachable or `503` when it is unavailable.
- PostgreSQL access uses a small `pg` connection-pool adapter.
- An ordered SQL migration runner records migration filenames and checksums in `schema_migrations`.
- The initial migration prepares `users`, `workspaces`, `workspace_members`, `encrypted_notes`, `note_versions`, and `sync_changes`, with foreign keys, constraints, and lookup indexes.
- The authentication migration makes `users.password_hash` required and adds expiring `sessions` records with token-digest, user, and expiry indexes.
- Docker Compose runs the API and PostgreSQL 16, waits for database readiness, and applies migrations before API startup.
- Users can register and log in with a normalized email and a 12-to-128-character password through `/api/auth/register` and `/api/auth/login`.
- Passwords are stored as Argon2id hashes. Plaintext passwords are neither persisted nor returned.
- Registration and login create database-backed opaque sessions in HTTP-only, `SameSite=Lax` cookies. Only HMAC-SHA-256 token digests are stored; production cookies are also marked `Secure`.
- `GET /api/auth/me` returns the authenticated user, and `POST /api/auth/logout` invalidates the current session.
- Authenticated users can create and list their own workspaces through `/api/workspaces`; the creator is atomically added as the first owner.
- Workspace members can read workspace details and membership lists. Non-members receive a not-found response for workspace-scoped reads.
- Owners can immediately add existing users by normalized email or user ID, assign `owner`, `editor`, or `viewer`, update roles, and remove members.
- Editors and viewers cannot manage membership. Transactional workspace locking prevents the final owner from being removed or downgraded, including under concurrent owner-management requests.
- The workspace migration renames the legacy single-owner column to `creator_user_id` and converts legacy `member` roles to `editor`; active ownership is represented by membership roles.
- Request validation rejects malformed emails, weak/oversized passwords, and extra credential fields. Login failures use the same response whether the email is unknown or the password is wrong.
- Vitest covers health responses; authentication behavior; workspace creation and user-scoped listing; member and non-member access; owner-managed membership; role validation; non-owner denial; and final-owner protection.
- Authenticated workspace owners and editors can create encrypted notes with an initial immutable version and append later encrypted versions. Viewers have read-only note access.
- Note lists expose server-visible metadata and optional encrypted title envelopes but omit content versions. Note detail returns metadata and the latest encrypted version, while a separate endpoint returns ordered version history.
- Every appended version receives a monotonically increasing server version number and records the previously current version as `parentVersionId`. Optional `clientVersion` metadata is retained for future client/sync work.
- Owners can soft-delete notes. Deleted notes and version rows remain in PostgreSQL but are excluded from normal list, detail, append, and history endpoints.
- Note authorization is checked against current workspace membership. Non-members receive workspace-not-found responses, viewers cannot mutate notes, and only owners can delete notes.
- The backend validates UUIDs, strict request shapes, base64 encoding, envelope metadata, and decoded ciphertext/nonce size limits without decrypting or interpreting note data.
- Vitest also covers owner/editor note creation, viewer mutation denial, non-member denial, version appends and parent chains, viewer history access, owner-only deletion, and deleted-note filtering.
- Root npm scripts provide development, build, type-check, test, and migration commands.
- `packages/crypto` contains browser-compatible TypeScript wrappers around the platform Web Crypto API and has no runtime dependencies.
- The crypto package generates extractable AES-256-GCM workspace keys and fresh 96-bit nonces, encrypts and decrypts UTF-8 note content with 128-bit authentication tags, and serializes strict version 1 envelopes as canonical base64.
- Fixed envelope metadata is authenticated as AES-GCM additional data. Runtime validation rejects missing or extra fields, unsupported algorithms or versions, malformed base64, incorrect nonce lengths, oversized ciphertext, tampering, and wrong keys without returning plaintext.
- Raw 32-byte workspace keys can be exported and imported to support a future wrapping flow. Secure key persistence, member wrapping and sharing, recovery, rotation, and revocation are explicitly not implemented.
- Crypto unit tests cover Unicode and empty-content round trips, fresh nonce use, key generation and portability, wrong-key and ciphertext-authentication failures, and malformed payloads.

The established stack is React, TypeScript, Vite, React Router, and TanStack Query for the frontend, plus Node.js 22+, Fastify, `pg`, PostgreSQL, Zod environment validation, Argon2id password hashing, database-backed cookie sessions, and Vitest for the backend. This frontend slice is intentionally online-only and uses the session model selected in the architecture documentation.

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

Deferred until after notes, encryption, and sync are stable:

- Comments on notes.
- Rich-text editing beyond a simple structured document or Markdown field.
- Advanced sharing permissions.
- Recovery flows beyond a clearly documented password-reset limitation.

## Non-Goals For v1

- Real-time collaborative editing.
- CRDT-based merging.
- Operational transform.
- Enterprise-grade E2EE guarantees.
- Hardware-backed keys.
- SSO, SCIM, audit-log exports, legal hold, or compliance features.
- Public note sharing links.
- Mobile apps.
- Background push sync.
- Attachment storage.
- Search over encrypted note bodies on the server.
- Server-side plaintext processing of note content.

## Recommended Tech Stack

The backend and initial frontend portions of this stack are installed; local-first and client-crypto choices remain recommendations:

- Frontend: TypeScript, React, Vite, React Router, TanStack Query (implemented foundation).
- Local storage: IndexedDB through Dexie.
- Backend: TypeScript, Node.js, Fastify (implemented).
- Database: PostgreSQL (implemented).
- Validation: Zod at API and sync boundaries.
- Authentication: password auth with Argon2id password hashing and secure HTTP-only sessions (implemented).
- Crypto: Web Crypto API using AES-256-GCM for authenticated encryption and platform secure randomness (primitive package implemented; application integration and key sharing remain).
- Testing: Vitest for backend and frontend unit tests (implemented); Playwright remains recommended for core browser flows.
- Formatting/linting: not established yet; add Prettier and ESLint when the broader TypeScript workspace is introduced.

## Roadmap As Independent Codex Tasks

1. Scaffold TypeScript workspace with frontend, backend, shared package, linting, formatting, and test commands. Frontend, backend, and crypto workspaces and tests are complete; a shared package, linting, and formatting remain.
2. Define shared domain types and validation schemas for users, workspaces, members, notes, versions, sync operations, and conflicts.
3. Build local IndexedDB persistence for notes, versions, pending operations, and workspace key material references.
4. Implement client crypto helpers using Web Crypto API, including key generation, AES-GCM encryption, nonce handling, and envelope formats. Complete as the isolated `@cipherspace/crypto` package; frontend and key-sharing integration remain separate tasks.
5. Add backend authentication and session management with password hashing. Complete for registration, login, current-user lookup, and current-session logout.
6. Add database schema and migrations for users, workspaces, memberships, invitations, encrypted notes, versions, devices, and sync cursors. The core backend tables are complete; invitations, devices, and sync cursors remain deferred.
7. Implement workspace creation and member invitation APIs. Workspace creation and immediate membership of existing users are complete; pending invitations and email delivery remain deferred.
8. Implement encrypted note CRUD APIs without sync batching. Complete for create, list, detail/latest version, append version, version history, and soft deletion.
9. Implement local-first note editor flow that persists locally before network sync.
10. Implement sync operation queue, push/pull endpoints, idempotency, and retry behavior.
11. Add version-based conflict detection and manual resolution UI.
12. Add version history UI and restore-from-version behavior.
13. Add comments after note sync is stable, using the same encrypted-content and version-aware model.
14. Add end-to-end tests for authentication, offline edit durability, sync, conflicts, and access control.
15. Add Docker Compose only after the backend and database shape are real. Complete for the backend foundation.

## Known Limitations

- The frontend currently requires a reachable API and has no offline or local-first behavior.
- The development note form does not encrypt its inputs. It only exercises the opaque backend envelope contract and must not be used for sensitive plaintext.
- The frontend has focused API-client and auth-state unit coverage but no automated browser end-to-end coverage yet.
- Authentication is intentionally basic: there is no email verification, password reset/recovery, rate limiting, multi-session listing/revocation, or automatic expired-session cleanup.
- Cookie sessions rely on `SameSite=Lax`; add an explicit CSRF strategy before introducing sensitive cross-site-compatible mutation flows.
- Authorization is implemented for workspace, membership, note, and note-version endpoints. Future sync endpoints must apply the same membership boundary.
- No sync APIs exist yet.
- Client encryption primitives are implemented but are not connected to the frontend note flow. The development form still submits opaque placeholders, and note endpoints cannot verify that callers encrypted meaningful plaintext correctly.
- Workspace key creation during workspace setup, secure key persistence, key wrapping and member sharing, passphrase-based unlock, recovery, rotation, revocation, and cryptographic deletion are not implemented. Raw key exports must not be persisted or transmitted unwrapped.
- Direct version appends always parent the new version to the current server version. They do not accept a base version, detect conflicts, provide idempotency, or resolve concurrent edits; those behaviors remain part of the future sync protocol.
- Soft-deleted note ciphertext and history remain stored and are not available through normal note endpoints. Restore, purge, and cryptographic deletion are not implemented.
- `sync_changes` is persistence groundwork only; there are no sync endpoints, device cursors, idempotency handling, or conflict records yet.
- Pending invitations, email delivery, comments, conflicts, and key shares are planned but intentionally have no tables or behavior in this slice. Adding a member currently requires an existing account and takes effect immediately.
- Local-first client storage is not implemented.
- Route tests use in-memory auth, workspace, and note repositories; database migration execution and an end-to-end note API flow are verified manually through the local PostgreSQL setup rather than an automated integration test.
- Authentication has automated behavior coverage but has not received an independent security review. Planned encryption and collaboration security properties remain unimplemented.
- v1 intentionally accepts metadata leakage described in `docs/THREAT_MODEL.md`.

