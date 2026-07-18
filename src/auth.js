/**
 * auth.js — Player Authentication Layer
 *
 * Diagram nodes: A1 (Player Login) -> A2 (Cognito User Pool) ->
 *                A3 (Cognito Identity Pool) -> A5 (Issue Token)
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS FILE DOES
 * ════════════════════════════════════════════════════════════════════════
 *
 *  This module wraps all Cognito authentication into three simple functions:
 *    - login(username, password)  -> returns { idToken, userId }
 *    - getSession()               -> returns cached session or refreshes
 *    - logout()                   -> clears local session
 *
 *  In MOCK_AUTH mode (Config.MOCK_AUTH = true) these functions return
 *  fake data immediately so the rest of the game works without any AWS setup.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  IMPLEMENTING REAL COGNITO (for the backend team)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  Step 1: Create a Cognito User Pool in the AWS Console.
 *    - Region: match Config.COGNITO_REGION
 *    - Sign-in: Username + Password
 *    - App Client: Create with no secret (browser clients can't store secrets)
 *    - Copy Pool ID  -> Config.COGNITO_USER_POOL_ID
 *    - Copy Client ID -> Config.COGNITO_APP_CLIENT_ID
 *
 *  Step 2: Create a Cognito Identity Pool.
 *    - Link it to the User Pool created above.
 *    - Enable "Authenticated access".
 *    - Attach an IAM role that allows s3:GetObject on your asset bucket.
 *    - Copy Identity Pool ID -> Config.COGNITO_IDENTITY_POOL_ID
 *
 *  Step 3: Set Config.MOCK_AUTH = false.
 *    The real Cognito SDK path below will activate automatically.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  TOKEN LIFECYCLE
 * ════════════════════════════════════════════════════════════════════════
 *
 *  After login(), three tokens are returned by Cognito:
 *    - idToken    (JWT, ~1 hour)  — sent in Authorization header to API Gateway
 *    - accessToken (JWT, ~1 hour) — used for Cognito API calls
 *    - refreshToken (30 days)     — stored in localStorage, used to silently renew
 *
 *  The idToken is what the API Gateway Cognito Authorizer validates (A5).
 *  matchmaking.js reads it via getSession().idToken.
 */

import { Config } from "./config.js";

// ─── In-memory session cache ──────────────────────────────────────────────────
let _session = null;

// ─── Mock helpers ─────────────────────────────────────────────────────────────
function _mockSession(username) {
  return {
    idToken: "MOCK_JWT_" + btoa(username + ":" + Date.now()),
    accessToken: "MOCK_ACCESS",
    refreshToken: "MOCK_REFRESH",
    userId: "mock-user-" + username.toLowerCase().replace(/\s+/g, "-"),
    username,
  };
}

// ─── Real Cognito helpers (activated when MOCK_AUTH = false) ──────────────────

/**
 * Dynamically loads the amazon-cognito-identity-js SDK from CDN.
 * This avoids bundler requirements — works in plain ES modules.
 */
async function _loadCognitoSdk() {
  if (window.AmazonCognitoIdentity) return window.AmazonCognitoIdentity;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://unpkg.com/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js";
    script.onload = () => resolve(window.AmazonCognitoIdentity);
    script.onerror = () => reject(new Error("Failed to load Cognito SDK"));
    document.head.appendChild(script);
  });
}

/**
 * Performs real Cognito USER_PASSWORD_AUTH flow.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{idToken, accessToken, refreshToken, userId, username}>}
 */
