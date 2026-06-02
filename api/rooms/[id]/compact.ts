import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeRedis, parseMessage, ROOM_TTL_SECONDS, type Message } from "../../_lib.js";

const redis = makeRedis();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const id = String(req.query.id || "");
  if (!id) {
    return res.status(400).json({ error: "validation_failed", message: "missing room id" });
  }

  const exists = await redis.exists(`room:${id}:created_at`);
  if (!exists) {
    return res.status(404).json({ error: "room_not_found" });
  }

  const { summary, up_to_ts, from } = req.body || {};
  if (typeof summary !== "string" || summary.length < 1 || summary.length > 20000) {
    return res.status(400).json({ error: "validation_failed", message: "summary must be 1-20000 chars" });
  }
  if (typeof up_to_ts !== "number" || !Number.isFinite(up_to_ts)) {
    return res.status(400).json({ error: "validation_failed", message: "up_to_ts must be a number" });
  }
  if (typeof from !== "string" || from.length < 1 || from.length > 32) {
    return res.status(400).json({ error: "validation_failed", message: "from must be 1-32 chars" });
  }

  const key = `room:${id}:messages`;
  const raw = (await redis.lrange(key, 0, -1)) as unknown[];
  const all: Message[] = raw.map(parseMessage);
  const kept = all.filter((m) => m.ts > up_to_ts);
  const removed = all.length - kept.length;

  const summaryMsg: Message = { ts: up_to_ts, from, text: summary, kind: "summary" };
  const newList = [summaryMsg, ...kept];

  const pipeline = redis.pipeline();
  pipeline.del(key);
  pipeline.rpush(key, ...newList.map((m) => JSON.stringify(m)));
  pipeline.expire(key, ROOM_TTL_SECONDS);
  pipeline.expire(`room:${id}:created_at`, ROOM_TTL_SECONDS);
  await pipeline.exec();

  return res.status(200).json({ ok: true, removed });
}
