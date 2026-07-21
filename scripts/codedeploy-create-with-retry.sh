#!/usr/bin/bash
# Create a CodeDeploy deployment; on DeploymentLimitExceededException, wait and retry.
# Does not require codedeploy:ListDeployments.
# Usage: codedeploy-create-with-retry.sh [aws deploy create-deployment args...]
set -euo pipefail

MAX_ATTEMPTS=${MAX_ATTEMPTS:-30}
SLEEP_SEC=${SLEEP_SEC:-30}

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  set +e
  OUT=$(aws deploy create-deployment "$@" 2>&1)
  RC=$?
  set -e

  if [ "$RC" -eq 0 ]; then
    echo "$OUT"
    exit 0
  fi

  if echo "$OUT" | grep -q DeploymentLimitExceededException; then
    BLOCKING=$(echo "$OUT" | sed -n "s/.*Deployment '\\([^']*\\)'.*/\\1/p" | head -1)
    echo "Deployment group busy (attempt ${attempt}/${MAX_ATTEMPTS}). Blocking: ${BLOCKING:-unknown}"
    if [ -n "$BLOCKING" ]; then
      if aws deploy wait deployment-successful --deployment-id "$BLOCKING"; then
        echo "$BLOCKING succeeded."
      else
        STATUS=$(aws deploy get-deployment \
          --deployment-id "$BLOCKING" \
          --query 'deploymentInfo.status' \
          --output text)
        echo "$BLOCKING ended with status: $STATUS"
      fi
    else
      sleep "$SLEEP_SEC"
    fi
    attempt=$((attempt + 1))
    continue
  fi

  echo "$OUT" >&2
  exit "$RC"
done

echo "Timed out waiting for CodeDeploy deployment group to become available." >&2
exit 1
