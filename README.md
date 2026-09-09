# CipherSpace

CipherSpace is an end-to-end encrypted collaborative note and workspace application developed as a personal software project. It combines local-first note editing with an authenticated API and encrypted multi-user workspace-key sharing.

## What CipherSpace does

- Organizes users and notes into role-based workspaces.
- Encrypts note titles, note bodies, comments, and replies in the browser before upload.
- Stores encrypted local note state and pending changes in IndexedDB so note editing can continue offline.
- Synchronizes encrypted note versions with a PostgreSQL-backed API when the user requests it.
- Detects concurrent note edits and provides explicit keep-local, accept-remote, and manual-merge choices.
- Shares a workspace key with existing members by encrypting it for each member's public key.
- Supports manual transfer of a user's encryption identity through an encrypted recovery kit.

Comments currently use the online API directly and are not part of offline note synchronization.

## Current status

CipherSpace is a prototype under active development. The main application flow is runnable and covered by automated tests, but the project is not production-ready and has not received an independent security audit.

Important unfinished areas include automatic device pairing, identity replacement, key rotation, cryptographic revocation after member removal, automatic background synchronization, and offline comments. See [Project State](docs/PROJECT_STATE.md) for the implemented scope and known limitations.

## Architecture

```text
Browser client (React, IndexedDB, Web Crypto)
                    |
                    | HTTPS/JSON and session cookie
                    v
             Fastify API
                    |
                    v
               PostgreSQL
```

Note and comment encryption and decryption happen in the browser. The API validates authorization and encrypted-envelope structure, coordinates synchronization and version ordering, and stores ciphertext together with the metadata required for collaboration. IndexedDB holds the browser's encrypted local note state, sync queue, conflicts, and locally protected key material.

The component boundaries and data model are described in [Architecture](docs/ARCHITECTURE.md). The note synchronization rules are documented in [Sync Protocol](docs/SYNC_PROTOCOL.md).

## Nutzung

Eine kurze Anleitung zur Bedienung befindet sich unter
[docs/NUTZUNGSANLEITUNG.md](docs/NUTZUNGSANLEITUNG.md).

## Security model

New note and comment content uses AES-256-GCM envelopes created through the Web Crypto API. Each workspace has a symmetric key; for multi-user access, the client wraps that key separately for each recipient using the recipient's registered RSA-OAEP-3072 public key. Private identity keys and workspace keys are protected locally before IndexedDB persistence.

The server stores ciphertext, account password hashes, session-token digests, public identity keys, memberships, version information, timestamps, and other operational metadata. Workspace names, membership relationships, object identifiers, activity timing, and ciphertext sizes remain visible to it.

The current design mainly protects content against passive backend or database inspection. It does not fully protect against an active malicious server or hosting path that substitutes public keys or delivers modified client code. Member removal revokes API access but cannot erase keys or data a former member already obtained. Compromised devices, browser extensions, recovery files, or unlocked clients are also outside the protection the application can provide.

The complete trust boundary, assumptions, and known weaknesses are recorded in [Threat Model](docs/THREAT_MODEL.md).

## Technology

- Node.js 22, TypeScript, and npm workspaces
- React, Vite, React Router, TanStack Query, Dexie, and IndexedDB
- Fastify, PostgreSQL, Zod, and Argon2
- Web Crypto API with AES-GCM, RSA-OAEP, and PBKDF2-based local key protection
- Vitest and Testing Library
- Docker Compose, Nginx, and Render deployment configuration

## Running locally

Prerequisites:

- Node.js 22 or newer
- npm 10 or newer
- Docker with Docker Compose

### Docker Compose

Create a local environment file from the public template, replace its development session secret with a freshly generated value, and start the stack:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Paste the generated value into SESSION_SECRET in .env.
docker compose up --build
```

Open `http://localhost:8080`. The API is also exposed locally at `http://localhost:3000`; both ports bind to loopback by default.

Stop the stack with `docker compose down`. `docker compose down --volumes` also removes the local PostgreSQL volume and its development data.

### Run the applications separately

After creating `.env` as above:

```powershell
npm ci
docker compose up -d postgres
npm run db:migrate
```

Run the API and frontend in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open `http://localhost:5173`. Vite proxies `/api` and `/health` to the API at `http://localhost:3000`.

### Verification commands

```powershell
npm test
npm run typecheck
npm run build
npm run check:pwa
```

The repository currently has no separate lint script.

## Deployment

The included deployment model uses a static frontend, a Docker-based API, and managed PostgreSQL. `render.yaml`, the application Dockerfiles, and the Nginx configuration are tracked so the build remains reproducible. Production credentials and connection strings must be supplied through the deployment provider, never committed to the repository.

See [Deployment](docs/DEPLOYMENT.md) for the topology, environment variables, migration process, verification checklist, and free-tier limitations.

## Project structure

```text
apps/
  api/       Fastify API, PostgreSQL migrations, and backend tests
  web/       React client, IndexedDB persistence, sync UI, and frontend tests
packages/
  crypto/    Browser-compatible cryptographic operations and tests
docs/        Architecture, project state, sync, threat model, and deployment notes
```

Root configuration contains the npm workspace manifest, shared TypeScript settings, local Docker Compose setup, deployment metadata, and the placeholder-only `.env.example`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data model, persistence boundaries, and design decisions
- [Project State](docs/PROJECT_STATE.md) — implemented behavior, roadmap, and known limitations
- [Sync Protocol](docs/SYNC_PROTOCOL.md) — local-first operations, idempotency, cursors, and conflict handling
- [Threat Model](docs/THREAT_MODEL.md) — assets, trusted components, mitigations, and security limitations
- [Deployment](docs/DEPLOYMENT.md) — hosted topology, configuration, and operational checks
- [Crypto package](packages/crypto/README.md) — envelope formats, API usage, and package limitations

## Security research and Bachelor's thesis context

CipherSpace also serves as a technical basis for investigating authenticated key distribution in end-to-end encrypted multi-user systems. Public-key verification, key-substitution protection, signed workspace-key envelopes, identity pinning, key transparency, and member-removal key rotation remain potential research and implementation topics; this repository does not present unfinished thesis results as established findings.

## License

No license has currently been specified for this repository. Unless a license is added, the source remains subject to the copyright holder's default rights.
