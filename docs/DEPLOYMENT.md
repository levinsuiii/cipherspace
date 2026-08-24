# Free Public-Beta Deployment

This guide deploys CipherSpace at no cost with three replaceable services:

- Neon Free for managed/serverless PostgreSQL.
- Render Free for the public Docker-based API.
- Cloudflare Pages Free for the static React build.

The providers supply HTTPS and generated subdomains, so v1 does not need a custom domain. The guide reflects provider documentation checked on 2026-08-21. Free plans change; review the linked provider pages before each deployment.

This is a friends-and-family beta topology, not a production SLA. It includes the responsive installable web app, but does not add billing, native mobile apps, recovery, key rotation, or multi-user key sharing.

## Production topology

```text
Browser
  -> https://<project>.pages.dev          static frontend
  -> https://cipherspace-api.onrender.com public JSON API
       -> Neon PostgreSQL                 ciphertext, auth, and metadata
```

The browser calls the API directly with credentialed CORS. The API session cookie remains host-only to the API. Because the generated frontend and API domains are cross-site, this topology sets `SESSION_COOKIE_SAME_SITE=none`; production also makes the cookie `Secure`. Some browsers or privacy modes block cross-site cookies even with these attributes. Test every browser friends will use. A future same-site custom-domain or reverse-proxy setup is the durable answer if provider-domain cookies prove unreliable.

## Environment variables

### Backend runtime

| Variable | Production value | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables secure cookies, HSTS, and production secret validation. |
| `HOST` | `0.0.0.0` | Lets the hosting proxy reach the container. |
| `PORT` | Provider supplied | Render injects this; do not hard-code it in the dashboard. |
| `DATABASE_URL` | Secret PostgreSQL URL | Runtime database connection. Prefer Neon's pooled URL and keep `sslmode=require`. |
| `MIGRATIONS_DATABASE_URL` | Secret PostgreSQL URL | Optional direct connection for migrations. Empty or unset falls back to `DATABASE_URL`. |
| `DATABASE_POOL_MAX` | `5` | Caps API connections for a small free database. Accepted range is 1–50. |
| `SESSION_SECRET` | Random 32+ byte secret | HMAC key for session-token digests. Changing it invalidates existing sessions. |
| `SESSION_COOKIE_SAME_SITE` | `none` for separate provider domains | Allows the credentialed cross-site frontend/API flow. Local and same-site deployments should use `strict`. |
| `SESSION_TTL_HOURS` | `168` | Session lifetime; accepted range is 1–720 hours. |
| `CORS_ORIGINS` | Exact frontend origin | Comma-separated allowlist, for example `https://cipherspace.pages.dev`. Do not add a path, trailing slash, credentials, or wildcard. |
| `TRUST_PROXY` | `true` on Render | Uses the trusted edge's forwarded client IP for logging and the auth rate limiter. Keep it `false` when directly exposed. |
| `LOG_LEVEL` | `info` | API log verbosity. |
| `REQUEST_BODY_LIMIT_BYTES` | `1500000` | Global request-body ceiling. |
| `AUTH_RATE_LIMIT_MAX` | `10` | Auth attempts per in-memory window and API process. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | Authentication rate-limit window. |

`DATABASE_URL`, `MIGRATIONS_DATABASE_URL`, and `SESSION_SECRET` are secrets. Do not prefix them with `VITE_`, put them in Cloudflare Pages, or commit them. Render's Blueprint generates `SESSION_SECRET` and prompts for the other secret values on first creation.

### Frontend build

| Variable | Production value | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Public API origin | Build-time, non-secret value such as `https://cipherspace-api.onrender.com`. It must be an absolute HTTP(S) origin without a path. |
| `NODE_VERSION` | `22` | Selects the repository's supported Node.js major in the Pages build environment. |

`VITE_API_BASE_URL` is compiled into the static JavaScript bundle. Changing it requires a new frontend build and deployment. Leaving it empty preserves same-origin `/api` behavior for Vite and local Docker.

Keep this value origin-only. The frontend API client adds the shared `/api` prefix to auth, crypto identity, workspace, note, comment, key recovery, and sync requests. For example, `VITE_API_BASE_URL=https://cipherspace-api.onrender.com` produces `https://cipherspace-api.onrender.com/api/crypto/identity`; do not append `/api` to the environment variable itself.

## 1. Verify the repository locally

From the repository root:

```powershell
npm install
npm test
npm run build:production
npm run check:pwa
docker compose config
```

`check:pwa` runs against the built frontend and verifies the manifest, required icon sizes,
maskable icon, iOS metadata, service-worker API exclusions, and offline fallback assets.

For a full local check, copy `.env.example` to `.env`, replace the development `SESSION_SECRET`, and run `docker compose up --build`. Confirm `http://localhost:8080/health` returns `200`.

## 2. Create the Neon database

