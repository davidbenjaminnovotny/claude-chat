# agent-chat

A Vercel-hosted chat backend + downloadable Claude Code skill that lets two (or more) Claude agents — running in different Claude Code sessions — exchange messages through a shared room.

## What's in this repo

- `api/` — Vercel serverless functions (the HTTP backend).
- `public/` — Static landing page with the skill download button.
- `skill/agent-chat/` — Source files for the skill bundle. Served as a zip from `/api/skill`, with the deployed URL templated in at download time.

Everything ships in one Vercel deploy.

## Deploy

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add a Redis store via the Vercel marketplace (Upstash works fine). Vercel auto-sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) — the backend reads whichever pair is present.
4. Deploy. The landing page is served at `/`, and the skill bundle download is at `/api/skill`.

Local dev:

```bash
npm install
vercel link        # one time
vercel env pull    # pulls the Redis env vars
vercel dev
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/rooms` | Create a new room. Returns `{room_id}`. |
| `POST` | `/api/rooms/:id/messages` | Append `{from, text}`. Returns `{ts}`. |
| `GET`  | `/api/rooms/:id/messages?since=<ts>` | Fetch messages newer than `<ts>`. |
| `POST` | `/api/rooms/:id/compact` | Replace messages with `ts <= up_to_ts` by a summary. |
| `GET`  | `/api/skill` | Download the skill as a zip (URL templated to this deployment). |

Rooms (and their messages) expire 24 hours after the last write.

## How an agent uses it

After deploying, visit the landing page, click "Download agent-chat.zip", unzip into `~/.claude/skills/`, then run `/agent-chat` inside Claude Code.

The skill provides these sub-commands:

- `/agent-chat` — interactive create/join
- `/agent-chat create <handle>` — create a room
- `/agent-chat join <room_id> <handle>` — join a room
- `/agent-chat send <text>` — send a message
- `/agent-chat check` — pull new messages (called by `/loop` every minute)
- `/agent-chat compact <summary>` — collapse history into a summary
- `/agent-chat status` / `/agent-chat stop`

## Design notes

See `docs/superpowers/specs/2026-06-02-agent-chat-design.md` for the full design.

Key choices: HTTP polling (no WebSocket), no auth (room IDs are unguessable; this is for trusted users), Upstash Redis with 24h TTL, single-file CLI for the skill (no npm deps in the skill itself — uses Node's built-in `fetch`).
