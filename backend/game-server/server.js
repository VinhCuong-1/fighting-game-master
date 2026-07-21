/**
 * Fighting Game WebSocket relay (EC2 / ASG Spot fleet).
 * Deploy via CI: .github/workflows/deploy.yml -> S3 -> CodeDeploy.
 * Phase 3: on disconnect, mark ActiveMatches status=finished for Flow E Streams.
 */
const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.COGNITO_REGION || "ap-southeast-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID;
const PORT = Number(process.env.PORT || 9000);
const MATCHES_TABLE = process.env.MATCHES_TABLE || "ActiveMatches";

if (!POOL_ID) {
  console.error("COGNITO_USER_POOL_ID is required");
  process.exit(1);
}

const jwks = jwksClient({
  jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

const rooms = {};

function countRooms() {
  return Object.keys(rooms).filter(
    (id) => rooms[id][1] || rooms[id][2]
  ).length;
}

/**
 * Write finished fields on both players' ActiveMatches rows (PK = playerId).
 * Streams → FightingGameMatchAnalytics copies into MatchAnalytics.
 */
async function markMatchFinished(roomId, winnerSlot, endReason) {
  const room = rooms[roomId];
  if (!room) return;

  const endedAt = Math.floor(Date.now() / 1000);
  const playerIds = [room[1]?._playerId, room[2]?._playerId].filter(Boolean);
  if (playerIds.length === 0) {
    console.warn("markMatchFinished: no playerIds for room", roomId);
    return;
  }

  await Promise.all(
    playerIds.map((playerId) =>
      ddb.send(
        new UpdateCommand({
          TableName: MATCHES_TABLE,
          Key: { playerId },
          UpdateExpression:
            "SET #s = :finished, winner = :winner, endedAt = :endedAt, endReason = :endReason",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":finished": "finished",
            ":winner": winnerSlot,
            ":endedAt": endedAt,
            ":endReason": endReason,
          },
        })
      )
    )
  );
  console.log("Marked finished", {
    roomId,
    winnerSlot,
    endReason,
    playerIds,
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: countRooms() }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`Game server listening on http://0.0.0.0:${PORT} (WS + /health)`);
});

wss.on("connection", (socket) => {
  socket._authed = false;
  socket._roomId = null;
  socket._slot = null;
  socket._playerId = null;

  socket.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "auth") {
      try {
        const payload = await verifyToken(msg.idToken);
        const roomId = String(msg.roomId || "");
        const slot = Number(msg.slot);
        if (!roomId || (slot !== 1 && slot !== 2)) {
          socket.close(4001, "Auth failed: invalid roomId/slot");
          return;
        }
        if (!rooms[roomId]) rooms[roomId] = {};
        // Replace any stale socket in this slot (reconnect / refresh).
        rooms[roomId][slot] = socket;
        socket._authed = true;
        socket._roomId = roomId;
        socket._slot = slot;
        socket._playerId = payload.sub;
        console.log("auth ok", {
          roomId,
          slot,
          playerId: payload.sub,
          filled: !!(rooms[roomId][1] && rooms[roomId][2]),
        });

        if (rooms[roomId][1] && rooms[roomId][2]) {
          [1, 2].forEach((s) => {
            const peer = rooms[roomId][s];
            if (peer && peer.readyState === WebSocket.OPEN) {
              peer.send(
                JSON.stringify({ type: "match_start", yourSlot: s })
              );
            }
          });
          console.log("match_start sent", roomId);
        }
      } catch (err) {
        console.error("auth failed", err.message);
        socket.close(4001, "Auth failed: " + err.message);
      }
      return;
    }

    if (!socket._authed) {
      socket.close(4001, "Unauthorized");
      return;
    }

    if (msg.type === "inputs") {
      const opponentSlot = socket._slot === 1 ? 2 : 1;
      const opponent = rooms[socket._roomId]?.[opponentSlot];
      if (opponent && opponent.readyState === WebSocket.OPEN) {
        const { l, r, j, a } = msg;
        opponent.send(
          JSON.stringify({ type: "opponent_inputs", l, r, j, a })
        );
      }
    }
  });

  socket.on("close", async () => {
    if (!socket._roomId) return;
    const roomId = socket._roomId;
    const opponentSlot = socket._slot === 1 ? 2 : 1;
    const opponent = rooms[roomId]?.[opponentSlot];
    const winnerSlot = opponent ? opponentSlot : null;

    try {
      await markMatchFinished(roomId, winnerSlot, "disconnect");
    } catch (err) {
      console.error("markMatchFinished failed", err);
    }

    if (opponent && opponent.readyState === WebSocket.OPEN) {
      opponent.send(
        JSON.stringify({ type: "match_end", winner: opponentSlot })
      );
    }
    delete rooms[roomId]?.[socket._slot];
  });
});

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return reject(new Error("Invalid token"));

    jwks.getSigningKey(decoded.header.kid, (err, key) => {
      if (err) return reject(err);
      jwt.verify(
        token,
        key.getPublicKey(),
        { algorithms: ["RS256"] },
        (e, payload) => {
          if (e) reject(e);
          else resolve(payload);
        }
      );
    });
  });
}