1. Create a project on the [Neon Free plan](https://neon.com/pricing) in a region close to the Render API region. Free currently includes scale-to-zero compute, 100 CU-hours per project per month, and 0.5 GB storage per project.
2. In the project dashboard, select **Connect**.
3. Copy the pooled connection string for `DATABASE_URL`. Neon identifies it with `-pooler` in the hostname. Keep the TLS query parameters supplied by Neon.
4. Disable pooling in the connection dialog and copy the direct connection string for `MIGRATIONS_DATABASE_URL`. Neon recommends a direct connection for schema migrations; see [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
5. Store both strings only in the deployment provider's secret settings.

CipherSpace passes the connection strings to `node-postgres`. Migration and application traffic use the same database; the separate URL only chooses the appropriate connection endpoint.

## 3. Create the initial Cloudflare Pages project

Creating the static project first gives you the exact origin needed by CORS.

1. In Cloudflare, choose **Workers & Pages → Create → Pages → Import an existing Git repository**.
2. Select this repository and production branch.
3. Keep the root directory at the repository root.
4. Set the build command to `npm run build:web`.
5. Set the output directory to `apps/web/dist`.
6. Set `NODE_VERSION=22`. Leave `VITE_API_BASE_URL` empty for this first build.
7. Deploy and record the exact production URL, such as `https://cipherspace.pages.dev`.

Cloudflare Pages recognizes the build as a single-page application because it has no top-level `404.html`, so client-side routes fall back to `index.html`. Vite copies `apps/web/public/_headers` into the build to apply the static security headers. The initial site cannot authenticate until the API URL is added in step 5.

The same build also copies the PWA manifest, icons, service worker, and offline page. The service
worker is served at the origin root so it can control application routes; `_headers` marks it
`Cache-Control: no-cache` so deployments can be discovered promptly. It never caches API responses.

See the official [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering), and [custom headers](https://developers.cloudflare.com/pages/configuration/headers/) documentation.

## 4. Deploy the Render API

The committed `render.yaml` defines a Free Docker web service, the API Dockerfile, a `/health` check, safe non-secret defaults, and prompts/generation for secrets.

1. In Render, choose **New → Blueprint** and connect this repository.
2. Confirm that the Blueprint selects the `cipherspace-api` web service on the Free plan.
3. When prompted, set:
   - `DATABASE_URL` to the Neon pooled URL.
   - `MIGRATIONS_DATABASE_URL` to the Neon direct URL.
   - `CORS_ORIGINS` to the exact Pages production origin from step 3.
4. Let Render generate `SESSION_SECRET` from `render.yaml`.
5. Create the service and wait for the Docker build and first start.

The container runs `npm run start:deploy`, which executes compiled migrations before starting Fastify. Migration filenames and checksums are recorded in `schema_migrations`; an advisory lock makes concurrent startup migration attempts serialize safely. Render's Free plan does not provide one-off jobs or dashboard shell access, so startup migrations are intentional for this beta deployment.

If configuring a Render web service manually instead of using the Blueprint, use:

- Runtime: Docker.
- Dockerfile: `apps/api/Dockerfile`.
- Docker context: repository root.
- Instance type: Free.
- Health check path: `/health`.
- The backend variables from the table above.

Render supplies `PORT`; the application reads it and binds to `0.0.0.0`. Render terminates public TLS at its edge and forwards the request to the container. See [Render web services](https://render.com/docs/web-services), [health checks](https://render.com/docs/health-checks), and [free-service limits](https://render.com/docs/free).

## 5. Verify migrations and API health

Open the Render logs. Startup should say either `Applied migrations: ...` or `Database is already up to date.` before the API begins accepting traffic.

Then request the public health endpoint:

```powershell
Invoke-RestMethod https://cipherspace-api.onrender.com/health
```

A healthy response is:

```json
{
  "database": "reachable",
  "status": "ok"
}
```

The endpoint returns `200` only when PostgreSQL answers `SELECT 1`. It returns `503` with `database: "unreachable"` when the API is running but the database cannot be reached. It does not disclose credentials or schema data.

If migrations must be run from a trusted local checkout, build first and provide all required production variables in the shell before running `npm run db:migrate:deploy`. Prefer the automatic deployment path so credentials do not need to be copied to another machine.

## 6. Point the frontend at the API

1. In the Cloudflare Pages project, add production variable `VITE_API_BASE_URL=https://cipherspace-api.onrender.com`, using the actual Render URL and no path.
2. Trigger a new production deployment. The API URL is a build-time value, so an environment update without a rebuild is insufficient.
3. Confirm the built site loads on HTTPS and browser requests target the Render origin.
4. In Render, re-check that `CORS_ORIGINS` exactly equals the final Pages production origin. If Cloudflare assigned a different name, update Render and redeploy/restart the API.

Do not add Cloudflare preview URLs broadly. CORS accepts a comma-separated list of exact origins, so add a specific preview origin only for a deliberate test and remove it afterward.

## 7. Verify CORS and session cookies

In browser developer tools, register a temporary beta account and inspect the network response:

- `Access-Control-Allow-Origin` must equal the Pages production origin.
- `Access-Control-Allow-Credentials` must be `true`.
- A preflight for identity registration must include `PUT` in `Access-Control-Allow-Methods`.
- `Set-Cookie` must include `HttpOnly`, `Secure`, and `SameSite=None`.
- The browser must send the cookie on the following `/api/auth/me` request.

Repeat a preflight using an unapproved origin and confirm that `Access-Control-Allow-Origin` is absent. Never use `*` with credentials.

The `SameSite=None` setting relaxes the default CSRF boundary for this provider-domain topology. Exact credentialed CORS, JSON mutation bodies, and strict preflights protect normal API mutations, but logout CSRF and browser third-party-cookie restrictions remain documented limitations. Do not loosen CORS to work around a cookie problem.

## 8. Public-beta functional checklist

Use a clean browser profile and complete this flow over the deployed HTTPS URLs:

1. Register, log out, log in again, and refresh to confirm the session survives navigation.
2. Create a workspace and verify its member list.
3. Create the encryption identity and inspect the network request. The identity lookup and registration must use `/api/crypto/identity`, not `/crypto/identity`.
4. Export an encrypted identity recovery kit, then create the local workspace key with a separate unlock password.
5. Create a note while unlocked, reload, and confirm encrypted local persistence survives.
6. Sync the note, edit it, sync again, and verify pending counts return to zero.
7. Open the note, add a comment and a reply, reload/unlock, and confirm they decrypt.
8. Disable the network, edit a note, restore the network, and confirm the durable pending change syncs.
9. Exercise a conflict using the manual procedure in `README.md`, then test keep-local, accept-remote, or manual merge.
10. Lock the workspace while note/comment/merge drafts are visible. Confirm note titles become **Encrypted note**, plaintext fields clear, editing is disabled, and unlock restores persisted content.
11. Inspect Render logs and Neon rows for the manual plaintext marker described in `README.md`; note/comment plaintext, unlock passwords, raw keys, and session tokens must not appear.
12. Test the exact desktop/mobile browsers friends will use, especially their cross-site-cookie behavior and the first request after API/database idle time.
13. At roughly 360px width, complete note editing, comments, locking, and conflict resolution without horizontal page overflow or unreachable controls.
14. In developer tools, confirm the manifest and 192px/512px/maskable icons load, the service worker controls the page after reload, and Cache Storage contains no `/api/` entries.
15. Install from Chrome on Android and from Safari's **Share → Add to Home Screen** on iOS. Launch from the icon, background the app, and confirm it returns locked.

## Free-tier limitations

- Render Free web services spin down after 15 minutes without inbound traffic and may take about a minute to wake. They receive 750 running instance-hours per workspace each month, use an ephemeral filesystem, cannot scale beyond one instance, and can be suspended when bandwidth/build quotas are exhausted. CipherSpace persists durable server state in Neon, not the container filesystem.
- Neon Free compute scales to zero when idle. The first database query can therefore add latency. Current published limits include 100 CU-hours and 0.5 GB storage per project; monitor storage, compute, and restore-window usage.
- Cloudflare Pages Free currently permits 500 builds per month, one concurrent build, 20,000 files per site, and a 25 MiB maximum individual asset. CipherSpace's static build is well below those asset limits, but frequent pushes consume builds.
- The API auth limiter is in-memory and single-instance. API restarts reset it; a future multi-instance deployment needs a shared limiter.
- Cross-provider session cookies can be blocked by browser privacy controls. This must be tested rather than assumed.
- Free plans provide no application SLA and limits can change. A beta operator still needs database monitoring, a data-loss plan, dependency/security updates, and an incident contact path.

Do not use Render's Free Postgres for persistent beta data without accepting its current 30-day expiration. The recommended Neon database avoids that specific expiration, but still has free usage and restore limits.

## Before inviting friends

Deployment readiness does not remove product limitations. In particular, CipherSpace still has no member/device workspace-key sharing. Adding another user to a workspace authorizes ciphertext access but does not provision the key needed to decrypt existing content. Until key sharing is implemented and reviewed, treat the public beta as single-user workspaces or controlled same-browser demonstrations, not genuine encrypted multi-user collaboration.

Also complete these operational checks:

- Verify cross-site sessions in every target browser.
- Record and rehearse database restore/export steps without exposing plaintext or secrets.
- Establish a way to rotate `SESSION_SECRET` and database credentials after an incident, understanding that secret rotation signs everyone out.
- Review remaining authentication gaps: no email verification, password reset, MFA, session management UI, or explicit CSRF token.
- Run the full security, Docker, frontend, comments, sync, conflict, and lock checklists in `README.md` against the deployed URLs.
- Tell testers that losing the local unlock password or browser profile can make ciphertext unrecoverable.
