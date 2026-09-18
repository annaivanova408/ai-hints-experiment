# Evidence

Append-only deployment and verification record.

## 2026-09-18 - Dokploy preparation

- Added `docker-compose.dokploy.yml`, `.env.dokploy.example`, `.dockerignore`, `DEPLOY_DOKPLOY.md`, the idempotent media seeder, service healthchecks, internal networking, persistent PostgreSQL/media volumes, and bounded container logs.
- Checked `dokploy-prep` 1.2.2 and `dokploy` 1.2.3 against `vibe-nlab/nlab-vibeskills`; local versions match the registry.
- `docker compose -f docker-compose.dokploy.yml config` passed with synthetic required environment values.
- Routing gate passed: no host `ports:` and no Traefik labels in the Dokploy compose file.
- Secret scan passed: no API tokens or private keys in the Git diff; example environment values remain placeholders.
- `PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -v` passed: 6 tests.
- `npm run build --prefix frontend` passed with Vite 8.2.2.
- Verified all 32 configured MP4 source URLs at `CLIPS_SOURCE_BASE_URL`: HTTP 200 with non-empty content, 254,641,166 bytes total.
- A full local container export was blocked by the workstation disk having about 461 MB free; Docker Desktop returned `input/output error` while unpacking duplicate test images. The duplicate image definition and 243 MB local media build context were removed afterward. Final runtime verification remains part of the remote Dokploy deployment gate.
- Deployment is blocked until the Dokploy GitHub provider is granted read access to the private repository `annaivanova408/ai-hints-experiment`.

## 2026-09-18 - Deployment and verification on nlab-prod-sbercloud

- Server `dokploy.a.nlabstudio.ru`, project `research`, environment `production`, compose `hints` (`Lbv2rld4UXieA9wBkrfO_`, appName `hints-ddjro3`), domain `hints.a.nlabstudio.ru`.
- The repository was made public so the Dokploy Git source could fetch it; the GitHub App route was not available to this account.
- Deployments: `d124b97` failed (compose environment file was not generated), `d124b97` succeeded after enabling it, `375756b` fixed the frontend healthcheck (`wget` in Alpine), `e4d8096` fixed the backend host name.
- Defect found after the first successful deployment: every `/api/*` and `/clips/*` path answered `404 {"detail":"Not Found"}` while the backend container itself was healthy. The frontend proxied to the host name `backend`, which is not unique on the shared `dokploy-network`, so requests reached a neighbouring stack. Fixed by giving the backend the network alias `hints-backend` and using it in `frontend/nginx.conf`.
- `compose.redeploy` rebuilt from the previously fetched source (the `COPY frontend/nginx.conf` layer stayed `CACHED`); `compose.deploy` fetched `e4d8096` and applied the fix.
- Verification on 2026-09-18 after the `e4d8096` deployment:
  - `GET /` 200, `GET /admin` 200, `http://` redirects to `https://` with 301.
  - `GET /api/health` 200 `{"status":"ok","config_version":"2026-09-10-matrix-v2"}`.
  - `GET /api/config` 200 with 3 video ids and 30 assignment slots.
  - All 32 clips return 200; `Range: bytes=0-1023` on `practice_1.mp4` returns 206 with 1024 bytes.
  - `GET /api/admin/sessions` without a token returns 401.
- Skill version check against the registry was not performed for this session; the local `dokploy` skill copy was used as installed.
