# Notes

- The Dokploy copy is deployed as `hints` to the `research` cluster at `hints.a.nlabstudio.ru`; the existing manual deployment at `edu1.datascope.online` remains untouched.
- The PostgreSQL database starts empty on a first Dokploy deployment. Existing production responses require a separate backup/restore operation initiated by the owner.
- The first deployment seeds its persistent media volume from the existing HTTPS deployment; this avoids committing 243 MB of MP4 files to Git.