async function _cognitoLogin(username, password) {
  const AmazonCognitoIdentity = await _loadCognitoSdk();

  const userPool = new AmazonCognitoIdentity.CognitoUserPool({
    UserPoolId: Config.COGNITO_USER_POOL_ID,
    ClientId: Config.COGNITO_APP_CLIENT_ID,
  });

  const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
    Username: username,
    Password: password,
  });

  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
    Username: username,
    Pool: userPool,
  });

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess(result) {
        const idToken = result.getIdToken().getJwtToken();
        const accessToken = result.getAccessToken().getJwtToken();
        const refreshToken = result.getRefreshToken().getToken();
        const userId = result.getIdToken().payload.sub; // Cognito unique user ID

        // Persist refresh token for silent renewal
        localStorage.setItem("fg_refresh_token", refreshToken);

        resolve({ idToken, accessToken, refreshToken, userId, username });
      },
      onFailure(err) {
        reject(new Error(err.message || "Authentication failed"));
      },
      newPasswordRequired() {
        reject(new Error("Password reset required. Use the AWS Cognito console."));
      },
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * login() — Authenticates a player.
 *
 * In MOCK mode: accepts any credentials and returns a fake session.
 * In LIVE mode: runs Cognito USER_PASSWORD_AUTH and returns real JWTs.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{idToken: string, userId: string, username: string}>}
 * @throws {Error} if authentication fails
 */
export async function login(username, password) {
  if (!username || !password) {
    throw new Error("Username and password are required.");
  }

  if (Config.MOCK_AUTH) {
    // Simulate a small network delay so the UI feels realistic
    await new Promise((r) => setTimeout(r, 600));
    _session = _mockSession(username);
  } else {
    _session = await _cognitoLogin(username, password);
  }

  return { idToken: _session.idToken, userId: _session.userId, username: _session.username };
}

/**
 * getSession() — Returns the current cached session.
 *
 * Call this anywhere you need the idToken (e.g., in matchmaking.js
 * to attach to the Authorization header of API Gateway requests).
 *
 * @returns {{ idToken, userId, username } | null}
 */
export function getSession() {
  return _session;
}

/**
 * logout() — Clears the session and all stored tokens.
 *
 * Call this when the player clicks a logout button or when a
 * fatal network error requires re-authentication.
 */
export function logout() {
  _session = null;
  localStorage.removeItem("fg_refresh_token");
}

// ─── Sign Up (self-registration) ────────────────────────────────────────────

/**
 * signUp() — Registers a new user in the Cognito User Pool.
 *
 * After success, Cognito sends a verification code to the provided email.
 * Call confirmSignUp() with that code to activate the account.
 *
 * @param {string} username
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ userSub: string }>}
 * @throws {Error} if registration fails
 */
export async function signUp(username, email, password) {
  if (!username || !email || !password) {
    throw new Error("Username, email, and password are required.");
  }

  const AmazonCognitoIdentity = await _loadCognitoSdk();

  const userPool = new AmazonCognitoIdentity.CognitoUserPool({
    UserPoolId: Config.COGNITO_USER_POOL_ID,
    ClientId: Config.COGNITO_APP_CLIENT_ID,
  });

  const attributeEmail = new AmazonCognitoIdentity.CognitoUserAttribute({
    Name: "email",
    Value: email,
  });

  return new Promise((resolve, reject) => {
    userPool.signUp(username, password, [attributeEmail], null, (err, result) => {
      if (err) {
        reject(new Error(err.message || "Sign up failed"));
      } else {
        resolve({ userSub: result.userSub });
      }
    });
  });
}

/**
 * confirmSignUp() — Confirms a new user with the verification code sent to their email.
 *
 * @param {string} username
 * @param {string} code — 6-digit verification code from email
 * @returns {Promise<string>} — "SUCCESS" on success
 * @throws {Error} if confirmation fails
 */
export async function confirmSignUp(username, code) {
  if (!username || !code) {
    throw new Error("Username and verification code are required.");
  }

  const AmazonCognitoIdentity = await _loadCognitoSdk();

  const userPool = new AmazonCognitoIdentity.CognitoUserPool({
    UserPoolId: Config.COGNITO_USER_POOL_ID,
    ClientId: Config.COGNITO_APP_CLIENT_ID,
  });

  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
    Username: username,
    Pool: userPool,
  });

  return new Promise((resolve, reject) => {
    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) {
        reject(new Error(err.message || "Confirmation failed"));
      } else {
        resolve(result);
      }
    });
  });
}
