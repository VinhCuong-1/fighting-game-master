#!/bin/bash
# CodeDeploy ApplicationStop — graceful PM2 shutdown before files are replaced.
set -euo pipefail

if command -v pm2 >/dev/null 2>&1; then
  pm2 stop fighting-game-server 2>/dev/null || true
fi
