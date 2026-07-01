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

## `PRODUCTION_ENV` format

Register `PRODUCTION_ENV` as a multiline secret with this format.

```dotenv
API_PORT=4000
CLIENT_URL=http://localhost:8081
CLIENT_URLS=http://localhost:8081,http://localhost:8082
POSTGRES_USER=soundlog
POSTGRES_PASSWORD=<generated-db-password>
POSTGRES_DB=soundlog
JWT_SECRET=<generated-jwt-secret>
JWT_EXPIRES_IN_SECONDS=3600
GOOGLE_CLIENT_ID=
APPLE_CLIENT_ID=
KAKAO_APP_ID=
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

The workflow prepends `DOCKER_IMAGE=<dockerhub-username>/soundlog-server:<tag>` and derives `UPLOAD_PUBLIC_BASE_URL=http://<EC2_HOST>:<API_PORT>` at deploy time, so do not include those values in `PRODUCTION_ENV`.

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
```

## Run deployment

The workflow runs automatically after a push to a configured deployment branch. You can also deploy manually from GitHub Actions or CLI.

```sh
gh workflow run deploy-ec2.yml --repo SoundLogTeam/SoundLogServer
```

EC2 must already have Docker Engine and Docker Compose v2 installed. The workflow keeps Postgres data in the `postgres_data` Docker volume and uploaded files in the `uploads_data` Docker volume.

The EC2 security group must allow inbound TCP traffic for `API_PORT` from the testers or clients that will use the app. For the current HTTP test server, `http://54.226.62.131:4000/v1/health` should respond before shipping a `development` or `preview` app build to testers.
