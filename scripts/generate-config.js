/**
 * Build src/config.js for S3 deploy from environment variables (CI secrets).
 * Usage: node scripts/generate-config.js > dist-client/src/config.js
 */
const cfg = {
  MOCK_AUTH: false,
  COGNITO_REGION: process.env.COGNITO_REGION || "ap-southeast-1",
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || "",
  COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID || "",
  COGNITO_IDENTITY_POOL_ID: process.env.COGNITO_IDENTITY_POOL_ID || "",
  MATCHMAKER_API_BASE: process.env.MATCHMAKER_API_BASE || "",
  MATCHMAKER_POLL_INTERVAL_MS: 2000,
  MATCHMAKER_MAX_POLLS: 60,
  WS_SERVER: process.env.WS_SERVER || "",
};

const required = [
  "COGNITO_USER_POOL_ID",
  "COGNITO_APP_CLIENT_ID",
  "MATCHMAKER_API_BASE",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env for config:", missing.join(", "));
  process.exit(1);
}

console.log(`export const Config = ${JSON.stringify(cfg, null, 2)};`);
