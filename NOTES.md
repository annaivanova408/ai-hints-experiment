# Notes

- The Dokploy copy is deployed as `hints` to the `research` cluster at `hints.a.nlabstudio.ru`; the existing manual deployment at `edu1.datascope.online` remains untouched.
- The PostgreSQL database starts empty on a first Dokploy deployment. Existing production responses require a separate backup/restore operation initiated by the owner.
- The first deployment seeds its persistent media volume from the existing HTTPS deployment; this avoids committing 243 MB of MP4 files to Git.
- Service names on the shared `dokploy-network` are not isolated: a generic name such as `backend` can resolve to another stack's container. Internal services are addressed by the unique alias `hints-backend`; keep new services uniquely named.
- `compose.redeploy` does not fetch new commits - it rebuilds the source Dokploy already has. Use `compose.deploy` after pushing.
- The repository is currently public. Making it private again keeps the running site up but stops Dokploy from fetching further updates until a GitHub App is connected.
