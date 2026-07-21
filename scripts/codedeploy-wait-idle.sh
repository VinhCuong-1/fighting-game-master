#!/usr/bin/bash
# Wait until a CodeDeploy deployment group has no blocking in-flight deployments.
# Usage: codedeploy-wait-idle.sh <application> <deployment-group> [label]
set -euo pipefail

APP=${1:?application name required}
DG=${2:?deployment group name required}
LABEL=${3:-CodeDeploy}

while true; do
  ACTIVE=$(aws deploy list-deployments \
    --application-name "$APP" \
    --deployment-group-name "$DG" \
    --include-only-statuses Created Queued InProgress Ready Baking \
    --query 'deployments' \
    --output text)

  if [ -z "$ACTIVE" ] || [ "$ACTIVE" = "None" ]; then
    echo "$LABEL: deployment group is idle."
    exit 0
  fi

  for DEPLOY in $ACTIVE; do
    echo "$LABEL: waiting for active deployment $DEPLOY ..."
    if aws deploy wait deployment-successful --deployment-id "$DEPLOY"; then
      echo "$DEPLOY succeeded."
    else
      STATUS=$(aws deploy get-deployment \
        --deployment-id "$DEPLOY" \
        --query 'deploymentInfo.status' \
        --output text)
      echo "$DEPLOY ended with status: $STATUS"
    fi
  done

  sleep 10
done
