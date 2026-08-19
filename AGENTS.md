# Agent Instructions

## Project Summary

CipherSpace is a portfolio-grade, local-first encrypted collaboration workspace.

The intended product should eventually allow multiple users to:

- create accounts
- create workspaces
- invite other users to workspaces
- create encrypted notes
- edit notes offline
- sync changes later
- comment on notes
- resolve edit conflicts
- view version history

Build this project incrementally. Do not implement all features at once.

## Core Principles

- Always inspect the repository before changing files.
- Preserve existing conventions and file organization.
- Keep changes scoped to the requested task.
- Do not overengineer.
- Prefer clear, boring architecture over clever abstractions.
- Use strong typing where the stack supports it.
- Validate inputs at boundaries.
- Handle errors cleanly and explicitly.
- Add meaningful tests for important logic.
- Update documentation when behavior changes.
- Make the project runnable from a fresh clone.
- Never store plaintext secrets, private keys, tokens, passwords, or credentials in the repository.

## Repo Layout

Current repository layout:

- `README.md` - project overview.
- `AGENTS.md` - instructions for coding agents.
- `docs/ARCHITECTURE.md` - architecture notes and decisions.
- `docs/PROJECT_STATE.md` - current implementation status.
- `docs/SYNC_PROTOCOL.md` - sync model and protocol notes.
- `docs/THREAT_MODEL.md` - security assumptions, threats, and limitations.

Expected future layout may include backend, frontend, shared packages, tests, database migrations, and Docker files, but do not create those unless the user explicitly asks for that work.

## Backend Commands

The backend uses Node.js 22+, TypeScript, Fastify, and PostgreSQL.

- Install dependencies: `npm install`
- Run the backend locally: `npm run dev`
- Build the backend: `npm run build`
- Run the compiled backend: `npm start`
- Run backend tests: `npm test`
- Run backend type checks: `npm run typecheck`
- Run backend database migrations: `npm run db:migrate`

## Frontend Commands

No frontend stack or commands are established yet.

When a frontend is added, document the exact commands here, including:

- install dependencies
- run the frontend locally
- run frontend tests
- run frontend type checks
- run frontend build

Do not invent frontend commands before the frontend exists.

## Test Commands

Vitest is the backend test runner.

- Run tests once: `npm test`
- Run tests in watch mode: `npm run test:watch`

Tests should cover important logic, especially:

- encryption and decryption integration with established libraries
- input validation
- note editing behavior
- offline persistence
- sync protocol logic
- conflict detection and resolution
- access control decisions
- error handling paths

If a task changes behavior and tests cannot be added yet because the stack is not established, clearly document that limitation in the final response and, when appropriate, in `docs/PROJECT_STATE.md`.

## Docker Compose Commands

- Start backend and PostgreSQL: `docker compose up --build`
- Start PostgreSQL only: `docker compose up -d postgres`
- Stop local services: `docker compose down`
- Reset local development data: `docker compose down --volumes`
- View logs: `docker compose logs -f`
- Run migrations in a running API container: `docker compose exec api node dist/database/migrate.js`

## Crypto And Security Rules

- Never invent cryptographic primitives, protocols, password hashing schemes, key exchange flows, or random number generators.
- Use established, reviewed crypto APIs and libraries.
- Prefer high-level authenticated encryption APIs.
- Use secure randomness from the platform or crypto library.
- Keep plaintext secrets out of source control, logs, fixtures, screenshots, and documentation examples.
- Treat encryption keys, recovery keys, access tokens, and session secrets as sensitive.
- Do not log plaintext note contents, keys, passphrases, or decrypted payloads.
- State security limitations honestly in `docs/THREAT_MODEL.md`.
- Document what is encrypted, what metadata remains visible, and which actors are trusted.
- Make threat model updates whenever authentication, authorization, encryption, storage, or sync behavior changes.
- Prefer simple, auditable security flows over complex custom designs.

## Sync Protocol Rules

- Keep the local-first model explicit: local edits should be durable before sync.
- Design sync behavior around unreliable networks and offline edits.
- Document sync assumptions in `docs/SYNC_PROTOCOL.md`.
- Define stable identifiers for users, workspaces, notes, versions, comments, and operations.
- Make conflict detection and resolution deterministic.
- Preserve enough version history to explain how a note reached its current state.
- Avoid silent data loss. Conflicts should be represented explicitly.
- Validate all incoming sync payloads.
- Treat remote data as untrusted until validated and authorized.
- Keep protocol changes backward-aware once persisted clients or data formats exist.

## Architecture Rules

- Maintain clean separation between domain logic, persistence, sync, crypto, transport, and UI.
- Keep domain logic testable without network or UI dependencies.
- Prefer small modules with clear responsibilities.
- Avoid introducing frameworks or services before they are needed.
- Keep data models explicit and typed.
- Record important architecture decisions in `docs/ARCHITECTURE.md`.
- Keep `docs/PROJECT_STATE.md` current when milestones, constraints, or setup instructions change.

## Documentation Rules

- Update docs when behavior, setup, architecture, sync, or security assumptions change.
- Keep documentation honest about what works and what is planned.
- Do not describe unimplemented features as complete.
- Include fresh-clone setup steps once runnable code exists.
- Keep portfolio-facing documentation clear, professional, and specific.

## Definition Of Done

A feature or change is done only when:

- it works locally
- relevant tests pass
- the build passes, when a build exists
- Docker/local setup still works, when Docker exists
- documentation is updated
- security limitations are stated honestly
- no unrelated features are implemented
- no plaintext secrets are committed

If any item cannot be completed because the project does not yet have the required infrastructure, state that clearly.

## Review Checklist

Before finishing a change, review:

- Scope: Does the change only do what was requested?
- Architecture: Is logic placed in the right layer?
- Typing: Are important data structures typed clearly?
- Validation: Are untrusted inputs validated?
- Errors: Are failures handled intentionally?
- Security: Are established crypto APIs used correctly?
- Secrets: Are secrets excluded from code, logs, fixtures, and docs?
- Sync: Are offline edits, retries, conflicts, and version history considered where relevant?
- Tests: Are important paths covered?
- Docs: Are behavior, setup, sync, or threat model docs updated if needed?
- Fresh clone: Can a new contributor run the project with documented steps once runnable code exists?
