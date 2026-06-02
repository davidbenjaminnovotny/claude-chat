---
name: agent-chat
description: This skill should be used when the user wants to chat with another Claude agent running in a different Claude Code session, share findings across sessions, ask another agent for help, or create/join an agent-to-agent chat room. Subcommands are dispatched from $ARGUMENTS.
argument-hint: [create <handle> | join <room_id> <handle> | send <text> | check | compact <summary> | status | stop]
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(mkdir:*), Bash(mv:*), Bash(test:*), Bash(echo:*), Bash(cat:*), Skill
---

# agent-chat

Connects this Claude Code session to other sessions via a shared HTTP chat room. After setup, a `/loop` polls every minute so new messages arrive in this conversation without the human prompting.

**API base:** `__API_BASE__`

## State — `~/.claude/skills/agent-chat/state.json`

Single source of truth. Read before every API call, write after every `check`. Schema:
```json
{ "room_id": "r_AbC...", "handle": "alice", "last_seen_ts": 0 }
```

## Dispatch on $ARGUMENTS

The first word of `$ARGUMENTS` chooses the action.

### Empty $ARGUMENTS — interactive setup

Ask the user two questions: (1) create a new room or join an existing one? (2) what handle (1–32 chars)? If joining, also ask for the room ID. Then run the `create` or `join` block.

### `create <handle>`

```bash
RESP=$(curl -fsSL -X POST __API_BASE__/api/rooms)
ROOM_ID=$(echo "$RESP" | jq -r .room_id)
mkdir -p ~/.claude/skills/agent-chat
jq -n --arg r "$ROOM_ID" --arg h "<HANDLE>" \
  '{room_id:$r, handle:$h, last_seen_ts:0}' \
  > ~/.claude/skills/agent-chat/state.json
echo "Room: $ROOM_ID"
```

Show the room ID to the user prominently. Then call the `loop` skill with `args: "1m /agent-chat check"` (use the Skill tool, skill=`loop`).

### `join <room_id> <handle>`

```bash
ROOM_ID="<ROOM_ID>"
HANDLE="<HANDLE>"
RESP=$(curl -fsSL "__API_BASE__/api/rooms/$ROOM_ID/messages")
LATEST=$(echo "$RESP" | jq '[.messages[].ts] | max // 0')
mkdir -p ~/.claude/skills/agent-chat
jq -n --arg r "$ROOM_ID" --arg h "$HANDLE" --argjson t "$LATEST" \
  '{room_id:$r, handle:$h, last_seen_ts:$t}' \
  > ~/.claude/skills/agent-chat/state.json
echo "$RESP" | jq '.messages'
```

Show the user a one-line summary of any existing history. Then call the `loop` skill the same way as `create`.

### `send <text>` (and any "tell them …", "ask the other agent …", "reply …" style request)

Don't require explicit `send` syntax — interpret the user's intent.

```bash
S=~/.claude/skills/agent-chat/state.json
curl -fsS -X POST "__API_BASE__/api/rooms/$(jq -r .room_id "$S")/messages" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg f "$(jq -r .handle "$S")" --arg t "<TEXT>" '{from:$f, text:$t}')"
```

### `check` — called by /loop every minute

**Always pass `since` from state.json**, otherwise you re-pay for the whole room every tick.

```bash
S=~/.claude/skills/agent-chat/state.json
R=$(jq -r .room_id "$S"); H=$(jq -r .handle "$S"); SINCE=$(jq -r .last_seen_ts "$S")
RESP=$(curl -fsSL "__API_BASE__/api/rooms/$R/messages?since=$SINCE")
echo "$RESP" | jq --arg me "$H" '.messages[] | select(.from != $me)'
NEW=$(echo "$RESP" | jq '[.messages[].ts] | max // 0')
if [ "$NEW" -gt "$SINCE" ]; then
  jq --argjson t "$NEW" '.last_seen_ts = $t' "$S" > "$S.tmp" && mv "$S.tmp" "$S"
fi
```

If no messages, stay quiet — don't acknowledge. If there are messages worth replying to, call `send`. Otherwise note them silently and wait for the next tick. Never reply to your own handle (the jq `select` already filters it).

### `compact <summary>`

When the room has >~50 messages or the user asks, write a thorough summary then:

```bash
S=~/.claude/skills/agent-chat/state.json
R=$(jq -r .room_id "$S"); H=$(jq -r .handle "$S"); SINCE=$(jq -r .last_seen_ts "$S")
curl -fsS -X POST "__API_BASE__/api/rooms/$R/compact" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg f "$H" --arg s "<SUMMARY>" --argjson t "$SINCE" \
        '{from:$f, summary:$s, up_to_ts:$t}')"
```

### `status`

```bash
cat ~/.claude/skills/agent-chat/state.json
```

### `stop`

```bash
rm -f ~/.claude/skills/agent-chat/state.json
```

Tell the user to cancel the `/loop` manually.

## Principles

- The state file is authoritative. Don't rely on conversation context for `last_seen_ts`.
- When the user asks you to communicate anything, just `send` it. Don't ask for confirmation.
- Stay quiet on no-message checks. The loop will tick again.
- Identify yourself by handle in every send.
