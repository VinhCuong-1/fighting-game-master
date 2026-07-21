#!/bin/bash
# CodeDeploy ApplicationStart — install deps, restart PM2, verify /health.
# Env from bundled fighting-game.env (CI) or /etc/fighting-game.env (override).
set -euo pipefail

APP_DIR="/home/ubuntu/fighting-game-server"
BUNDLED_ENV="$APP_DIR/fighting-game.env"
ENV_FILE="/etc/fighting-game.env"

cd "$APP_DIR"

set -a
if [[ -f "$BUNDLED_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$BUNDLED_ENV"
elif [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi
set +a

# Strip CR from Windows-edited env files; trim accidental whitespace.
COGNITO_REGION="$(printf '%s' "${COGNITO_REGION:-ap-southeast-1}" | tr -d '\r')"
COGNITO_USER_POOL_ID="$(printf '%s' "${COGNITO_USER_POOL_ID:-}" | tr -d '\r' | xargs)"
MATCHES_TABLE="$(printf '%s' "${MATCHES_TABLE:-ActiveMatches}" | tr -d '\r' | xargs)"
PORT="$(printf '%s' "${PORT:-9000}" | tr -d '\r' | xargs)"

export COGNITO_REGION
export COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:?COGNITO_USER_POOL_ID required — set in fighting-game.env (CI) or $ENV_FILE on the instance}"
export MATCHES_TABLE
export PORT

npm ci --omit=dev 2>/dev/null || npm install --omit=dev

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

pm2 delete fighting-game-server 2>/dev/null || true
pm2 start server.js --name fighting-game-server
pm2 save

for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    echo "Health check passed on attempt $i"
    exit 0
  fi
  sleep 2
done

echo "Health check failed after 30s on port ${PORT}" >&2
exit 1
