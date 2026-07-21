# Fighting Game — Programming Guide

How this repository’s code works end-to-end: browser client, matchmaking Lambda, WebSocket game server, analytics Lambda, and CI deploy wiring.

---

## 1. What the product does

Two players open the same static web app, log in, find a match, then play a 1v1 fighter over the network.

| Layer | Responsibility |
|-------|----------------|
| **Browser client** | UI (login / lobby / canvas), Cognito auth, matchmaking HTTP, WebSocket inputs, Leopard game loop |
| **MatchMaker Lambda** | Queue players, pair them, pick a warm EC2 host, write `ActiveMatches` |
| **Game server (EC2)** | Authenticate WS clients, relay inputs, mark matches finished |
| **Analytics Lambda** | DynamoDB Streams on finished matches → `MatchAnalytics` |

The browser game UI is **never** served from EC2. EC2 only runs the WebSocket relay on port **9000**.

---

## 2. Repository map (code that matters)

```
fighting-game-master/
├── index.html              # Screens: login, lobby, game canvas, HUD
├── index.js                # App entry: wires auth + matchmaking + netcode + Leopard
├── src/
│   ├── config.example.js   # Template → copy to config.js (gitignored) for local
│   ├── auth.js             # Cognito login / signup / session
│   ├── matchmaking.js      # POST /join + poll GET /check
│   └── netcode.js          # WebSocket session (auth, inputs, match_start/end)
├── Stage/ Stage.js         # Backdrop + stage vars (slots, inputs, roundActive)
├── Fighter1/ Fighter1.js   # Human fighter physics + local/remote inputs
├── Fighter2/ Fighter2.js   # Demon fighter (same keys on each machine)
├── Hitbox1/ Hitbox2/       # Attack hitboxes (Leopard sprites)
├── assets/                 # Sprites, stages, sounds
├── backend/
│   ├── lambda-matchmaker.mjs       # Deployed as FightingGameMatchmaker (index.mjs)
│   ├── lambda-match-analytics.mjs  # Deployed as FightingGameMatchAnalytics
│   └── game-server/
│       ├── server.js               # WS relay + DynamoDB finish write
│       ├── appspec.yml             # CodeDeploy EC2 hooks
│       ├── scripts/application_*.sh
│       ├── package.json / lock
│       └── fighting-game.env.example
├── scripts/
│   ├── generate-config.js          # CI builds src/config.js for S3 bundle
│   ├── codedeploy-create-with-retry.sh
│   └── codedeploy-wait-idle.sh
└── .github/workflows/
    ├── deploy.yml                  # S3 client + Lambda CodeDeploy + EC2 CodeDeploy
    └── ci.yml
```

Secrets / local-only (not committed): `src/config.js`, `backend/game-server/fighting-game.env`.

---

## 3. Runtime sequence

```
1. Load S3 (or local) index.html → index.js
2. auth.login → Cognito → { idToken, userId: sub }
3. findMatch(idToken, userId)
     POST /join  → queue or immediate match
     GET  /check → poll until { roomId, playerSlot, wsEndpoint }
4. index.js builds Leopard Project, opens WS to wsEndpoint
5. Both clients send { type: auth, idToken, roomId, slot }
6. Server sends { type: match_start, yourSlot }
7. greenFlag + 3-2-1 countdown → roundActive=1
8. Each frame: local getInputs() → sendInputs() → opponent gets opponent_inputs
9. Disconnect / KO / time → finishRound; server UpdateItem status=finished
10. Stream → MatchAnalytics Lambda → MatchAnalytics table
```

---

## 4. Browser client

### 4.1 `index.js` (orchestrator)

- **Screens:** `showScreen("screen-login" | "screen-lobby" | "screen-game")`
- **Match start:** validates `roomId`, `playerSlot` ∈ {1,2}, non-empty `wsEndpoint`
- **On `match_start`:** sets `myPlayerSlot`, zeroes `p1Inputs`/`p2Inputs`, `project.greenFlag()`, `startRound()`, `startNetcodeLoop(slot)`
- **Netcode loop:** every animation frame, read local fighter `getInputs()` and `sendInputs()`
- **Round rules:** 3s countdown (`roundActive=0` → inputs forced zero), then 60s timer; KO or timeout ends round and `disconnect()`

Controls (both players on separate machines): **A / D / W / J**.

### 4.2 `src/auth.js`

- `MOCK_AUTH: true` → fake JWT (local offline)
- `MOCK_AUTH: false` → Cognito `USER_PASSWORD_AUTH` via browser fetch to Cognito IdP
- Session: `idToken`, `accessToken`, `refreshToken`, `userId` (`sub`)
- Used by matchmaking (Bearer) and netcode (WS auth message)

### 4.3 `src/matchmaking.js`

- `joinQueue` → `POST {MATCHMAKER_API_BASE}/join`
- `pollForMatch` → `GET .../check?playerId=...`
- `findMatch` loops until `status === "matched"` or max polls
- Returns `{ roomId, playerSlot, wsEndpoint }`

### 4.4 `src/netcode.js`

| Direction | Message |
|-----------|---------|
| Client → server | `{ type: "auth", idToken, roomId, slot }` |
| Client → server | `{ type: "inputs", l, r, j, a }` (0/1) |
| Server → client | `{ type: "match_start", yourSlot }` |
| Server → client | `{ type: "opponent_inputs", l, r, j, a }` |
| Server → client | `{ type: "match_end", winner }` |

- Opens `WebSocket(wsEndpoint)`
- Reconnects up to 3 times unless `disconnect()` set intentional close
- Mock mode echoes inputs as opponent for solo testing

### 4.5 Fighters (`Fighter1` / `Fighter2`)

