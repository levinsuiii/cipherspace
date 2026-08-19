# Project State

CipherSpace now has a runnable backend, PostgreSQL foundation, and basic user authentication. Collaboration and encrypted-note features remain in the planning phase.

## Current Status

- `apps/api` contains a TypeScript/Node.js Fastify service.
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
- Request validation rejects malformed emails, weak/oversized passwords, and extra credential fields. Login failures use the same response whether the email is unknown or the password is wrong.
- Vitest covers health responses plus registration, password hashing, login, duplicate email handling, validation, authenticated access, raw-token non-persistence, and logout.
- Root npm scripts provide development, build, type-check, test, and migration commands.

The backend stack decision is now established as TypeScript, Node.js 22+, Fastify, `pg`, PostgreSQL, Zod environment validation, Argon2id password hashing, database-backed cookie sessions, and Vitest. This keeps the implementation backend-only and uses the session model selected in the architecture documentation.

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
- Basic workspace role model: owner and member.
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

The backend portion of this stack is installed; frontend and client-side choices remain recommendations:

- Frontend: TypeScript, React, Vite, React Router, TanStack Query.
- Local storage: IndexedDB through Dexie.
- Backend: TypeScript, Node.js, Fastify (implemented).
- Database: PostgreSQL (implemented).
- Validation: Zod at API and sync boundaries.
- Authentication: password auth with Argon2id password hashing and secure HTTP-only sessions (implemented).
- Crypto: Web Crypto API in the browser, using AES-GCM for authenticated encryption and platform secure randomness.
- Testing: Vitest for backend tests (implemented); Playwright for core browser flows once a UI exists.
- Formatting/linting: not established yet; add Prettier and ESLint when the broader TypeScript workspace is introduced.

## Roadmap As Independent Codex Tasks

1. Scaffold TypeScript workspace with frontend, backend, shared package, linting, formatting, and test commands. Backend scaffold and test commands are complete; frontend, shared package, linting, and formatting remain.
2. Define shared domain types and validation schemas for users, workspaces, members, notes, versions, sync operations, and conflicts.
3. Build local IndexedDB persistence for notes, versions, pending operations, and workspace key material references.
4. Implement client crypto helpers using Web Crypto API, including key generation, AES-GCM encryption, nonce handling, and envelope formats.
5. Add backend authentication and session management with password hashing. Complete for registration, login, current-user lookup, and current-session logout.
6. Add database schema and migrations for users, workspaces, memberships, invitations, encrypted notes, versions, devices, and sync cursors. The core backend tables are complete; invitations, devices, and sync cursors remain deferred.
7. Implement workspace creation and member invitation APIs.
8. Implement encrypted note CRUD APIs without sync batching.
9. Implement local-first note editor flow that persists locally before network sync.
10. Implement sync operation queue, push/pull endpoints, idempotency, and retry behavior.
11. Add version-based conflict detection and manual resolution UI.
12. Add version history UI and restore-from-version behavior.
13. Add comments after note sync is stable, using the same encrypted-content and version-aware model.
14. Add end-to-end tests for authentication, offline edit durability, sync, conflicts, and access control.
15. Add Docker Compose only after the backend and database shape are real. Complete for the backend foundation.

## Known Limitations

- Only the backend foundation is runnable; no frontend exists.
- Authentication is intentionally basic: there is no email verification, password reset/recovery, rate limiting, multi-session listing/revocation, or automatic expired-session cleanup.
- Cookie sessions rely on `SameSite=Lax`; add an explicit CSRF strategy before introducing sensitive cross-site-compatible mutation flows.
- Authorization beyond checking whether a session belongs to a current user is not implemented because workspace-scoped APIs are still deferred.
- No workspace, note, version, or sync APIs exist yet.
- Encryption and key-sharing logic are not implemented; byte columns only reserve storage for future client-encrypted envelopes.
- `sync_changes` is persistence groundwork only; there are no sync endpoints, device cursors, idempotency handling, or conflict records yet.
- Comments, conflicts, invitations, and key shares are planned but intentionally have no tables or behavior in this slice.
- Local-first client storage is not implemented.
- Route tests use an in-memory auth repository; database migration execution is verified through the local PostgreSQL setup rather than an automated integration test.
- Authentication has automated behavior coverage but has not received an independent security review. Planned encryption and collaboration security properties remain unimplemented.
- v1 intentionally accepts metadata leakage described in `docs/THREAT_MODEL.md`.

