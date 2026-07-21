/**
 * netcode.js — WebSocket Game Session Manager
 *
 * Diagram nodes: G3 (Game Instance WebSocket) <-> Game Client
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS FILE DOES
 * ════════════════════════════════════════════════════════════════════════
 *
 *  Once matchmaking.findMatch() resolves, this module:
 *    1. Opens a WebSocket to the assigned game server (EC2 Spot Instance).
 *    2. Authenticates the connection using the Cognito idToken.
 *    3. Sends the local player's inputs to the server every frame.
 *    4. Receives the opponent's inputs from the server and writes them
 *       into stage.vars.p1Inputs / p2Inputs for the Leopard physics engine.
 *    5. Handles reconnection on temporary disconnects (up to 3 retries).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WIRE PROTOCOL (JSON over WebSocket)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  Client -> Server messages:
 *
 *  { "type": "auth", "idToken": "<jwt>", "roomId": "<roomId>", "slot": 1 }
 *    Sent immediately after connection opens. Server validates idToken
 *    and places the client in the correct room.
 *
 *  { "type": "inputs", "l": 0, "r": 1, "j": 0, "a": 0 }
 *    Sent every animation frame (up to 30/s). Fields:
 *      l = left key held (0 or 1)
 *      r = right key held (0 or 1)
 *      j = jump key held (0 or 1)
 *      a = attack key held (0 or 1)
 *
 *  Server -> Client messages:
 *
 *  { "type": "opponent_inputs", "l": 0, "r": 0, "j": 1, "a": 0 }
 *    Broadcast by the server when it receives an "inputs" packet from
 *    the OTHER player in the same room.
 *
 *  { "type": "match_start", "yourSlot": 1 }
 *    Sent by the server once both players have authenticated in the room.
 *    The client uses yourSlot to set stage.vars.myPlayerSlot.
 *
 *  { "type": "match_end", "winner": 1 }
 *    Sent when the server decides the match is over.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  IMPLEMENTING THE BACKEND (for the backend team)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  The game server (EC2 Spot Instance running TurboWarp cloud-server or a
 *  custom Node.js WebSocket server) must:
 *
 *  1. On "auth" message:
 *     - Verify idToken against Cognito JWKS endpoint.
 *     - Look up the roomId in DynamoDB to confirm both players belong there.
 *     - Add the socket to an in-memory room map keyed by roomId.
 *     - Once both slots are filled, broadcast "match_start" to both clients.
 *
 *  2. On "inputs" message:
 *     - Broadcast as "opponent_inputs" to the other socket in the same room.
 *     - Optionally, if running server-authoritative physics, run runPhysics()
 *       with the received inputs and broadcast the resulting state instead.
 *
 *  3. On disconnect:
 *     - Mark the match as forfeit in DynamoDB and broadcast "match_end"
 *       with the remaining player as winner.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK MODE
 * ════════════════════════════════════════════════════════════════════════
 *
 *  When Config.MOCK_AUTH = true, connect() opens no real socket.
 *  Instead, it simulates a "match_start" event and echoes any sendInputs()
 *  call back as "opponent_inputs" (so the opponent sprite also moves).
 *  This lets you fully test the game loop without any server running.
 */

import { Config } from "./config.js";

// ─── Internal state ───────────────────────────────────────────────────────────

let _socket = null;
let _wsEndpoint = null;
let _playerSlot = null;
let _roomId = null;
let _idToken = null;
let _onMatchStartCb = null;
let _onOpponentInputsCb = null;
let _onMatchEndCb = null;
let _reconnectAttempts = 0;
let _reconnectTimer = null;
let _intentionalClose = false;
const MAX_RECONNECT = 3;

// ─── Mock WebSocket shim ──────────────────────────────────────────────────────

class _MockSocket {
  constructor() {
    this._listeners = {};
    // Simulate server confirming the match after a short delay
    setTimeout(() => {
      this._emit("message", {
        data: JSON.stringify({ type: "match_start", yourSlot: 1 }),
      });
    }, 400);
  }

  send(data) {
    const msg = JSON.parse(data);
    if (msg.type === "inputs") {
      // Echo the inputs back as if the opponent is doing the same thing
      setTimeout(() => {
        this._emit("message", {
          data: JSON.stringify({ type: "opponent_inputs", ...msg }),
        });
      }, 50);
    }
  }

  addEventListener(event, cb) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach((cb) => cb(data));
  }

  close() {}
}

// ─── Internal WebSocket lifecycle ─────────────────────────────────────────────