- Leopard generators: `*whenGreenFlag` → `while (true) { physics; yield }`
- `getInputs()`:
  - If `!roundActive` → all zeros
  - Local slot uses keyboard; remote slot reads `stage.vars.p1Inputs` / `p2Inputs`
- Attack sound is fire-and-forget (`startSound`, not `yield*`) so a missing wav cannot freeze the loop

### 4.6 Config

Local: copy `src/config.example.js` → `src/config.js`.

CI: `scripts/generate-config.js` writes `dist-client/src/config.js` from GitHub secrets (`COGNITO_*`, `MATCHMAKER_API_BASE`, `WS_SERVER`).

---

## 5. MatchMaker Lambda (`backend/lambda-matchmaker.mjs`)

Deployed as **`FightingGameMatchmaker`**, handler `index.handler`, alias **`live`**.

### Env

| Variable | Purpose |
|----------|---------|
| `QUEUE_TABLE` | `MatchmakingQueue` |
| `MATCHES_TABLE` | `ActiveMatches` |
| `GAME_SERVER_TAG_KEY` / `VALUE` | Find hosts (`Role` / `FightingGameServer`) |
| `WS_PORT` | Usually `9000` |
| `WS_ENDPOINT` | Fallback if DescribeInstances finds nothing |

### Routes (API Gateway)

| Method | Path | Behavior |
|--------|------|----------|
| `OPTIONS` | * | CORS |
| `POST` | `/join` | `clearSession` then queue or pair |
| `GET` | `/check` | Return match if present |

Player id comes from Cognito authorizer claims (`sub`), not from trusting the body alone.

### Pairing logic

1. `clearSession(playerId)` — delete this player’s (and opponent’s) queue + match rows so rematch works  
2. Scan queue for another waiting player  
3. `resolveGameEndpoint()` — `DescribeInstances` tagged running hosts with public IP; stable sort by `instanceId`; build `ws://ip:port`  
4. Write two `ActiveMatches` items (`playerSlot` 1 and 2, shared `roomId`, `status: "active"`)  
5. Return `{ status: "matched", match: { roomId, playerSlot, wsEndpoint } }`

Runs in **private subnets** with VPC endpoints to DynamoDB + EC2 API (no NAT). That is infrastructure; this file does not contain VPC config.

---

## 6. Game server (`backend/game-server/server.js`)

Node HTTP + `ws` on `PORT` (default 9000).

### Responsibilities

1. **`GET /health`** → `{ status, rooms }` (ASG / ops)  
2. **WS `auth`** — verify Cognito JWT via JWKS; store `roomId`, numeric `slot` 1|2, `playerId=sub`  
3. When both slots filled → broadcast `match_start`  
4. **`inputs`** → forward as `opponent_inputs` to the other socket  
5. **`close`** → `markMatchFinished` (DynamoDB `UpdateItem` both player rows: `status=finished`, `winner`, `endedAt`, `endReason`) then notify remaining client with `match_end`

### Env (from CI `fighting-game.env` or `/etc/fighting-game.env`)

`COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `MATCHES_TABLE`, `PORT`

### CodeDeploy

- `appspec.yml` copies tree to `/home/ubuntu/fighting-game-server`  
- `application_stop.sh` — PM2 stop  
- `application_start.sh` — source env, `npm ci`, PM2 start, health poll  

---

## 7. Analytics Lambda (`backend/lambda-match-analytics.mjs`)

Triggered by **DynamoDB Streams** on `ActiveMatches` (`NEW_AND_OLD_IMAGES`).

- On `MODIFY`/`INSERT` with `NewImage.status === "finished"` → `PutItem` `MatchAnalytics`  
- On `REMOVE` with finished `OldImage` → same (rematch delete race)  
- PK: `roomId` (last writer wins if both player rows stream)

Env: `ANALYTICS_TABLE=MatchAnalytics`

---

## 8. Data contracts (programming view)

### `ActiveMatches` (PK `playerId`)

While playing: `roomId`, `playerSlot`, `opponentId`, `wsEndpoint`, `status=active`, timestamps…  
On end (written by EC2): `status=finished`, `winner`, `endedAt`, `endReason`

### `MatchmakingQueue` (PK `playerId`)

Waiting players until paired.

### `MatchAnalytics` (PK `roomId`)

Async copy of finished match fields for reporting; not deleted by rematch.

---

## 9. CI / deploy (code paths)

`.github/workflows/deploy.yml` on `master`:

1. Package `lambda-matchmaker.mjs` → update function → publish version → CodeDeploy traffic to alias `live`  
2. Build client with `generate-config.js` → `aws s3 sync` to assets bucket  
3. Zip `backend/game-server` (with generated `fighting-game.env`) → S3 → CodeDeploy EC2 fleet (`Role=FightingGameServer`)

Helper scripts under `scripts/` only support that pipeline (retry create-deployment, wait idle).

---

## 10. Local development

```bash
# Client
cp src/config.example.js src/config.js   # fill Cognito + API + WS
npx serve .                              # or any static server

# Optional: game server locally
cd backend/game-server
cp fighting-game.env.example fighting-game.env
npm ci
node server.js                           # :9000
```

Set `MOCK_AUTH: true` to exercise lobby/game without Cognito (mock match + mock WS).

---

## 11. Mental model

```
index.js
  ├── auth.js          → Cognito JWT
  ├── matchmaking.js   → API Gateway → lambda-matchmaker.mjs → DynamoDB + EC2 describe
  ├── netcode.js       → game-server/server.js (WS relay + finish write)
  └── Leopard sprites  → physics; remote inputs from netcode callbacks
                              ↓
                    lambda-match-analytics.mjs ← DynamoDB Streams
```

That is the entire programming surface of this project.
