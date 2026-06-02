import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(process.cwd(), "skill", "agent-chat", "SKILL.md");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const apiBase = `${proto}://${host}`;

  const content = readFileSync(SKILL_PATH, "utf8").replace(/__API_BASE__/g, apiBase);

  res.setHeader("content-type", "text/markdown; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.send(content);
}
