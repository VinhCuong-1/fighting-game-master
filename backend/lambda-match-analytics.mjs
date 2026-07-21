/**
 * Flow E — DynamoDB Streams on ActiveMatches → MatchAnalytics.
 * Deploy as FightingGameMatchAnalytics (Node.js 22.x, handler index.handler).
 * Env: ANALYTICS_TABLE=MatchAnalytics
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.ANALYTICS_TABLE || "MatchAnalytics";

function imageFrom(record, which) {
  const raw = record.dynamodb?.[which];
  if (!raw) return null;
  return unmarshall(raw);
}

/** Prefer NEW image on finish; fall back to OLD on REMOVE after rematch delete. */
function finishedImage(record) {
  if (record.eventName === "MODIFY" || record.eventName === "INSERT") {
    const neu = imageFrom(record, "NewImage");
    if (neu?.status === "finished") return neu;
  }
  if (record.eventName === "REMOVE") {
    const old = imageFrom(record, "OldImage");
    if (old?.status === "finished") return old;
  }
  return null;
}

export const handler = async (event) => {
  for (const record of event.Records || []) {
    const item = finishedImage(record);
    if (!item?.roomId) continue;

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          roomId: item.roomId,
          winner: item.winner ?? null,
          endedAt: item.endedAt ?? null,
          endReason: item.endReason ?? null,
          playerId: item.playerId,
          opponentId: item.opponentId ?? null,
          playerSlot: item.playerSlot ?? null,
          processedAt: Math.floor(Date.now() / 1000),
          sourceEvent: record.eventName,
        },
      })
    );
  }
  return { ok: true };
};
