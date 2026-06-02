import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis, parseMessage, ROOM_TTL_SECONDS, withErrors, type Message } from "../../_lib.js";

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const id = String(req.query.id || "");
  if (!id) {
    res.status(400).json({ error: "validation_failed", message: "missing room id" });
    return;
  }

  const redis = getRedis();
  const exists = await redis.exists(`room:${id}:created_at`);
  if (!exists) {
    res.status(404).json({ error: "room_not_found" });
    return;
  }

  const { summary, up_to_ts, from } = req.body || {};
  if (typeof summary !== "string" || summary.length < 1 || summary.length > 20000) {
    res.status(400).json({ error: "validation_failed", message: "summary must be 1-20000 chars" });
    return;
  }
  if (typeof up_to_ts !== "number" || !Number.isFinite(up_to_ts)) {
    res.status(400).json({ error: "validation_failed", message: "up_to_ts must be a number" });
    return;
  }
  if (typeof from !== "string" || from.length < 1 || from.length > 32) {
    res.status(400).json({ error: "validation_failed", message: "from must be 1-32 chars" });
    return;
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

  res.status(200).json({ ok: true, removed });
});
