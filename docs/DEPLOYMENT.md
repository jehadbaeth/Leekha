# Deployment Guide

The whole app, client and WebSocket server, ships as **one Docker image**
that serves both from the same origin. That's the only deployment shape
this repo builds and tests directly; this document covers that path in
depth and then how to slot it into a few common hosting options. See
`docs/SYSTEM_DESIGN.md` Section 10 for the scaling ceiling of this
approach (single process, no horizontal sharding).

## 1. What the image does

`Dockerfile` (repo root) is a multi-stage build:

1. `deps`: installs the full pnpm workspace with a frozen lockfile.
2. `build`: builds every workspace package (`packages/**`) and the web
   client (`apps/web`, a static Vite build).
3. `runtime`: a slim `node:20-alpine` image containing only the built web
   assets, the server's source, and production `node_modules`. It runs the
   server directly via `tsx` (no separate compile step for the server; see
   the note at the end of this section if that surprises you).

The server serves the built client's static files (`apps/web/dist`,
copied in as `apps/server/web-dist`) *and* the socket.io endpoint on the
same port, so there's exactly one origin, no CORS, no cross-origin cookie
issues, and only one thing to put behind TLS.

```bash
docker build -t leekha .
docker run -p 8080:8080 leekha
```

Verify it's actually working, not just that it started:

```bash
curl -i http://localhost:8080/                      # 200, serves index.html
curl -i http://localhost:8080/manifest.webmanifest   # 200, PWA manifest
curl -i http://localhost:8080/some/unknown/path      # 200, SPA fallback to index.html
```

A real client also needs the socket.io handshake to succeed
(`GET /socket.io/?EIO=4&transport=polling`), which `curl -i` against that
path will confirm returns a 200 with a session payload, not a 404.

**Why `tsx` in production instead of a `tsc` build step:** `apps/server`'s
`tsconfig.json` has `noEmit: true` and includes `test/`, which has
pre-existing type errors out of this feature's scope. Rather than route
around that, the runtime image runs the server the same way `pnpm dev`
does locally, via `tsx` directly. This is a deliberate simplicity/build-time
tradeoff, not an oversight; if you want a compiled `dist/` for the server
later, that needs its own `tsconfig.build.json` that excludes `test/`.

## 2. Environment variables

| Variable        | Required | Default              | Purpose |
|-----------------|----------|-----------------------|---------|
| `PORT`          | no       | `8080`                | Port the single Node process listens on for both HTTP and WebSocket traffic. |
| `WEB_DIST_PATH` | no       | bundled `apps/web/dist` inside the image | Where to serve static client files from. Override only if you're serving the client from a different build output path. |
| `REDIS_URL`     | no       | unset (in-memory only) | When set, room state persists to Redis so in-flight games survive a restart. See Section 4. |

There is no other required configuration: no database URL, no secrets, no
API keys. The app has no accounts and no third-party integrations.

## 3. Reverse proxy and TLS

The container itself speaks plain HTTP on `$PORT`. Put it behind whatever
TLS-terminating proxy your platform gives you:

- **A managed platform (Fly.io, Railway, Render, etc.)** typically
  terminates TLS for you automatically once you point it at the
  container's port; you just need to expose `$PORT` and confirm the
  platform proxies WebSocket upgrades (all three of the platforms named in
  SPEC.md's original brief do this by default).
- **A plain VPS**: run the container and put Caddy or nginx in front of it.
  Caddy is the simplest option because it auto-provisions Let's Encrypt
  certificates with zero config beyond a domain name:

  ```caddyfile
  yourdomain.example {
      reverse_proxy localhost:8080
  }
  ```

  Caddy proxies WebSocket upgrades transparently with a bare
  `reverse_proxy` directive, no special `Upgrade`/`Connection` header
  wiring needed like classic nginx configs require. If you use nginx
  instead, make sure your `location` block sets:

  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ```

  or socket.io connections will silently fall back to long-polling instead
  of upgrading to a real WebSocket.

Because client and server share one origin, you never need to configure
CORS for a legitimate deployment. `apps/server/src/server.ts` currently
sets `cors: { origin: '*' }` on the socket.io server regardless, which only
matters if you ever split the client onto a different origin, tighten it
at that point (see `docs/SYSTEM_DESIGN.md` Section 10).

## 4. Optional: Redis-backed persistence

Without `REDIS_URL`, all room state lives in the server process's memory.
A restart or redeploy ends every game currently in progress. That's an
accepted default for a small deploy (see `docs/SYSTEM_DESIGN.md` Section 6
for why), but if you want games to survive a redeploy:

1. Run a Redis instance reachable from the container. Any managed Redis
   (Upstash, Redis Cloud, your platform's managed add-on) or a self-hosted
   `redis:7-alpine` container both work; there's nothing Leekha-specific
   required of it beyond basic `SET`/`GET`/`KEYS`/`MGET`/`DEL` support.
2. Set `REDIS_URL` on the container, e.g.
   `redis://default:password@your-redis-host:6379`.
3. That's it. No schema, no migrations. Each room is a single JSON blob at
   `leekha:room:{code}` with a 6 hour TTL; on boot the server restores
   whatever rooms are still present and reconnects seat tokens
   automatically.

Example with Docker Compose for a self-hosted Redis alongside the app:

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis
  redis:
    image: redis:7-alpine
    restart: unless-stopped
```

Redis persistence here is specifically for **surviving a restart**, not for
scaling to multiple server replicas. Running two instances of this image
against the same Redis will not correctly split traffic; each room still
belongs to exactly one in-memory process at a time (see
`docs/SYSTEM_DESIGN.md` Section 10).

## 5. Platform-specific notes

### Fly.io

- `fly launch` will detect the Dockerfile. Set `PORT=8080` (or match
  whatever you set) as an app secret/env var, and if using Redis, add
  `REDIS_URL` as a secret (`fly secrets set REDIS_URL=...`), never a plain
  env var, since it may contain credentials.
- Fly's proxy handles WebSocket upgrades and TLS automatically once your
  `fly.toml` exposes the internal port.
- A single small VM (shared-cpu-1x, 256MB-512MB) is comfortable for this
  workload per SPEC.md's sizing assumption (thousands of concurrent 4-seat
  rooms on one small instance).

### Railway / Render

- Both auto-detect a Dockerfile and build it directly. Set the same
  environment variables in their dashboard's env var UI (mark `REDIS_URL`
  as a secret if the platform distinguishes secret vars).
- Both provide a managed Redis add-on if you don't want to run your own.

### Bare VPS

- `docker run` (or a `docker-compose.yml` like the example above) plus
  Caddy or nginx in front, as described in Section 3.
- If you're not using Redis, no other persistent volume is needed; the
  container is fully stateless without `REDIS_URL` set.

## 6. Health and readiness

There is no dedicated `/health` route. The root path (`/`) serving the
client's `index.html` with a 200 is the closest thing to a liveness check
today; if your platform requires a specific health-check path, point it at
`/` rather than expecting a JSON health payload. This is listed as a gap
in `docs/SYSTEM_DESIGN.md` Section 10, worth adding before relying on
platform auto-restart-on-failed-health-check behavior.

## 7. Rolling out an update

Because rooms live in memory by default, redeploying ends any in-progress
games unless `REDIS_URL` is configured (Section 4). Options, in order of
effort:

1. **Simplest**: deploy during low-traffic hours and accept that anyone
   mid-game gets disconnected (this was the explicit MVP-phase tradeoff).
2. **Better**: configure Redis persistence (Section 4) so a normal restart
   or redeploy is transparent to players who reconnect with their existing
   seat token.
3. **Not supported today**: zero-downtime rolling replicas. As noted in
   Section 5 of `docs/SYSTEM_DESIGN.md`, this system does not support
   multiple concurrent server replicas sharing room state; a blue/green or
   rolling deploy strategy that briefly runs two instances against the
   same Redis will not correctly hand off in-flight rooms between them.
