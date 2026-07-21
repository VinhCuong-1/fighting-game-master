# Game Netcode — Developer Guide

**For teammates implementing the WebSocket game server backend.**
This document covers the complete wire protocol, server implementation contract, and mock-to-live migration path.

---

## Overview: What the Netcode Layer Does

The netcode layer sits at step **G3** in the architecture diagram (Game Instance WebSocket):

```
Fighter Sprite      index.js           netcode.js        Game Server (EC2)
      │                 │                  │                    │
      │── getInputs() ->│                  │                    │
      │                 │── sendInputs() ──>│                    │
      │                 │                  │── WS: {"type":    >│
      │                 │                  │    "inputs",...}   │
      │                 │                  │                    │── relay to P2
      │                 │                  │<── {"type":        │
      │                 │                  │  "opponent_inputs"}│
      │<─ p2Inputs ─────│                  │                    │
  (physics runs)        │                  │                    │
```

**Three public functions:**

| Function | Call site | Description |
|---|---|---|
| `connect(wsEndpoint, roomId, slot, idToken, callbacks)` | `index.js` after match found | Opens WS, authenticates, registers handlers |
| `sendInputs(inputs)` | `index.js` every frame | Ships local player inputs to server |
| `disconnect()` | `index.js` on match end / logout | Closes WS gracefully |

---

## Wire Protocol Reference

All messages are JSON strings sent over a WebSocket connection.

### Client → Server

#### `auth` — Authenticate and join a room
Sent **immediately** when the WebSocket `open` event fires.

```json
{
  "type": "auth",
  "idToken": "<Cognito JWT>",
  "roomId":  "alice_bob_1720876543210",
  "slot":     1
}
```

**Server must:**
1. Verify `idToken` using the Cognito JWKS endpoint for your region:
   `https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json`
2. Look up `roomId` in DynamoDB `ActiveMatches` to confirm this player belongs there.
3. Register the socket in an in-memory room map: `rooms[roomId][slot] = socket`.
4. Once **both** slots are connected, broadcast `match_start` (see below).

#### `inputs` — Player input state (sent every frame)
```json
{
  "type": "inputs",
  "l": 0,
  "r": 1,
  "j": 0,
  "a": 0
}
```

Fields: `l` = left, `r` = right, `j` = jump, `a` = attack. Values are `0` or `1`.

**Server must:** relay this as `opponent_inputs` to the **other** socket in the same room.

---

### Server → Client

#### `match_start` — Both players connected, game can begin
```json
{
  "type":     "match_start",
  "yourSlot": 1
}
```
`index.js` receives this, calls `project.greenFlag()`, and starts the netcode frame loop.

#### `opponent_inputs` — Opponent's input state this frame
```json
{
  "type": "opponent_inputs",
  "l": 0,
  "r": 1,
  "j": 1,
  "a": 0
}
```
`index.js` writes this into `project.stage.vars.p1Inputs` or `p2Inputs` (whichever slot belongs to the opponent). The Leopard `Fighter` sprites read these vars inside their `getInputs()` method.

#### `match_end` — Game over
```json
{
  "type":   "match_end",
  "winner": 2
}
```
`winner` is `1`, `2`, or `null` (connection error / disconnect forfeit).

---

## Server Implementation Guide (Node.js + ws)

Minimal reference implementation for the game server. Install with `npm install ws jsonwebtoken jwks-rsa`.

```js
// server.js — Reference game server for EC2 Spot Instance
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const REGION   = process.env.COGNITO_REGION;
const POOL_ID  = process.env.COGNITO_USER_POOL_ID;
const PORT     = process.env.PORT || 9000;

const jwks = jwksClient({
  jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}/.well-known/jwks.json`,
});

// In-memory room store: { [roomId]: { 1: socket, 2: socket } }
const rooms = {};

const wss = new WebSocket.Server({ port: PORT });
console.log(`Game server listening on ws://localhost:${PORT}`);

