/**
 * matchmaking.js — Matchmaking API Client
 *
 * Diagram nodes: R1 (Matchmaking Request) -> R2 (API Gateway) ->
 *                Lambda MatchMaker -> R4 (Write Match State)
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS FILE DOES
 * ════════════════════════════════════════════════════════════════════════
 *
 *  This module manages the full matchmaking lifecycle:
 *    1. joinQueue(idToken, userId)
 *       POST /join  ->  adds player to DynamoDB queue via Lambda.
 *
 *    2. pollForMatch(userId)
 *       GET /check?playerId=...  ->  checks if Lambda paired us with someone.
 *
 *    3. findMatch(idToken, userId, onStatusUpdate)
 *       Combines the above into a single async call. Resolves when a match
 *       is found. Rejects after MATCHMAKER_MAX_POLLS attempts.
 *       Returns: { roomId, playerSlot, wsEndpoint }
 *
 * ════════════════════════════════════════════════════════════════════════
 *  IMPLEMENTING THE BACKEND (for the backend team)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  The API Gateway must expose two routes (both protected by a Cognito
 *  Authorizer that validates the idToken passed in the Authorization header):
 *
 *  POST /join
 *    Request body:  { "playerId": "<userId>" }
 *    Response body: { "status": "queued" }
 *                   { "status": "matched", "match": { roomId, playerSlot, wsEndpoint } }
 *
 *  GET /check?playerId=<userId>
 *    Response body: { "status": "waiting" }
 *                   { "status": "matched", "match": { roomId, playerSlot, wsEndpoint } }
 *
 *  The Lambda behind both routes should read/write the DynamoDB tables
 *  described in the architecture guide (MatchmakingQueue + ActiveMatches).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK MODE
 * ════════════════════════════════════════════════════════════════════════
 *
 *  When Config.MOCK_AUTH = true:
 *    - joinQueue resolves immediately with { status: "queued" }
 *    - After 3 seconds of polling, pollForMatch returns a hardcoded match:
 *      { roomId: "mock-room-001", playerSlot: 1, wsEndpoint: Config.WS_SERVER }
 */

import { Config } from "./config.js";

// ─── Internal helpers ─────────────────────────────────────────────────────────

let _mockPollCount = 0;

/**
 * Makes an authenticated HTTP request to the API Gateway.
 * Attaches the Cognito idToken as a Bearer token in the Authorization header.
 */
async function _apiRequest(method, path, idToken, body = null) {
  const url = Config.MATCHMAKER_API_BASE + path;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + idToken,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * joinQueue() — Adds the player to the matchmaking queue.
 *
 * Corresponds to: POST /join on API Gateway -> Lambda MatchMaker.
 *
 * @param {string} idToken  - Cognito ID token from auth.getSession()
 * @param {string} userId   - Cognito user sub / mock user ID
 * @returns {Promise<{ status: "queued" | "matched", match?: object }>}
 */
export async function joinQueue(idToken, userId) {
  if (Config.MOCK_AUTH) {
    _mockPollCount = 0; // reset poll counter for this session
    return { status: "queued" };
  }
  return _apiRequest("POST", "/join", idToken, { playerId: userId });
}

/**
 * pollForMatch() — Checks if the server has paired this player with an opponent.
 *
 * Corresponds to: GET /check?playerId=... on API Gateway -> Lambda MatchMaker.
 *
 * @param {string} idToken
 * @param {string} userId
 * @returns {Promise<{ status: "waiting" | "matched", match?: { roomId, playerSlot, wsEndpoint } }>}
 */
export async function pollForMatch(idToken, userId) {
  if (Config.MOCK_AUTH) {
    _mockPollCount++;
    // Simulate ~3 seconds of searching (at default 2s interval = ~2 polls)
    if (_mockPollCount >= 2) {
      return {
        status: "matched",
        match: {
          roomId: "mock-room-001",
          playerSlot: 1,
          wsEndpoint: Config.WS_SERVER,
        },
      };
    }
    return { status: "waiting" };
  }
  return _apiRequest("GET", `/check?playerId=${encodeURIComponent(userId)}`, idToken);
}

/**
 * findMatch() — Full matchmaking flow. Joins the queue then polls until matched.
 *
 * This is the only function the UI needs to call directly.
 *
 * @param {string} idToken       - From auth.getSession().idToken
 * @param {string} userId        - From auth.getSession().userId
 * @param {Function} onStatus    - Optional callback called with a status string
 *                                 so the UI can display "Searching... (2/60)"
 * @returns {Promise<{ roomId: string, playerSlot: number, wsEndpoint: string }>}
 * @throws {Error} if polling times out or a network error occurs
 */
export async function findMatch(idToken, userId, onStatus = () => {}) {
  onStatus("Joining queue...");
  const joinResult = await joinQueue(idToken, userId);

  // Edge case: server matched us immediately on the join request
  if (joinResult.status === "matched") {
    return joinResult.match;
  }

  onStatus("Searching for opponent...");
  let polls = 0;

  while (polls < Config.MATCHMAKER_MAX_POLLS) {
    await new Promise((r) => setTimeout(r, Config.MATCHMAKER_POLL_INTERVAL_MS));
    polls++;
    onStatus(`Searching for opponent... (${polls}/${Config.MATCHMAKER_MAX_POLLS})`);

    const result = await pollForMatch(idToken, userId);
    if (result.status === "matched") {
      return result.match; // { roomId, playerSlot, wsEndpoint }
    }
  }

  throw new Error(
    "Matchmaking timed out. No opponent found after " +
      Config.MATCHMAKER_MAX_POLLS * Config.MATCHMAKER_POLL_INTERVAL_MS / 1000 +
      "s. Please try again."
  );
}
