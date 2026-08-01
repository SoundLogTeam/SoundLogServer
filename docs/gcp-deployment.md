# GCP deployment

Soundlog는 웹 서비스를 배포하지 않습니다. GitHub Actions builds the API image, pushes it to Docker Hub, then connects to a GCP Compute Engine VM and restarts the server with `docker compose`. Postgres, the API and Caddy run as containers on the VM. The iOS·Android app calls `https://api.soundlog.shop` directly, and Caddy terminates HTTPS with an automatically issued Let's Encrypt certificate.

## GCP resources

| Resource | Value |
| --- | --- |
| Project | `nomi-app-deploy-2026` |
| Zone | `asia-northeast3-a` |
| VM | `soundlog-api` (`e2-medium`, Debian 12) |
| Static IP | reserved as `soundlog-api-ip` in `asia-northeast3` |
| Firewall | `soundlog-api-allow-ssh-http-https` allows tcp 22/80/443 to the `soundlog-api` tag |
| Cloud DNS zone | `soundlog-shop` for `soundlog.shop` |

The VM's startup script installs Docker Engine + the Compose plugin and creates `/home/deploy/soundlog-server`. The deploy workflow uses SSH access to the VM's static IP and does not require a GCP service-account key.

## Required secrets

Only workflow-level credentials stay as separate GitHub Secrets. Application environment values are grouped into one multiline `.env` secret.

| Secret | Example | Description |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | `soundlogteam` | Docker Hub namespace. |
| `DOCKERHUB_TOKEN` | `dckr_pat_...` | Docker Hub access token with push/pull permission. |
| `GCP_HOST` | `34.64.116.40` | GCP VM static external IP. |
| `GCP_USER` | `deploy` | SSH user provisioned on the VM. |
| `GCP_SSH_PORT` | `22` | SSH port. |
| `GCP_SSH_KEY` | private key | Private key for the dedicated `deploy` SSH keypair (not a personal key). |
| `GCP_APP_DIR` | `/home/deploy/soundlog-server` | Directory where compose files and `.env` are written. |
| `PRODUCTION_ENV` | multiline `.env` | Server runtime environment except generated deployment values. |

## `PRODUCTION_ENV` format

Register `PRODUCTION_ENV` as a multiline secret with this format.

```dotenv
CLIENT_URL=https://api.soundlog.shop
CLIENT_URLS=https://api.soundlog.shop,http://localhost:8081,http://localhost:8082
POSTGRES_USER=soundlog
POSTGRES_PASSWORD=<generated-db-password>
POSTGRES_DB=soundlog
JWT_SECRET=<generated-jwt-secret>
JWT_EXPIRES_IN_SECONDS=3600
# Optional. Configure only an HTTPS endpoint. Empty or non-HTTPS values use seed fallback.
ML_RECOMMENDATION_API_URL=
ML_RECOMMENDATION_TIMEOUT_MS=5000
REQUEST_BODY_LIMIT=1mb
MOMENT_PHOTO_MAX_FILE_SIZE_MB=10
REVERSE_GEOCODING_BASE_URL=https://nominatim.openstreetmap.org
REVERSE_GEOCODING_USER_AGENT=Soundlog/0.1 (+https://github.com/SoundLogTeam/SoundLogServer)
TOUR_API_BASE_URL=https://apis.data.go.kr/B551011/KorService2
TOUR_API_SERVICE_KEY=
ALLOW_DEV_AUTH_FALLBACK=false
UPLOAD_PUBLIC_BASE_URL=https://api.soundlog.shop
USE_MOCK_DB=false
```

`UPLOAD_PUBLIC_BASE_URL` is a fixed HTTPS value because Caddy terminates TLS at the same domain. The workflow prepends `DOCKER_IMAGE=<dockerhub-username>/soundlog-server:<tag>` and injects a URL-encoded internal `DATABASE_URL` at deploy time, so do not include those values in `PRODUCTION_ENV`.

`ML_RECOMMENDATION_API_URL` is optional. In production, the server ignores a non-HTTPS value and returns the existing seed recommendation fallback without sending location or mood to the ML server. Run `pnpm check:production-env` before deployment to surface that configuration.

`TOUR_API_SERVICE_KEY` ships blank; set the real data.go.kr key if the tour-recommendation feature needs to work in production.

## `api.soundlog.shop` DNS

GCP project `nomi-app-deploy-2026` has a public Cloud DNS zone named `soundlog-shop`. Delegate the domain at the registrar to these nameservers:

- `ns-cloud-d1.googledomains.com`
- `ns-cloud-d2.googledomains.com`
- `ns-cloud-d3.googledomains.com`
- `ns-cloud-d4.googledomains.com`

The zone contains this record:

| Type | Host | Value |
| --- | --- | --- |
| `A` | `api` | `34.64.116.40` |

Caddy cannot issue a Let's Encrypt certificate for `api.soundlog.shop` until the registrar delegates the domain to Cloud DNS. Existing AWS Route 53 and Vercel nameservers are not part of the production path.

## Register secrets with GitHub CLI

Run these from any directory after `gh auth login`.

```sh
gh secret set DOCKERHUB_USERNAME --repo SoundLogTeam/SoundLogServer --body '<dockerhub-username>'
gh secret set DOCKERHUB_TOKEN --repo SoundLogTeam/SoundLogServer --body '<dockerhub-access-token>'

gh secret set GCP_HOST --repo SoundLogTeam/SoundLogServer --body '34.64.116.40'
gh secret set GCP_USER --repo SoundLogTeam/SoundLogServer --body 'deploy'
gh secret set GCP_SSH_PORT --repo SoundLogTeam/SoundLogServer --body '22'
gh secret set GCP_SSH_KEY --repo SoundLogTeam/SoundLogServer < ~/.ssh/soundlog-gcp-deploy
gh secret set GCP_APP_DIR --repo SoundLogTeam/SoundLogServer --body '/home/deploy/soundlog-server'
gh secret set PRODUCTION_ENV --repo SoundLogTeam/SoundLogServer < .env.production

```

## Run deployment

The workflow runs automatically after a push to `main`. You can also deploy manually from GitHub Actions or CLI.

```sh
gh workflow run deploy-gcp.yml --repo SoundLogTeam/SoundLogServer
```

After deployment, the API container runs Prisma migrations and upserts the public music catalog used by the app. The workflow verifies API health from inside the `api` container over SSH and runs the API contract check from inside the deployed container. It then checks `https://api.soundlog.shop/v1/health` from GitHub Actions; this step is informational until DNS delegation is complete.

## Verification

```sh
dig +short api.soundlog.shop A
curl https://api.soundlog.shop/v1/health
curl -I https://api.soundlog.shop/legal/privacy
curl -I https://api.soundlog.shop/legal/terms
curl -I https://api.soundlog.shop/support
```

Run from the SoundLogApp repo to validate the full contract against the live origin:

```sh
SOUNDLOG_API_ORIGIN=https://api.soundlog.shop npm run check:api-origin
```
