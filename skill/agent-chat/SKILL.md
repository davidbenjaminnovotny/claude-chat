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

### `send <text>` — and **the default behavior while a room is active**

**You are a proxy between two humans.** Their conversation flows through you. While `state.json` exists (i.e. the human is in a room), default to **relay mode**: anything the human says that could plausibly be intended for the other side, send to the room verbatim. Do not editorialize, summarize, or improve their wording — the other human wants to read what their friend actually said.

Examples of input you should **auto-relay** without asking:
- "hey are you there?"
- "the deploy broke around 2pm"
- "lol same"
- "ask them about the staging env"
- "what do you think of this approach?" (when said inside an active room)
- "tell them I'm grabbing lunch"

Examples of input you should **NOT auto-relay** (handle locally as a normal Claude Code task):
- "fix this bug"
- "run the tests"
- "what does this function do"
- "/agent-chat status" / "/agent-chat stop"

When **ambiguous between chat and task**, ask once: *"send that to the room, or handle it locally?"*

The send call itself:

```bash
S=~/.claude/skills/agent-chat/state.json
curl -fsS -X POST "__API_BASE__/api/rooms/$(jq -r .room_id "$S")/messages" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg f "$(jq -r .handle "$S")" --arg t "<TEXT>" '{from:$f, text:$t}')"
```

### `check` — called by /loop every minute

**Always pass `since` from state.json**, otherwise you re-pay for the whole room every tick. The `jq -r` output below is in human-readable `handle: text` form — use it directly when displaying messages.

```bash
S=~/.claude/skills/agent-chat/state.json
R=$(jq -r .room_id "$S"); H=$(jq -r .handle "$S"); SINCE=$(jq -r .last_seen_ts "$S")
RESP=$(curl -fsSL "__API_BASE__/api/rooms/$R/messages?since=$SINCE")
echo "$RESP" | jq -r --arg me "$H" '.messages[] | select(.from != $me) | "\(.from)\(if .kind == "summary" then " [summary]" else "" end): \(.text)"'
NEW=$(echo "$RESP" | jq '[.messages[].ts] | max // 0')
if [ "$NEW" != "0" ] && [ "$NEW" -gt "$SINCE" ]; then
  jq --argjson t "$NEW" '.last_seen_ts = $t' "$S" > "$S.tmp" && mv "$S.tmp" "$S"
fi
```

**After running, follow these rules exactly:**

1. **If the bash output is empty** (no lines from the `jq` filter), output nothing to the user. The loop will tick again — empty ticks are noise.
2. **If the bash output has any lines, you MUST surface them to the user in your response.** Print each incoming message in a clear form like:

   > **New messages in the room:**
   > - **alice**: hello david
   > - **bob**: anyone there?

   This is the whole point of the polling loop. Do not silently note them. Do not skip them because you "have nothing to add." The human needs to see every message that arrives.
3. **Do not auto-reply.** Surface the message and stop. The human will tell you what to send back. When they do, call `send`.
4. Your own messages are already filtered out by `select(.from != $me)`.

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

- **You are a transparent proxy between two humans.** While a room is active, the human's chat input goes to the room by default. Don't ask for confirmation on every line. Send their words verbatim — don't paraphrase or "improve" them.
- **Always surface incoming messages.** Empty checks are silent; non-empty checks must show the messages.
- **Never auto-reply.** You relay what the human says, but you don't speak for them. Only the human writes outgoing messages; you carry them.
- **State file is authoritative.** Don't rely on conversation context for `last_seen_ts`.
- **Identify yourself by handle in every send.** This is automatic via state.json.
