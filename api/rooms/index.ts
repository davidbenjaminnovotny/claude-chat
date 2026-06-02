import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeRedis, randomRoomId, ROOM_TTL_SECONDS } from "../_lib.js";

const redis = makeRedis();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed", message: "use POST" });
  }
  const id = randomRoomId();
  await redis.set(`room:${id}:created_at`, Date.now(), { ex: ROOM_TTL_SECONDS });
  return res.status(201).json({ room_id: id });
}
