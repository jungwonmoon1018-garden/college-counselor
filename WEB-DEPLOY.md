# Private web deployment

College Counselor supports a private, single-instance web profile in addition
to its desktop build. This profile packages the React app, API, and simulation
sidecar together, stores all durable state on one persistent volume, and places
Caddy in front for HTTPS.

This is not a public multi-tenant SaaS profile. Do not expose it as an open
student service without adding verified enrollment or invitations, a formal
guardian-consent workflow, organization-level authorization, centralized abuse
and spend controls, and an appropriate privacy/compliance review.

## Required architecture

- One application replica only. The application uses SQLite and local files;
  multiple replicas can corrupt or diverge state.
- A persistent volume mounted at `/var/lib/college-counselor`, backed by
  host- or provider-level encryption at rest. A Docker named volume does not
  provide disk encryption by itself.
- Same-origin hosting at the root of one HTTPS domain. Split frontend/API
  origins and subpath hosting are not supported.
- A reverse proxy that supplies exactly one trusted proxy hop. The bundled
  Compose profile uses Caddy and sets this correctly.
- Backups of the persistent volume. Take a consistent snapshot while the
  application service is stopped, and periodically verify restoration.
- Server-side secrets supplied through the deployment environment. The
  desktop administrator and Electron secret store are intentionally absent
  from the web build.

Serverless platforms, ephemeral filesystems, and automatic horizontal scaling
are incompatible with this profile.

## Deploy with Docker Compose

Requirements:

- A Linux host with Docker Engine and the Compose plugin
- A public DNS record pointing your chosen hostname to that host
- Inbound TCP ports 80 and 443; UDP 443 is recommended for HTTP/3

1. Copy `.env.web.example` to `.env.web`, then restrict it to the deployment
   account:

   ```sh
   chmod 600 .env.web
   ```

   The file contains plaintext application secrets. Anyone with Docker daemon
   administrator access can also inspect a container's environment and must be
   treated as a privileged host administrator.
2. Set `PUBLIC_DOMAIN` and `PUBLIC_ORIGIN` to the same HTTPS hostname.
3. Generate a separate random value for each of the four local secrets:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   `ENCRYPTION_KEY` must remain unchanged for the lifetime of the stored data.
   Losing or rotating it without a migration makes encrypted student records
   unreadable.

4. Add the installation-wide OpenRouter key. The Scorecard key is optional.
5. Build and start the services:

   ```sh
   docker compose --env-file .env.web -f compose.web.yaml up -d --build
   ```

6. Confirm both endpoints through HTTPS:

   ```sh
   curl --fail https://counselor.example.com/api/health
   curl --fail https://counselor.example.com/api/ready
   ```

7. Give the registration access code only to the intended household or small
   private cohort. Change it after onboarding if access must be closed to the
   original invitees; existing accounts do not depend on that code.

Caddy obtains and renews TLS certificates automatically after DNS and firewall
configuration are correct.

## Updates

Before updating, take a persistent-volume snapshot. Then rebuild the immutable
application image without deleting the named volumes:

```sh
docker compose --env-file .env.web -f compose.web.yaml up -d --build
```

Never use `docker compose down -v` for an update; `-v` deletes the student data
volume.

## Backups and recovery

The volume contains the operational database, encrypted PII vault, vector
store, uploads, and student-owned files. A useful backup policy includes:

- encrypted snapshots on a schedule appropriate to the installation;
- retention separate from the application host;
- a documented restore target;
- periodic restore tests; and
- continued custody of the original `ENCRYPTION_KEY`.

Stop the `app` service or use a storage-level atomic snapshot before making a
raw copy of the volume. Copying live SQLite files independently is not a
consistent backup.

## Platform health and scaling

- `/api/health` is a minimal liveness endpoint.
- `/api/ready` verifies the three databases and the private simulation sidecar.
- Keep the application at exactly one replica.
- Terminate TLS at one trusted proxy hop.
- Do not publish the application container's port directly; only Caddy should
  be internet-facing.

## Local production smoke test

The repository-level build prepares the web bundle in the backend's ignored
`public` directory:

```sh
npm run build:web
```

Run the isolated production smoke test. It generates temporary secrets, binds
only to loopback, starts both backend processes, and removes its temporary data:

```sh
npm run smoke:web
```

`npm run start:web` is the internal application-container entry point. Do not
publish it directly or run it as an internet-facing service; the supported web
profile keeps it behind exactly one trusted reverse proxy.

For routine development, continue to use the package-specific commands in the
main README.
