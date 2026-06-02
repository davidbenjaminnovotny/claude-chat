import { Redis } from "@upstash/redis";

export const ROOM_TTL_SECONDS = 60 * 60 * 24;

export type Message = {
  ts: number;
  from: string;
  text: string;
  kind: "message" | "summary";
};

export function makeRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Redis not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_* variants) in the Vercel project."
    );
  }
  return new Redis({ url, token });
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
