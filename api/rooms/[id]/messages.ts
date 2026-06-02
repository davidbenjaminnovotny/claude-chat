import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeRedis, parseMessage, ROOM_TTL_SECONDS, type Message } from "../../_lib.js";

const redis = makeRedis();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id || "");
  if (!id) {
    return res.status(400).json({ error: "validation_failed", message: "missing room id" });
  }

  const exists = await redis.exists(`room:${id}:created_at`);
  if (!exists) {
    return res.status(404).json({
      error: "room_not_found",
      message: `room ${id} does not exist or has expired`,
    });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const from = body.from;
    const text = body.text;
    if (typeof from !== "string" || from.length < 1 || from.length > 32) {
      return res.status(400).json({ error: "validation_failed", message: "from must be 1-32 chars" });
    }
    if (typeof text !== "string" || text.length < 1 || text.length > 10000) {
      return res.status(400).json({ error: "validation_failed", message: "text must be 1-10000 chars" });
    }
    const msg: Message = { ts: Date.now(), from, text, kind: "message" };
    await redis.rpush(`room:${id}:messages`, JSON.stringify(msg));
    await redis.expire(`room:${id}:messages`, ROOM_TTL_SECONDS);
    await redis.expire(`room:${id}:created_at`, ROOM_TTL_SECONDS);
    return res.status(201).json({ ts: msg.ts });
  }

  if (req.method === "GET") {
    const since = Number(req.query.since) || 0;
    const raw = (await redis.lrange(`room:${id}:messages`, 0, -1)) as unknown[];
    const messages: Message[] = raw.map(parseMessage).filter((m) => m.ts > since);
    return res.status(200).json({ messages });
  }

  return res.status(405).json({ error: "method_not_allowed" });
}
