# Dokploy deployment

## Placement

Use the `research` project cluster and its `production` environment.

| Domain | Compose service | Internal port |
| --- | --- | --- |
| `hints.a.nlabstudio.ru` | `frontend` | `80` |

The public service exposes the participant flow, `/anxiety`, `/admin`, `/api/*`, and `/clips/*` through the frontend reverse proxy. PostgreSQL and backend have no public domain or host port.

## Required environment

Copy all variables from `.env.dokploy.example` into the Dokploy Environment editor. Replace every `CHANGE_ME_*` value before deployment:

```bash
openssl rand -hex 32  # POSTGRES_PASSWORD
openssl rand -hex 48  # ADMIN_SECRET_KEY
```

Choose and store a separate strong `ADMIN_PASSWORD`. `MARKER_UDP_HOST` and `MARKER_UDP_PORT` are optional and disabled by default.

## Deployment behavior

- `db` stores PostgreSQL data in the `postgres_data` named volume and must not be scaled.
- `migrate` creates missing tables idempotently and exits before the backend starts.
- `media-seed` downloads the 32 experiment clips from `CLIPS_SOURCE_BASE_URL`, validates their durations, and stores them in the persistent `clips_data` volume. Valid files are retained on redeploy.
- `backend` mounts `clips_data` read-only and validates all clips at startup.
- `frontend` is the only service connected to `dokploy-network`; it publishes the network alias `hints-web`.
- Runtime logs rotate at 10 MB and retain three files per service.

## Verification

After deployment, verify:

```bash
curl -fsS https://hints.a.nlabstudio.ru/api/health
curl -fsSI https://hints.a.nlabstudio.ru/
curl -fsSI https://hints.a.nlabstudio.ru/clips/practice_1.mp4
```

Expected health response contains `"status":"ok"`. Open `/`, `/?demo=1`, and `/admin` in a browser and complete a smoke session. The `research` cluster needs no dependency on another Dokploy stack.

## Data safety

Configure a scheduled PostgreSQL backup in Dokploy before collecting production responses. Never remove the `postgres_data` or `clips_data` volume during redeploy. Keep the current `edu1.datascope.online` deployment available until the first media seed finishes. Existing production responses from that server are not migrated automatically by this stack.
