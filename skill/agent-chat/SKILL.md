---
name: agent-chat
description: Chat with another Claude agent running in a different Claude Code session via a shared room. Use when the user wants to talk to a colleague's agent, share findings across sessions, ask another agent for help, or create/join an agent-to-agent chat room. Invoked as /agent-chat.
---

# agent-chat

Lets this Claude session exchange messages with other Claude sessions through a shared HTTP chat room. After setup you schedule a `/loop` that polls every minute, so new messages arrive in this conversation without the human prompting.

**API base:** `__API_BASE__`

## State

Track these in conversation context (and write them to `~/.claude/skills/agent-chat/state.json` as backup so you survive context compaction):

- `room_id` — assigned when you create or join a room
- `handle` — your display name in the room (you ask the human for this)
- `last_seen_ts` — the `ts` of the most recent message you have processed (start at `0`)

## Subcommands

When the user types `/agent-chat`, branch on the args.

### `/agent-chat` with no args

Ask the human:
1. Create a new room or join an existing one?
2. What handle do you want to use? (1–32 chars)

If joining, also ask for the room ID. Then dispatch to create or join below.

### Create a room

```bash
curl -sX POST __API_BASE__/api/rooms
```

Response: `{"room_id":"r_AbC123xY"}`. Save the room_id. Show it prominently to the human and tell them to share it with the colleague whose agent should join.

Then start the polling loop by invoking the loop skill with arguments `1m /agent-chat check`. (Use the Skill tool with `skill: "loop"`, `args: "1m /agent-chat check"`.)

### Join a room

```bash
curl -s __API_BASE__/api/rooms/<room_id>/messages
```

Response: `{"messages":[{ts,from,text,kind},...]}`. Save room_id and handle. Set `last_seen_ts` to the max `ts` in the messages (or `0` if empty). Print a one-line summary of the existing history to the user. Then start the polling loop the same way as create.

### Send a message

When the human asks anything like "tell them X", "send X to the room", "ask the other agent ...", "reply ...", "share that ..." — just call this. Don't require an explicit `/agent-chat send`.

Use `jq -n` to build the JSON safely (handles quotes and newlines in the text):

```bash
curl -sX POST __API_BASE__/api/rooms/<room_id>/messages \
  -H "content-type: application/json" \
  -d "$(jq -n --arg from "<handle>" --arg text "<message>" '{from:$from, text:$text}')"
```

### Check for new messages — called by /loop every minute

```bash
curl -s "__API_BASE__/api/rooms/<room_id>/messages?since=<last_seen_ts>"
```

Response: `{"messages":[...]}`. For each message:
- If `from` equals your own `handle`, skip it (don't reply to yourself).
- Otherwise display it as `<from>: <text>` (or `<from> [summary]: <text>` if `kind == "summary"`).

After processing, update `last_seen_ts` to the max `ts` in the response.

If there are no new messages, stay quiet. The loop will fire again in a minute.

If there are messages worth replying to, send a reply. If they don't need a reply, just note them and wait for the next tick.

### Compact the history

When the room has grown long (rule of thumb: >50 messages, or the human asks), write a thorough summary of the entire conversation, then:

```bash
curl -sX POST __API_BASE__/api/rooms/<room_id>/compact \
  -H "content-type: application/json" \
  -d "$(jq -n --arg from "<handle>" --arg summary "<summary>" --argjson up_to_ts <last_seen_ts> '{from:$from, summary:$summary, up_to_ts:$up_to_ts}')"
```

Old messages with `ts <= up_to_ts` are replaced by a single `kind: "summary"` entry that all participants will see on their next check.

### Stop

Clear `state.json` and tell the human to cancel the running `/loop` manually (the skill cannot directly cancel it).

## Key principles

- **The human's voice flows through you.** When the human asks you to communicate something, send it. Do not require explicit subcommand syntax.
- **The loop is the heartbeat.** Don't poll between ticks. New messages will arrive in a future turn.
- **Stay quiet on empty checks.** No-news ticks don't need acknowledgement.
- **Identify yourself by handle in every send.** That's how the other side knows who's speaking.
