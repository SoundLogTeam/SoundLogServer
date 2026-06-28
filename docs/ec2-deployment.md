# EC2 deployment

GitHub Actions builds the API image, pushes it to Docker Hub, then connects to EC2 and restarts the server with `docker compose`.

## Required secrets

Register these in `SoundLogTeam/SoundLogServer` before running the workflow.

| Secret | Example | Description |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | `soundlogteam` | Docker Hub namespace. |
| `DOCKERHUB_TOKEN` | `dckr_pat_...` | Docker Hub access token with push/pull permission. |
| `EC2_HOST` | `52.79.185.121` | EC2 public IP or domain. |
| `EC2_USER` | `ubuntu` | SSH user. |
| `EC2_SSH_PORT` | `22` | SSH port. |
| `EC2_SSH_KEY` | PEM private key | Private key that can SSH into EC2. |
| `EC2_APP_DIR` | `/home/ubuntu/soundlog-server` | Directory where compose and `.env` are written. |
| `POSTGRES_PASSWORD` | generated value | Production DB password. |
| `JWT_SECRET` | generated value | JWT signing secret. |
| `CLIENT_URL` | `soundlog://` or frontend URL | Primary allowed client origin. |
| `CLIENT_URLS` | `soundlog://,http://localhost:8081` | Comma-separated allowed client origins. |
| `UPLOAD_PUBLIC_BASE_URL` | `http://52.79.185.121:4000` | Public base URL for uploaded files. |

## Optional secrets

These have defaults or can be empty, but should be set before using the related feature.

| Secret | Default | Description |
| --- | --- | --- |
| `API_PORT` | `4000` | Public API port on EC2. |
| `POSTGRES_USER` | `soundlog` | Production DB user. |
| `POSTGRES_DB` | `soundlog` | Production DB name. |
| `JWT_EXPIRES_IN_SECONDS` | `3600` | Access token lifetime. |
| `APPLE_CLIENT_ID` | empty | Apple login client ID. |
| `KAKAO_APP_ID` | empty | Kakao login app ID. |
| `GOOGLE_CLIENT_ID` | empty | Google login client ID, if needed. |
| `ML_RECOMMENDATION_API_URL` | `http://211.188.54.204:8000/recommend` | ML recommendation endpoint. |
| `ML_RECOMMENDATION_TIMEOUT_MS` | `5000` | ML request timeout. |
| `REQUEST_BODY_LIMIT` | `1mb` | JSON/body parser limit. |
| `MOMENT_PHOTO_MAX_FILE_SIZE_MB` | `10` | Upload size limit. |
| `TOUR_API_BASE_URL` | `https://apis.data.go.kr/B551011/KorService2` | Korea Tour API base URL. |
| `TOUR_API_SERVICE_KEY` | empty | Korea Tour API service key. |
| `ALLOW_DEV_AUTH_FALLBACK` | `false` | Keep `false` in production. |
| `UPLOAD_PUBLIC_PATH` | `/uploads` | Public upload path. |
| `USE_MOCK_DB` | `false` | Keep `false` in production. |

## Register secrets with GitHub CLI

Run these from any directory after `gh auth login`.

```sh
gh secret set DOCKERHUB_USERNAME --repo SoundLogTeam/SoundLogServer --body '<dockerhub-username>'
gh secret set DOCKERHUB_TOKEN --repo SoundLogTeam/SoundLogServer --body '<dockerhub-access-token>'

gh secret set EC2_HOST --repo SoundLogTeam/SoundLogServer --body '<ec2-public-ip-or-domain>'
gh secret set EC2_USER --repo SoundLogTeam/SoundLogServer --body 'ubuntu'
gh secret set EC2_SSH_PORT --repo SoundLogTeam/SoundLogServer --body '22'
gh secret set EC2_SSH_KEY --repo SoundLogTeam/SoundLogServer < ~/.ssh/soundlog-ec2.pem
gh secret set EC2_APP_DIR --repo SoundLogTeam/SoundLogServer --body '/home/ubuntu/soundlog-server'

gh secret set POSTGRES_USER --repo SoundLogTeam/SoundLogServer --body 'soundlog'
openssl rand -base64 32 | gh secret set POSTGRES_PASSWORD --repo SoundLogTeam/SoundLogServer
gh secret set POSTGRES_DB --repo SoundLogTeam/SoundLogServer --body 'soundlog'
openssl rand -base64 48 | gh secret set JWT_SECRET --repo SoundLogTeam/SoundLogServer

gh secret set CLIENT_URL --repo SoundLogTeam/SoundLogServer --body '<app-or-frontend-origin>'
gh secret set CLIENT_URLS --repo SoundLogTeam/SoundLogServer --body '<comma-separated-origins>'
gh secret set UPLOAD_PUBLIC_BASE_URL --repo SoundLogTeam/SoundLogServer --body 'http://<ec2-public-ip>:4000'
```

Optional production defaults can also be registered explicitly.

```sh
gh secret set API_PORT --repo SoundLogTeam/SoundLogServer --body '4000'
gh secret set ML_RECOMMENDATION_API_URL --repo SoundLogTeam/SoundLogServer --body 'http://211.188.54.204:8000/recommend'
gh secret set ML_RECOMMENDATION_TIMEOUT_MS --repo SoundLogTeam/SoundLogServer --body '5000'
gh secret set REQUEST_BODY_LIMIT --repo SoundLogTeam/SoundLogServer --body '1mb'
gh secret set MOMENT_PHOTO_MAX_FILE_SIZE_MB --repo SoundLogTeam/SoundLogServer --body '10'
gh secret set ALLOW_DEV_AUTH_FALLBACK --repo SoundLogTeam/SoundLogServer --body 'false'
gh secret set UPLOAD_PUBLIC_PATH --repo SoundLogTeam/SoundLogServer --body '/uploads'
gh secret set USE_MOCK_DB --repo SoundLogTeam/SoundLogServer --body 'false'
```

## Run deployment

The workflow runs automatically after a push to `main`. You can also deploy manually from GitHub Actions or CLI.

```sh
gh workflow run deploy-ec2.yml --repo SoundLogTeam/SoundLogServer
```

EC2 must already have Docker Engine and Docker Compose v2 installed. The workflow keeps Postgres data in the `postgres_data` Docker volume and uploaded files in the `uploads_data` Docker volume.
