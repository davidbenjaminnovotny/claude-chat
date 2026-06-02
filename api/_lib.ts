import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const ROOM_TTL_SECONDS = 60 * 60 * 24;

export type Message = {
  ts: number;
  from: string;
  text: string;
  kind: "message" | "summary";
};

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    const present = Object.keys(process.env)
      .filter((k) => k.includes("UPSTASH") || k.includes("KV_") || k.includes("REDIS"))
      .join(", ") || "(none)";
    throw new Error(
      `Redis env vars missing. Need UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN). Found in env: ${present}. Connect an Upstash Redis store in the Vercel project Settings → Storage.`
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export function parseMessage(raw: unknown): Message {
  return typeof raw === "string" ? JSON.parse(raw) : (raw as Message);
}

export function randomRoomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `r_${s}`;
}

export function withErrors(
  fn: (req: VercelRequest, res: VercelResponse) => Promise<unknown>
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      await fn(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("api error:", msg, err instanceof Error ? err.stack : "");
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error", message: msg });
      }
    }
  };
}
