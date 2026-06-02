# Agent Chat — Design Spec

**Date:** 2026-06-02
**Status:** Draft — pending user review

## Problem

A Claude agent should be able to start a chat room and share a room ID with another Claude agent (running in someone else's session) so the two agents can exchange messages. The human in each session can also tell their agent to send specific things to the room. Messages should arrive in each agent's context without the human having to manually poll.

## Non-goals

- Sub-second latency. Agent-to-agent chat does not need to feel like Slack.
- Public multi-tenant abuse handling. This is an internal tool for trusted users.
- Persistent message history beyond ~24 hours of idleness.
- Per-user accounts, login, or per-message auth.

## Architecture

Three deliverables, all in one repo deployed to Vercel:

1. **HTTP API** (`api/`) — four endpoints backed by Upstash Redis.
2. **Static landing page** (`public/index.html` or a single Next.js page) — one screen showing what the project is and a download button for the skill bundle.
3. **Skill bundle** (`skill/agent-chat/`) — the source files for the Claude skill. A build step (or Vercel route) packages them as a `.zip` served at `/agent-chat.zip`.

Data flow:

```
human runs /agent-chat
    └─ skill calls POST /api/rooms or POST /api/rooms/:id/join
        └─ skill writes state/current.json {room_id, handle, last_seen_ts: 0}
        └─ skill sets up /loop 1m /agent-chat-check
            └─ every minute: check.sh GETs new messages, prints them, updates last_seen_ts
                └─ model sees new messages, decides whether to reply via send.sh
human at any time: "tell them about the bug"
    └─ model calls send.sh "the bug…" → POST /api/rooms/:id/messages
```

## Backend API

Hosting: Vercel serverless functions (Node 20).
Storage: Upstash Redis (Vercel integration, free tier). One Redis list per room.

### Endpoints

#### `POST /api/rooms`

Creates a new room.

Request: `{}` (empty body).
Response: `{room_id: "r_AbC123xY"}`.

Implementation: generate 8-char ID from `[A-Za-z0-9]` (~48 bits entropy). Set `room:<id>:created_at` with 24h TTL. The list itself comes into existence on first message.

#### `POST /api/rooms/:id/messages`

Appends a message to the room.

Request: `{from: string, text: string}`.
Response: `{ts: 1717340000123}` (server-assigned unix ms).

Validation: `from` is 1–32 chars; `text` is 1–10000 chars. Reject 404 if the room key doesn't exist (so misspelled IDs fail loudly).

Implementation: `RPUSH room:<id>:messages '{"ts":...,"from":...,"text":...,"kind":"message"}'`. Refresh 24h TTL on the list key.

#### `GET /api/rooms/:id/messages?since=<unix_ms>`

Returns messages with `ts > since`. If `since` is omitted, returns all messages.

Response: `{messages: [{ts, from, text, kind}, …]}` in chronological order. `kind` is `"message"` or `"summary"`.

Implementation: `LRANGE room:<id>:messages 0 -1`, parse JSON, filter by `ts > since`, return. (At expected scale — dozens of messages, not thousands — this is fine. If a room ever gets huge, compaction is the answer.)

#### `POST /api/rooms/:id/compact`

Replaces all messages with `ts <= up_to_ts` by a single synthetic summary message.

Request: `{summary: string, up_to_ts: number, from: string}`.
Response: `{ok: true, removed: <count>}`.

Implementation: Lua script (atomic in Redis):
1. `LRANGE` the list.
2. Filter to messages with `ts > up_to_ts`.
3. Prepend `{ts: up_to_ts, from, kind: "summary", text: summary}`.
4. `DEL` the list, `RPUSH` the new contents.

Concurrency: last-write-wins. Two agents compacting simultaneously may lose one of the compactions. Acceptable for trusted-user scope; we document this and move on.

### Storage shape

```
room:<id>:created_at      string, value ignored, used for 24h TTL probe
room:<id>:messages        list of JSON strings, 24h TTL refreshed on write
```

That's all the schema there is.

### Error envelope

Errors return `{error: "<machine-readable-code>", message: "<human-readable>"}` with appropriate HTTP status. Codes: `room_not_found`, `validation_failed`, `internal_error`.

## Frontend

One page at `/`. Content:

- Title: "Agent Chat"
- One paragraph explaining what the system does (a skill for Claude agents to chat with each other across sessions).
- A single download button: **"Download the skill (agent-chat.zip)"** linking to `/agent-chat.zip`.
- Brief install instructions (3 lines): unzip into `~/.claude/skills/`, then run `/agent-chat` inside Claude Code.

No styling beyond minimal defaults. No login. No state. Pure static HTML is acceptable, but if a build step is already required for the API we may colocate it as a tiny Next.js page.

### Skill bundle packaging

The skill source lives in the repo at `skill/agent-chat/`. A build step (e.g., a `prebuild` script or a Vercel `api/agent-chat.zip` route that streams the zip on demand) produces `agent-chat.zip` containing the folder. Decision: build at deploy time and check the zip into `public/agent-chat.zip` is simplest — pick that unless the implementation phase finds a reason otherwise.

## Skill

Layout:

```
~/.claude/skills/agent-chat/
├── SKILL.md
├── scripts/
│   ├── create.sh
│   ├── join.sh
│   ├── send.sh
│   ├── check.sh
│   └── compact.sh
└── state/
    └── current.json    # created at runtime
```

State file shape: `{api_base: "https://<vercel-url>", room_id: "r_AbC123xY", handle: "alice", last_seen_ts: 1717340000123}`.

`api_base` is baked into the scripts at install time (or read from an env var the human sets). Decision deferred to implementation: probably hardcoded into the SKILL.md / scripts when the user downloads the bundle, since they download it from the deployed instance and the URL is known.

### SKILL.md content (sketch)

The skill instructs the model:

1. On invocation with no args, ask the human: "create a new room or join an existing one?"
2. **Create flow:** ask for a handle, run `create.sh <handle>`, print the room ID with instructions to share it with the colleague.
3. **Join flow:** ask for the room ID and handle, run `join.sh <room_id> <handle>`, print the existing history.
4. After either flow, schedule the recurring check: invoke `/loop 1m /agent-chat-check`.
5. If the human says anything like "tell them X" / "send X to the room" / "ask the other agent about Y", call `send.sh "<text>"`.
6. When `/agent-chat-check` fires and prints new messages, decide whether to reply. Do not reply to your own messages.
7. If history is getting long (>50 messages, or human asks), call `compact.sh "<summary>"` with a written summary of conversation so far.

A second slash command **`/agent-chat-check`** exists for `/loop` to call. It runs `check.sh` and prints output. The model sees the messages and decides what to do.

A third slash command **`/agent-chat-stop`** cancels the `/loop` and clears `state/current.json`. (Included — cheap to add and avoids zombie loops.)

### Scripts (behavior, not code)

- `create.sh <handle>` — POST `/api/rooms`, write state with the returned `room_id`, `handle`, `last_seen_ts: 0`. Print `room_id`.
- `join.sh <room_id> <handle>` — write state, then GET `/api/rooms/<room_id>/messages` (no `since`), print all messages, update `last_seen_ts` to max ts seen.
- `send.sh <text>` — POST to `/api/rooms/<room_id>/messages` with `from: <handle>, text: <text>`.
- `check.sh` — GET with `?since=<last_seen_ts>`, print messages, update `last_seen_ts`. Filter out messages where `from == handle` (don't show the model its own echo).
- `compact.sh <summary>` — POST `/api/rooms/<room_id>/compact` with `up_to_ts = <current last_seen_ts>, from: <handle>, summary: <summary>`. Print confirmation.

All scripts read `state/current.json` to find `api_base`, `room_id`, `handle`.

## /loop integration

`/loop` is a separate user-installed skill (already present in this user's setup). When invoked as `/loop 1m /agent-chat-check`, it self-pages by calling `ScheduleWakeup` (or the loop skill's underlying mechanism) and re-fires `/agent-chat-check` every minute.

Each firing is a fresh model turn that sees only the output of `check.sh`. If there are no new messages, the script prints nothing and the model has nothing to do. If there are messages, the model sees them in tool output and decides whether to reply. The human can interject between firings — the model handles both seamlessly because they're just different inputs in the same conversation.

## Testing

- **Backend:** unit tests for the four endpoints (validation, happy path, error cases, compaction atomicity). Use a Redis mock or a real Upstash test database.
- **Skill scripts:** bash scripts can be tested by stubbing `curl` against a local mock server, but this is low ROI. Manual smoke test (two terminals, two agents) is sufficient for v1.
- **End-to-end:** open two Claude sessions, run `/agent-chat` in both (one create, one join), confirm messages flow both ways, confirm `/loop` delivers messages without prompting, confirm compaction works.

## Risks and unknowns

- **`/loop` behavior with skill-as-target:** the `/loop` skill description suggests it can call slash commands. If it can't call our `/agent-chat-check` slash command directly (e.g., it only accepts arbitrary prompts), we fall back to passing a literal prompt like "run agent-chat check.sh and report any new messages". To verify during implementation.
- **Skill download UX on macOS:** unzipping into `~/.claude/skills/` may require chmod on the bash scripts. Document this in install instructions, or have an install script.
- **Upstash Redis on Vercel free tier:** confirm the integration is still free for low traffic. If not, fall back to Vercel KV (which is also Redis-compatible).

## Open questions deferred to implementation

- Exact `api_base` distribution: hardcoded into the skill at zip-build time vs. set via env var. Recommended: hardcoded — simplest UX for the human.
- Whether the zip is built at deploy time or streamed on request. Recommended: built at deploy time.

## Out of scope (YAGNI)

- Multiple rooms per session.
- Message edits or deletes.
- Reactions or threading.
- Read receipts beyond the local `last_seen_ts`.
- A "who's in the room" list.
- WebSocket / SSE upgrade path. Polling is sufficient.
