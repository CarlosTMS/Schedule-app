#!/usr/bin/env bash
set -euo pipefail

# Deploy this app to SAP BTP Cloud Foundry using your local CF credentials/session.
#
# Usage:
#   ./deploy_btp_cf.sh [APP_NAME]
#
# Optional env vars:
#   BTP_CF_API     e.g. https://api.cf.us10.hana.ondemand.com
#   BTP_CF_ORG     target org
#   BTP_CF_SPACE   target space
#
# Notes:
# - If already logged in with `cf login`, this script reuses your current session.
# - If BTP_CF_API/ORG/SPACE are provided, script will retarget automatically.

APP_NAME="${1:-scheduler-app}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST_FILE="${ROOT_DIR}/manifest.yml"

if ! command -v cf >/dev/null 2>&1; then
  echo "ERROR: Cloud Foundry CLI (cf) is not installed."
  echo "Install from: https://github.com/cloudfoundry/cli/releases"
  exit 1
fi

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "ERROR: manifest.yml not found at ${MANIFEST_FILE}"
  exit 1
fi

echo "==> Checking CF authentication..."
if ! cf oauth-token >/dev/null 2>&1; then
  echo "ERROR: You are not logged in to Cloud Foundry."
  echo "Run: cf login"
  exit 1
fi

if [[ -n "${BTP_CF_API:-}" ]]; then
  echo "==> Setting CF API: ${BTP_CF_API}"
  cf api "${BTP_CF_API}"
fi

if [[ -n "${BTP_CF_ORG:-}" && -n "${BTP_CF_SPACE:-}" ]]; then
  echo "==> Targeting org/space: ${BTP_CF_ORG} / ${BTP_CF_SPACE}"
  cf target -o "${BTP_CF_ORG}" -s "${BTP_CF_SPACE}"
fi

echo "==> Current target:"
cf target

echo "==> Building frontend bundle locally (dist/)..."
npm run build

echo "==> Deploying app '${APP_NAME}' to Cloud Foundry..."
cf push -f "${MANIFEST_FILE}" --var "app_name=${APP_NAME}"

echo "==> Deployment completed."
ROUTES_LINE="$(cf app "${APP_NAME}" | sed -n 's/^routes:[[:space:]]*//p' | head -n1 || true)"
if [[ -n "${ROUTES_LINE}" ]]; then
  FIRST_ROUTE="$(echo "${ROUTES_LINE}" | cut -d',' -f1 | xargs)"
  echo "App route: https://${FIRST_ROUTE}"
  echo "Health check: https://${FIRST_ROUTE}/health"
fi
