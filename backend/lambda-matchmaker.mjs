/**
 * Lambda MatchMaker — handler: index.handler (deploy as index.mjs).
 * Phase 1: assign wsEndpoint from warm-pool EC2 tagged Role=FightingGameServer.
 * Rematch: clearSession() before re-queueing.
 */
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ec2 = new EC2Client({});
const QUEUE_TABLE = process.env.QUEUE_TABLE;
const MATCHES_TABLE = process.env.MATCHES_TABLE;
const GAME_SERVER_TAG_KEY = process.env.GAME_SERVER_TAG_KEY || "Role";
const GAME_SERVER_TAG_VALUE =
  process.env.GAME_SERVER_TAG_VALUE || "FightingGameServer";
const WS_PORT = process.env.WS_PORT || "9000";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
};

function response(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

function getPlayerId(event) {
  return (
    event.requestContext?.authorizer?.claims?.sub ||
    event.requestContext?.authorizer?.jwt?.claims?.sub ||
    null
  );
}

function getMethod(event) {
  return event.requestContext?.http?.method || event.httpMethod || "";
}

function getPath(event) {
  return event.rawPath || event.path || event.resource || "";
}

function matchPayload(item) {
  return {
    roomId: item.roomId,
    playerSlot: item.playerSlot,
    wsEndpoint: item.wsEndpoint || "",
  };
}

/**
 * Pick a running game server with a public IP.
 * Prefers tagged warm-pool instances; falls back to WS_ENDPOINT env.
 */
async function resolveGameEndpoint() {
  try {
    const result = await ec2.send(
      new DescribeInstancesCommand({
        Filters: [
          { Name: `tag:${GAME_SERVER_TAG_KEY}`, Values: [GAME_SERVER_TAG_VALUE] },
          { Name: "instance-state-name", Values: ["running"] },
        ],
      })
    );

    const candidates = [];
    for (const reservation of result.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const publicIp = instance.PublicIpAddress;
        if (!publicIp) continue;
        candidates.push({
          instanceId: instance.InstanceId,
          publicIp,
          wsEndpoint: `ws://${publicIp}:${WS_PORT}`,
        });
      }
    }

    if (candidates.length > 0) {
      // Stable pick: sort by instanceId so both players in a race get same host
      // for near-simultaneous pairings on the same warm pool.
      candidates.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
      const chosen = candidates[0];
      return {
        wsEndpoint: chosen.wsEndpoint,
        instanceId: chosen.instanceId,
      };
    }
  } catch (err) {
    console.error("resolveGameEndpoint DescribeInstances failed:", err);
  }

  const fallback = process.env.WS_ENDPOINT || "";
  if (!fallback) {
    return null;
  }
  return { wsEndpoint: fallback, instanceId: null };
}

async function getMatch(playerId) {
  const result = await db.send(
    new GetCommand({
      TableName: MATCHES_TABLE,
      Key: { playerId },
    })
  );
  return result.Item || null;
}

/** Remove finished match + queue row so players can Find Match again. */
async function clearSession(playerId) {
  const match = await getMatch(playerId);

  const deletes = [
    db.send(
      new DeleteCommand({
        TableName: MATCHES_TABLE,
        Key: { playerId },
      })
    ),
    db.send(
      new DeleteCommand({
        TableName: QUEUE_TABLE,
        Key: { playerId },
      })
    ),
  ];

  if (match?.opponentId) {
    deletes.push(
      db.send(
        new DeleteCommand({
          TableName: MATCHES_TABLE,
          Key: { playerId: match.opponentId },
        })
      ),
      db.send(
        new DeleteCommand({
          TableName: QUEUE_TABLE,
          Key: { playerId: match.opponentId },
        })
      )
    );
  }

  await Promise.allSettled(deletes);
}

async function joinQueue(playerId) {
  await clearSession(playerId);

  const now = Math.floor(Date.now() / 1000);

  const queueResult = await db.send(
    new ScanCommand({
      TableName: QUEUE_TABLE,
      FilterExpression: "playerId <> :playerId AND expiresAt > :now",
      ExpressionAttributeValues: {
        ":playerId": playerId,
        ":now": now,
      },
      Limit: 25,
    })
  );

  const opponent = queueResult.Items?.[0];

  if (!opponent) {
    await db.send(
      new PutCommand({
        TableName: QUEUE_TABLE,
        Item: {
          playerId,
          joinedAt: now,
          expiresAt: now + 300,
        },
      })
    );
    return { status: "queued" };
  }

  try {
    await db.send(
      new DeleteCommand({
        TableName: QUEUE_TABLE,
        Key: { playerId: opponent.playerId },
        ConditionExpression: "attribute_exists(playerId)",
      })
    );
  } catch {
    await db.send(
      new PutCommand({
        TableName: QUEUE_TABLE,
        Item: {
          playerId,
          joinedAt: now,
          expiresAt: now + 300,
        },
      })
    );
    return { status: "queued" };
  }

  const assigned = await resolveGameEndpoint();
  if (!assigned?.wsEndpoint) {
    // Re-queue both players so they are not left without a server.
    await Promise.allSettled([
      db.send(
        new PutCommand({
          TableName: QUEUE_TABLE,
          Item: {
            playerId: opponent.playerId,
            joinedAt: now,
            expiresAt: now + 300,
          },
        })
      ),
      db.send(
        new PutCommand({
          TableName: QUEUE_TABLE,
          Item: {
            playerId,
            joinedAt: now,
            expiresAt: now + 300,
          },
        })
      ),
    ]);
    return {
      status: "queued",
      message: "No game server capacity available",
    };
  }

  const roomId = randomUUID();
  const { wsEndpoint, instanceId } = assigned;

  const playerOne = {
    playerId: opponent.playerId,
    roomId,
    playerSlot: 1,
    opponentId: playerId,
    wsEndpoint,
    createdAt: now,
    expiresAt: now + 3600,
    status: "active",
  };

  const playerTwo = {
    playerId,
    roomId,
    playerSlot: 2,
    opponentId: opponent.playerId,
    wsEndpoint,
    createdAt: now,
    expiresAt: now + 3600,
    status: "active",
  };

  if (instanceId) {
    playerOne.instanceId = instanceId;
    playerTwo.instanceId = instanceId;
    playerOne.assignedAt = now;
    playerTwo.assignedAt = now;
  }

  await Promise.all([
    db.send(new PutCommand({ TableName: MATCHES_TABLE, Item: playerOne })),
    db.send(new PutCommand({ TableName: MATCHES_TABLE, Item: playerTwo })),
  ]);

  return { status: "matched", match: matchPayload(playerTwo) };
}

export const handler = async (event) => {
  try {
    const method = getMethod(event);
    const path = getPath(event);

    if (method === "OPTIONS") {
      return response(200, {});
    }

    const playerId = getPlayerId(event);
    if (!playerId) {
      return response(401, { message: "Unauthorized" });
    }

    if (method === "POST" && path.endsWith("/join")) {
      return response(200, await joinQueue(playerId));
    }

    if (method === "GET" && path.endsWith("/check")) {
      const match = await getMatch(playerId);
      return response(
        200,
        match
          ? { status: "matched", match: matchPayload(match) }
          : { status: "waiting" }
      );
    }

    return response(404, { message: "Route not found" });
  } catch (error) {
    console.error(error);
    return response(500, { message: "Internal server error" });
  }
};
