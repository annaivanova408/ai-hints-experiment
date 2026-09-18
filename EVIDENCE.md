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