wss.on("connection", (socket) => {
  socket._authed   = false;
  socket._roomId   = null;
  socket._slot     = null;

  socket.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Handle auth ────────────────────────────────────────────────────
    if (msg.type === "auth") {
      try {
        // 1. Verify Cognito JWT
        await verifyToken(msg.idToken);

        // 2. Register in room
        const { roomId, slot } = msg;
        if (!rooms[roomId]) rooms[roomId] = {};
        rooms[roomId][slot] = socket;

        socket._authed = true;
        socket._roomId = roomId;
        socket._slot   = slot;

        // 3. If both players present, start the match
        if (rooms[roomId][1] && rooms[roomId][2]) {
          [1, 2].forEach((s) => {
            rooms[roomId][s].send(JSON.stringify({ type: "match_start", yourSlot: s }));
          });
        }
      } catch (err) {
        socket.close(4001, "Auth failed: " + err.message);
      }
      return;
    }

    // ── Require auth for all other messages ────────────────────────────
    if (!socket._authed) { socket.close(4001, "Unauthorized"); return; }

    // ── Relay inputs to opponent ───────────────────────────────────────
    if (msg.type === "inputs") {
      const opponentSlot = socket._slot === 1 ? 2 : 1;
      const opponent = rooms[socket._roomId]?.[opponentSlot];
      if (opponent && opponent.readyState === WebSocket.OPEN) {
        opponent.send(JSON.stringify({ type: "opponent_inputs", ...msg }));
      }
    }
  });

  socket.on("close", () => {
    if (!socket._roomId) return;
    const opponentSlot = socket._slot === 1 ? 2 : 1;
    const opponent = rooms[socket._roomId]?.[opponentSlot];
    if (opponent && opponent.readyState === WebSocket.OPEN) {
      opponent.send(JSON.stringify({ type: "match_end", winner: opponentSlot }));
    }
    delete rooms[socket._roomId]?.[socket._slot];
  });
});

// JWT verification using Cognito public keys
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return reject(new Error("Invalid token"));

    jwks.getSigningKey(decoded.header.kid, (err, key) => {
      if (err) return reject(err);
      jwt.verify(token, key.getPublicKey(), { algorithms: ["RS256"] }, (e, payload) => {
        if (e) reject(e); else resolve(payload);
      });
    });
  });
}
```

---

## EC2 Deployment Steps

1. **Launch** an EC2 Spot Instance (Ubuntu 24.04, t3.medium recommended for testing).
2. **Open** Security Group ports: `9000` (TCP) for WebSocket, `22` for SSH.
3. **Install dependencies**:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm
   npm install ws jsonwebtoken jwks-rsa
   ```
4. **Set environment variables**:
   ```bash
   export COGNITO_REGION="ap-southeast-1"
   export COGNITO_USER_POOL_ID="ap-southeast-1_XXXXXXXXX"
   export PORT=9000
   ```
5. **Run with PM2** so it restarts on crashes:
   ```bash
   npm install -g pm2
   pm2 start server.js --name game-server
   pm2 startup && pm2 save
   ```
6. **Update `Config.WS_SERVER`** in `src/config.js` to point to your EC2 public IP:
   ```js
   WS_SERVER: "ws://12.34.56.78:9000",
   ```
   > For production: set up a domain + Nginx + Certbot so you can use `wss://`.

---

## input → Physics: How Opponent Inputs Flow

```
netcode.js                    index.js                   Fighter2.js
    │                              │                           │
    │ onOpponentInputs(inputs) ──> │                           │
    │                              │── stage.vars.p2Inputs     │
    │                              │   = { left, right,        │
    │                              │     jump, attack }        │
    │                              │                           │
    │                              │                           │<── getInputs() reads
    │                              │                           │    p2Inputs when
    │                              │                           │    myPlayerSlot === 1
    │                              │                           │
    │                              │                     runPhysics(inputs)
    │                              │                     updates X, Y, vel
```

The key design principle: **input routing is fully decoupled from the physics engine.** `runPhysics()` in each `Fighter` sprite takes a plain `{ left, right, jump, attack }` object and doesn't care where those inputs came from — local keyboard or network.

This means the exact same `runPhysics()` can run:
- On the **client** (keyboard input)
- On an **EC2 server** (WebSocket input) for server-authoritative mode

---

## Reconnection Behaviour

`netcode.js` will attempt up to **3 reconnections** on unexpected disconnects:

| Attempt | Wait | Action |
|---|---|---|
| 1 | 1.5s | Re-opens WebSocket, re-sends `auth` |
| 2 | 3.0s | Re-opens WebSocket, re-sends `auth` |
| 3 | 4.5s | Re-opens WebSocket, re-sends `auth` |
| Fail | — | Calls `onMatchEnd(null)`, UI returns to lobby |

---

## Mock Mode Behaviour

When `Config.MOCK_AUTH = true`, `netcode.js` uses an internal `_MockSocket` class:

- Sends a fake `match_start` event after 400ms.
- Echoes every `sendInputs()` call back as `opponent_inputs` after 50ms.
- No real network connection is made.

This allows the complete game loop to run locally with both players on the same keyboard.
