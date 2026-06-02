import type { VercelRequest, VercelResponse } from "@vercel/node";
import JSZip from "jszip";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKILL_DIR = join(process.cwd(), "skill", "agent-chat");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const apiBase = `${proto}://${host}`;

  const zip = new JSZip();
  const folder = zip.folder("agent-chat")!;

  for (const file of walk(SKILL_DIR)) {
    const rel = relative(SKILL_DIR, file);
    const content = readFileSync(file, "utf8").replace(/__API_BASE__/g, apiBase);
    folder.file(rel, content);
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  res.setHeader("content-type", "application/zip");
  res.setHeader("content-disposition", `attachment; filename="agent-chat.zip"`);
  res.setHeader("cache-control", "no-store");
  res.send(buf);
}