function _attachHandlers(socket) {
  socket.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "match_start":
        _playerSlot = Number(msg.yourSlot);
        if (_onMatchStartCb) _onMatchStartCb(_playerSlot);
        break;

      case "opponent_inputs":
        if (_onOpponentInputsCb) {
          _onOpponentInputsCb({
            left: msg.l || 0,
            right: msg.r || 0,
            jump: msg.j || 0,
            attack: msg.a || 0,
          });
        }
        break;

      case "match_end":
        if (_onMatchEndCb) _onMatchEndCb(msg.winner);
        disconnect();
        break;
    }
  });

  socket.addEventListener("close", () => {
    if (_intentionalClose) return;
    if (_reconnectAttempts < MAX_RECONNECT && _wsEndpoint) {
      _reconnectAttempts++;
      console.warn(`[netcode] WS closed. Reconnecting (${_reconnectAttempts}/${MAX_RECONNECT})...`);
      _reconnectTimer = setTimeout(() => _openSocket(), 1500 * _reconnectAttempts);
    } else if (_reconnectAttempts >= MAX_RECONNECT) {
      console.error("[netcode] Max reconnects reached. Connection failed.");
      if (_onMatchEndCb) _onMatchEndCb(null);
    }
  });

  socket.addEventListener("error", (err) => {
    console.error("[netcode] WebSocket error", err);
  });
}

function _openSocket() {
  const base = _wsEndpoint || Config.WS_SERVER;
  const ws = new WebSocket(`${base}?room=${_roomId}&slot=${_playerSlot}`);

  ws.addEventListener("open", () => {
    _reconnectAttempts = 0;
    _reconnectTimer = null;
    // Authenticate with the server immediately on open
    ws.send(JSON.stringify({
      type: "auth",
      idToken: _idToken,
      roomId: _roomId,
      slot: _playerSlot,
    }));
  });

  _attachHandlers(ws);
  _socket = ws;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * connect() — Opens a WebSocket game session.
 *
 * Call this after matchmaking.findMatch() resolves.
 *
 * @param {string} wsEndpoint   - WebSocket URL from match result (e.g. "wss://...")
 * @param {string} roomId       - Room ID from match result
 * @param {number} playerSlot   - 1 or 2, from match result
 * @param {string} idToken      - Cognito ID token for server-side auth
 * @param {{
 *   onMatchStart: (slot: number) => void,
 *   onOpponentInputs: (inputs: {left,right,jump,attack}) => void,
 *   onMatchEnd: (winnerSlot: number|null) => void
 * }} callbacks
 */
export function connect(wsEndpoint, roomId, playerSlot, idToken, callbacks = {}) {
  _roomId = roomId;
  _playerSlot = Number(playerSlot);
  _wsEndpoint = wsEndpoint || Config.WS_SERVER;
  _idToken = idToken;
  _onMatchStartCb = callbacks.onMatchStart || null;
  _onOpponentInputsCb = callbacks.onOpponentInputs || null;
  _onMatchEndCb = callbacks.onMatchEnd || null;
  _reconnectAttempts = 0;
  _intentionalClose = false;

  console.log("[netcode] connect", {
    wsEndpoint: _wsEndpoint,
    roomId: _roomId,
    playerSlot: _playerSlot,
  });

  if (!_wsEndpoint) {
    console.error("[netcode] No wsEndpoint — cannot open WebSocket");
    if (_onMatchEndCb) _onMatchEndCb(null);
    return;
  }

  if (_playerSlot !== 1 && _playerSlot !== 2) {
    console.error("[netcode] Invalid playerSlot:", playerSlot);
    if (_onMatchEndCb) _onMatchEndCb(null);
    return;
  }

  if (Config.MOCK_AUTH) {
    _socket = new _MockSocket();
    _attachHandlers(_socket);
    return;
  }

  _openSocket();
}

/**
 * sendInputs() — Sends the local player's current input state to the server.
 *
 * Call this every game frame from index.js (after reading local keyboard state
 * from the Fighter1 or Fighter2 sprite, depending on myPlayerSlot).
 *
 * The server broadcasts these to the opponent's client as "opponent_inputs".
 *
 * @param {{ left: number, right: number, jump: number, attack: number }} inputs
 */
export function sendInputs(inputs) {
  if (!_socket) return;
  const msg = JSON.stringify({
    type: "inputs",
    l: inputs.left ? 1 : 0,
    r: inputs.right ? 1 : 0,
    j: inputs.jump ? 1 : 0,
    a: inputs.attack ? 1 : 0,
  });
  if (typeof _socket.send === "function") {
    if (_socket.readyState === undefined || _socket.readyState === 1) {
      _socket.send(msg);
    }
  }
}

/**
 * disconnect() — Closes the WebSocket connection and clears all state.
 * Call this on match end, logout, or fatal errors.
 */
export function disconnect() {
  _intentionalClose = true;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _wsEndpoint = null;
  if (_socket) {
    try {
      _socket.close();
    } catch {
      /* ignore */
    }
    _socket = null;
  }
  _playerSlot = null;
  _roomId = null;
  _idToken = null;
}

/**
 * isConnected() — Returns true if a WebSocket session is active.
 * @returns {boolean}
 */
export function isConnected() {
  return _socket !== null;
}
