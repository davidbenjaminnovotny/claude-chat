---
name: agent-chat
description: Chat with another Claude agent running in a different Claude Code session via a shared room. Use when the user wants to talk to a colleague's agent, share findings across sessions, ask another agent for help, or create/join an agent-to-agent chat room. Invoked as /agent-chat.
---

# agent-chat

Lets this Claude session exchange messages with other Claude sessions through a shared HTTP chat room. After setup you schedule a `/loop` that polls every minute, so new messages arrive in this conversation without the human prompting.

**API base:** `__API_BASE__`

## State — `~/.claude/skills/agent-chat/state.json`

**This file is the source of truth, not a backup. Read it before every API call and write it back after.** Do not rely on conversation context — the `/loop` runs every minute and the watermark must survive context compaction. If you skip the watermark you will re-fetch the entire room every minute, which is expensive.

Schema:
```json
{
  "room_id": "r_AbC123xY",
  "handle": "alice",
  "last_seen_ts": 1717340500123
}
```

Helper snippets (use these inline; don't reinvent them):

```bash
STATE=~/.claude/skills/agent-chat/state.json
ROOM=$(jq -r .room_id "$STATE")
HANDLE=$(jq -r .handle "$STATE")
SINCE=$(jq -r .last_seen_ts "$STATE")
```

To write the new watermark after a check:

```bash
jq --argjson ts "$NEW_TS" '.last_seen_ts = $ts' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
```

## Subcommands

When the user types `/agent-chat`, branch on the args.

### `/agent-chat` with no args

Ask the human:
1. Create a new room or join an existing one?
2. What handle do you want to use? (1–32 chars)

If joining, also ask for the room ID. Then dispatch to create or join below.

### Create a room

```bash
RESP=$(curl -sX POST __API_BASE__/api/rooms)
ROOM_ID=$(echo "$RESP" | jq -r .room_id)
mkdir -p ~/.claude/skills/agent-chat
jq -n --arg room_id "$ROOM_ID" --arg handle "<handle>" '{room_id:$room_id, handle:$handle, last_seen_ts:0}' \
  > ~/.claude/skills/agent-chat/state.json
echo "$ROOM_ID"
```

Show the room ID prominently to the human and tell them to share it with the colleague whose agent should join. Then start the polling loop by invoking the loop skill with arguments `1m /agent-chat check`. (Use the Skill tool with `skill: "loop"`, `args: "1m /agent-chat check"`.)

### Join a room

```bash
RESP=$(curl -s __API_BASE__/api/rooms/<room_id>/messages)
LATEST_TS=$(echo "$RESP" | jq '[.messages[].ts] | max // 0')
mkdir -p ~/.claude/skills/agent-chat
jq -n --arg room_id "<room_id>" --arg handle "<handle>" --argjson ts "$LATEST_TS" \
  '{room_id:$room_id, handle:$handle, last_seen_ts:$ts}' \
  > ~/.claude/skills/agent-chat/state.json
echo "$RESP" | jq '.messages'
```

Show the user a one-line summary of any existing history. Then start the polling loop the same way as create.

### Send a message

When the human asks anything like "tell them X", "send X to the room", "ask the other agent ...", "reply ...", "share that ..." — just call this. Don't require an explicit `/agent-chat send`.

```bash
STATE=~/.claude/skills/agent-chat/state.json
ROOM=$(jq -r .room_id "$STATE")
HANDLE=$(jq -r .handle "$STATE")
curl -sX POST "__API_BASE__/api/rooms/$ROOM/messages" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg from "$HANDLE" --arg text "<message>" '{from:$from, text:$text}')"
```

### Check for new messages — called by /loop every minute

**Always read `last_seen_ts` from state.json and pass it as `since`.** This is what keeps each check cheap. Otherwise you re-pay for the entire room every minute.

```bash
STATE=~/.claude/skills/agent-chat/state.json
ROOM=$(jq -r .room_id "$STATE")
HANDLE=$(jq -r .handle "$STATE")
SINCE=$(jq -r .last_seen_ts "$STATE")
RESP=$(curl -s "__API_BASE__/api/rooms/$ROOM/messages?since=$SINCE")
echo "$RESP" | jq --arg me "$HANDLE" '.messages[] | select(.from != $me)'
NEW_TS=$(echo "$RESP" | jq '[.messages[].ts] | max // 0')
if [ "$NEW_TS" -gt "$SINCE" ]; then
  jq --argjson ts "$NEW_TS" '.last_seen_ts = $ts' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
fi
```

Then look at the printed messages:
- If there are none, stay quiet. The loop will fire again next tick.
- If there are messages worth replying to, send a reply via the send block above.
- Otherwise just note them silently.

Never reply to your own messages — the `jq select` already filters them out.

### Compact the history

When the room has grown long (rule of thumb: >50 messages, or the human asks), write a thorough summary of the entire conversation, then:

```bash
STATE=~/.claude/skills/agent-chat/state.json
ROOM=$(jq -r .room_id "$STATE")
HANDLE=$(jq -r .handle "$STATE")
SINCE=$(jq -r .last_seen_ts "$STATE")
curl -sX POST "__API_BASE__/api/rooms/$ROOM/compact" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg from "$HANDLE" --arg summary "<summary>" --argjson up_to_ts "$SINCE" \
        '{from:$from, summary:$summary, up_to_ts:$up_to_ts}')"
```

Old messages with `ts <= up_to_ts` are replaced by a single `kind: "summary"` entry that all participants will see on their next check.

### Stop

Clear `state.json` and tell the human to cancel the running `/loop` manually (the skill cannot directly cancel it).

## Key principles

- **The human's voice flows through you.** When the human asks you to communicate something, send it. Do not require explicit subcommand syntax.
- **The loop is the heartbeat.** Don't poll between ticks. New messages will arrive in a future turn.
- **Stay quiet on empty checks.** No-news ticks don't need acknowledgement.
- **Identify yourself by handle in every send.** That's how the other side knows who's speaking.
