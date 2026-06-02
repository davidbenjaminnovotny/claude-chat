import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis, parseMessage, ROOM_TTL_SECONDS, withErrors, type Message } from "../../_lib.js";

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  const id = String(req.query.id || "");
  if (!id) {
    res.status(400).json({ error: "validation_failed", message: "missing room id" });
    return;
  }

  const redis = getRedis();
  const exists = await redis.exists(`room:${id}:created_at`);
  if (!exists) {
    res.status(404).json({
      error: "room_not_found",
      message: `room ${id} does not exist or has expired`,
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const from = body.from;
    const text = body.text;
    if (typeof from !== "string" || from.length < 1 || from.length > 32) {
      res.status(400).json({ error: "validation_failed", message: "from must be 1-32 chars" });
      return;
    }
    if (typeof text !== "string" || text.length < 1 || text.length > 10000) {
      res.status(400).json({ error: "validation_failed", message: "text must be 1-10000 chars" });
      return;
    }
    const msg: Message = { ts: Date.now(), from, text, kind: "message" };
    await redis.rpush(`room:${id}:messages`, JSON.stringify(msg));
    await redis.expire(`room:${id}:messages`, ROOM_TTL_SECONDS);
    await redis.expire(`room:${id}:created_at`, ROOM_TTL_SECONDS);
    res.status(201).json({ ts: msg.ts });
    return;
  }

  if (req.method === "GET") {
    const since = Number(req.query.since) || 0;
    const raw = (await redis.lrange(`room:${id}:messages`, 0, -1)) as unknown[];
    const messages: Message[] = raw.map(parseMessage).filter((m) => m.ts > since);
    res.status(200).json({ messages });
    return;
  }

  res.status(405).json({ error: "method_not_allowed" });
});
