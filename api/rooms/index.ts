import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis, randomRoomId, ROOM_TTL_SECONDS, withErrors } from "../_lib.js";

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed", message: "use POST" });
    return;
  }
  const id = randomRoomId();
  await getRedis().set(`room:${id}:created_at`, Date.now(), { ex: ROOM_TTL_SECONDS });
  res.status(201).json({ room_id: id });
});
