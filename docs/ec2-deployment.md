# EC2 deployment

GitHub Actions builds the API image, pushes it to Docker Hub, then connects to EC2 and restarts the server with `docker compose`.

## Required secrets

Only workflow-level credentials stay as separate GitHub Secrets. Application environment values are grouped into one multiline `.env` secret.

| Secret | Example | Description |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | `soundlogteam` | Docker Hub namespace. |
| `DOCKERHUB_TOKEN` | `dckr_pat_...` | Docker Hub access token with push/pull permission. |
| `EC2_HOST` | `54.226.62.131` | EC2 public IP or domain. |
| `EC2_USER` | `ec2-user` | SSH user. |
| `EC2_SSH_PORT` | `22` | SSH port. |
| `EC2_SSH_KEY` | PEM private key | Private key that can SSH into EC2. |
| `EC2_APP_DIR` | `/home/ec2-user/soundlog-server` | Directory where compose and `.env` are written. |
| `PRODUCTION_ENV` | multiline `.env` | Server runtime environment except generated deployment values. |
| `FRONTEND_VERCEL_TOKEN` | `vercel_...` | Optional. Enables automatic `SOUNDLOG_API_ORIGIN` sync for the frontend Vercel project. |
| `FRONTEND_VERCEL_SCOPE` | `mannomis-projects` | Optional. Vercel team/user scope for the frontend project. Defaults to `mannomis-projects`. |
| `FRONTEND_VERCEL_PROJECT` | `sound-log-app` | Optional. Frontend Vercel project name. Defaults to `sound-log-app`. |

## `PRODUCTION_ENV` format

Register `PRODUCTION_ENV` as a multiline secret with this format.

```dotenv
API_PORT=4000
CLIENT_URL=https://soundlog.shop
CLIENT_URLS=https://soundlog.shop,https://www.soundlog.shop,https://sound-log-app.vercel.app,http://localhost:8081,http://localhost:8082
POSTGRES_USER=soundlog
POSTGRES_PASSWORD=<generated-db-password>
POSTGRES_DB=soundlog
JWT_SECRET=<generated-jwt-secret>
JWT_EXPIRES_IN_SECONDS=3600
ML_RECOMMENDATION_API_URL=http://211.188.54.204:8000/recommend
ML_RECOMMENDATION_TIMEOUT_MS=5000
REQUEST_BODY_LIMIT=1mb
MOMENT_PHOTO_MAX_FILE_SIZE_MB=10
TOUR_API_BASE_URL=https://apis.data.go.kr/B551011/KorService2
TOUR_API_SERVICE_KEY=
ALLOW_DEV_AUTH_FALLBACK=false
UPLOAD_PUBLIC_PATH=/uploads
USE_MOCK_DB=false
```

The workflow prepends `DOCKER_IMAGE=<dockerhub-username>/soundlog-server:<tag>`, derives `UPLOAD_PUBLIC_BASE_URL=http://<EC2_HOST>:<API_PORT>`, and injects a URL-encoded internal `DATABASE_URL` at deploy time, so do not include those values in `PRODUCTION_ENV`.

## `soundlog.shop` DNS and API proxy

Use this DNS layout.

| Host | Type | Target |
| --- | --- | --- |
| `soundlog.shop` | `A` | `76.76.21.21` |
| `www.soundlog.shop` | `CNAME` | `cname.vercel-dns.com.` |

Do not use a separate API subdomain for the current deployment. The public API URL is:

```txt
https://soundlog.shop/api/soundlog
```

The frontend Vercel project rewrites `/api/soundlog/:path*` to the EC2 API origin in the server-side Vercel layer. Set Vercel `SOUNDLOG_API_ORIGIN` to the current EC2 API origin, for example `http://<EC2_HOST>:4000`.

When `FRONTEND_VERCEL_TOKEN` is configured in this repo, the deploy workflow updates `SOUNDLOG_API_ORIGIN` for the frontend Vercel `preview` and `production` environments after each successful EC2 deploy. Re-run the frontend Vercel deployment after the env sync so the generated rewrite config is rebuilt.

## Register secrets with GitHub CLI

Run these from any directory after `gh auth login`.

```sh
gh secret set DOCKERHUB_USERNAME --repo SoundLogTeam/SoundLogServer --body '<dockerhub-username>'
gh secret set DOCKERHUB_TOKEN --repo SoundLogTeam/SoundLogServer --body '<dockerhub-access-token>'

gh secret set EC2_HOST --repo SoundLogTeam/SoundLogServer --body '54.226.62.131'
gh secret set EC2_USER --repo SoundLogTeam/SoundLogServer --body 'ec2-user'
gh secret set EC2_SSH_PORT --repo SoundLogTeam/SoundLogServer --body '22'
gh secret set EC2_SSH_KEY --repo SoundLogTeam/SoundLogServer < ~/.ssh/soundlog-ec2.pem
gh secret set EC2_APP_DIR --repo SoundLogTeam/SoundLogServer --body '/home/ec2-user/soundlog-server'
gh secret set PRODUCTION_ENV --repo SoundLogTeam/SoundLogServer < .env.production

gh secret set FRONTEND_VERCEL_TOKEN --repo SoundLogTeam/SoundLogServer --body '<vercel-token>'
gh secret set FRONTEND_VERCEL_SCOPE --repo SoundLogTeam/SoundLogServer --body 'mannomis-projects'
gh secret set FRONTEND_VERCEL_PROJECT --repo SoundLogTeam/SoundLogServer --body 'sound-log-app'
```

## Run deployment

The workflow runs automatically after a push to a configured deployment branch. You can also deploy manually from GitHub Actions or CLI.

```sh
gh workflow run deploy-ec2.yml --repo SoundLogTeam/SoundLogServer
```

EC2 must already have Docker Engine and Docker Compose v2 installed. The workflow keeps Postgres data in the `postgres_data` Docker volume and uploaded files in the `uploads_data` Docker volume.

After deployment, the workflow verifies `http://127.0.0.1:<API_PORT>/v1/health` from inside EC2 and runs the API contract check from inside the deployed API container. It then prints EC2 network diagnostics, including Docker port publishing, listening sockets, local health, public-IP self-curl, and host firewall state. Finally, it verifies `http://<EC2_HOST>:<API_PORT>/v1/health` from GitHub Actions and fails the deploy if the public API port is unreachable. If this gate fails, open TCP `<API_PORT>` on the EC2 security group/firewall or point `SOUNDLOG_API_ORIGIN` to a reachable API origin before rebuilding the frontend. After the frontend deployment is rebuilt with the synced Vercel env, verify `https://soundlog.shop/api/soundlog/v1/health` and run the app repo's deployed-web check.
