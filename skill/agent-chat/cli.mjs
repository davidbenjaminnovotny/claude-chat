#!/usr/bin/env node
// agent-chat CLI. Single file, no npm deps. All HTTP via global fetch (Node 18+).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = process.env.AGENT_CHAT_API_BASE || "__API_BASE__";
if (API_BASE.includes("__API_BASE__")) {
  console.error(
    "API_BASE is not configured. Either re-download the skill from the deployed instance, or set AGENT_CHAT_API_BASE."
  );
  process.exit(2);
}

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(SKILL_DIR, "state", "current.json");

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function clearState() {
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
}

async function http(method, path, body) {
  const r = await fetch(API_BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!r.ok) {
    const msg = parsed?.message || parsed?.error || text || `HTTP ${r.status}`;
    throw new Error(`${method} ${path} failed (${r.status}): ${msg}`);
  }
  return parsed;
}

function formatMessage(m) {
  const tag = m.kind === "summary" ? " [summary]" : "";
  return `${m.from}${tag}: ${m.text}`;
}

function requireState() {
  const s = readState();
  if (!s) {
    console.error("Not in a room. Run `create <handle>` or `join <room_id> <handle>` first.");
    process.exit(2);
  }
  return s;
}

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  if (cmd === "create") {
    const handle = args[0];
    if (!handle) {
      console.error("usage: create <handle>");
      process.exit(2);
    }
    const { room_id } = await http("POST", "/api/rooms", {});
    writeState({ room_id, handle, last_seen_ts: 0 });
    console.log(`Room created: ${room_id}`);
    console.log(`Share this room ID with your colleague's agent.`);
    return;
  }

  if (cmd === "join") {
    const [room_id, handle] = args;
    if (!room_id || !handle) {
      console.error("usage: join <room_id> <handle>");
      process.exit(2);
    }
    const { messages } = await http("GET", `/api/rooms/${encodeURIComponent(room_id)}/messages`);
    const lastTs = messages.length ? messages[messages.length - 1].ts : 0;
    writeState({ room_id, handle, last_seen_ts: lastTs });
    console.log(`Joined room ${room_id} as "${handle}".`);
    if (messages.length === 0) {
      console.log("(no prior messages)");
    } else {
      console.log("--- history ---");
      for (const m of messages) console.log(formatMessage(m));
      console.log("--- end history ---");
    }
    return;
  }

  if (cmd === "send") {
    const text = args.join(" ");
    if (!text) {
      console.error("usage: send <text>");
      process.exit(2);
    }
    const s = requireState();
    await http("POST", `/api/rooms/${encodeURIComponent(s.room_id)}/messages`, {
      from: s.handle,
      text,
    });
    console.log("sent");
    return;
  }

  if (cmd === "check") {
    const s = requireState();
    const { messages } = await http(
      "GET",
      `/api/rooms/${encodeURIComponent(s.room_id)}/messages?since=${s.last_seen_ts}`
    );
    const fromOthers = messages.filter((m) => m.from !== s.handle);
    if (fromOthers.length === 0) {
      console.log("(no new messages)");
    } else {
      for (const m of fromOthers) console.log(formatMessage(m));
    }
    if (messages.length > 0) {
      s.last_seen_ts = messages[messages.length - 1].ts;
      writeState(s);
    }
    return;
  }

  if (cmd === "compact") {
    const summary = args.join(" ");
    if (!summary) {
      console.error("usage: compact <summary>");
      process.exit(2);
    }
    const s = requireState();
    const { removed } = await http("POST", `/api/rooms/${encodeURIComponent(s.room_id)}/compact`, {
      from: s.handle,
      summary,
      up_to_ts: s.last_seen_ts,
    });
    console.log(`Compacted ${removed} message(s) into a summary.`);
    return;
  }

  if (cmd === "status") {
    const s = readState();
    if (!s) {
      console.log("Not in a room.");
      return;
    }
    console.log(JSON.stringify({ ...s, api_base: API_BASE }, null, 2));
    return;
  }

  if (cmd === "stop") {
    clearState();
    console.log("Cleared agent-chat state. Cancel the /loop manually if it is still running.");
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error("Commands: create, join, send, check, compact, status, stop");
  process.exit(2);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
