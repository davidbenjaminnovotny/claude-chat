import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const apiBase = `${proto}://${host}`;

  const script = `#!/usr/bin/env sh
set -e
SKILL_DIR="$HOME/.claude/skills/agent-chat"
mkdir -p "$SKILL_DIR"
curl -fsSL "${apiBase}/api/skill" -o "$SKILL_DIR/SKILL.md"
echo "Installed agent-chat skill at $SKILL_DIR/SKILL.md"
echo "Start a new Claude Code session and run /agent-chat."
`;

  res.setHeader("content-type", "text/x-shellscript; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.send(script);
}
