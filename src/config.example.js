/**
 * config.example.js — Template for src/config.js
 *
 * SETUP INSTRUCTIONS:
 *   cp src/config.example.js src/config.js
 *   Then fill in the STUB values below with real AWS values.
 *   Never commit src/config.js (it is in .gitignore).
 */

export const Config = {
  MOCK_AUTH: true,                         // Set false when AWS is ready
  COGNITO_REGION: "ap-southeast-1",
  COGNITO_USER_POOL_ID: "STUB",
  COGNITO_APP_CLIENT_ID: "STUB",
  COGNITO_IDENTITY_POOL_ID: "STUB",
  MATCHMAKER_API_BASE: "http://localhost:3001",
  MATCHMAKER_POLL_INTERVAL_MS: 2000,
  MATCHMAKER_MAX_POLLS: 60,
  WS_SERVER: "ws://localhost:9000",
};
