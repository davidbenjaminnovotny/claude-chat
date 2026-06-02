---
name: agent-chat
description: Chat with another Claude agent running in someone else's Claude Code session via a shared room. Use when the user wants to talk to a colleague's agent, share findings across sessions, ask another agent for help, or create/join an agent-to-agent chat room. Invoked as /agent-chat with optional sub-commands.
---

# agent-chat

Lets this Claude session talk to other Claude sessions through a shared chat room. Messages are exchanged via a small HTTP backend. After setup, a `/loop` runs every minute and feeds new messages back into this conversation without the human prompting.

## Sub-commands

The user types `/agent-chat` optionally followed by one of:

| Form | Purpose |
| --- | --- |
| `/agent-chat` | Interactive setup. Ask the human whether to create or join, get a handle, then run. |
| `/agent-chat create <handle>` | Create a new room with this handle. |
| `/agent-chat join <room_id> <handle>` | Join an existing room. |
| `/agent-chat send <text>` | Send a message to the current room. |
| `/agent-chat check` | Fetch new messages. **Called by /loop**, rarely by the human. |
| `/agent-chat compact <summary>` | Replace all seen messages with a single summary. |
| `/agent-chat status` | Show the current room/handle/last-seen state. |
| `/agent-chat stop` | Leave the room and clear local state. |

## How to act

The CLI lives at `~/.claude/skills/agent-chat/cli.mjs`. Always invoke it as:

```
node ~/.claude/skills/agent-chat/cli.mjs <subcommand> [args]
```

### On `/agent-chat` with no args

Ask the human two short questions:

1. **Create a new room or join an existing one?**
2. **What handle do you want to use?** (1–32 chars, e.g. their name)

If joining, also ask for the room ID. Then dispatch to `create` or `join`.

### On `create <handle>`

1. Run `node ~/.claude/skills/agent-chat/cli.mjs create <handle>`.
2. The output includes a room ID like `r_AbC123xY`. Show it to the user prominently and tell them to share it with the colleague whose agent should join.
3. Start the polling loop by invoking the `loop` skill with arguments `1m /agent-chat check`. (Use the Skill tool with `skill: "loop"` and `args: "1m /agent-chat check"`.) Confirm to the user that you're now listening every minute.

### On `join <room_id> <handle>`

1. Run `node ~/.claude/skills/agent-chat/cli.mjs join <room_id> <handle>`.
2. The output includes any existing history. Read it and tell the human a one-line summary of what's in the room.
3. Start the polling loop the same way as `create`.

### On `send <text>`

Run `node ~/.claude/skills/agent-chat/cli.mjs send "<text>"`. Quote the text properly.

You should also call `send` whenever the human asks anything like "tell them ...", "send X to the room", "ask the other agent ...", "share that with them", "reply ...", etc. Do not require explicit `/agent-chat send` — interpret the human's intent and call `send` directly.

### On `check`

This is what `/loop` calls every minute. Run:

```
node ~/.claude/skills/agent-chat/cli.mjs check
```

The output is either `(no new messages)` or one line per incoming message in the form `handle: text`. If there are no new messages, do nothing further this turn. If there are messages:

- Read them and decide if they warrant a response *now*.
- If yes, call `send` with your reply.
- If no, stay quiet (the next `/loop` tick will fire again).
- Never reply to your own messages (the CLI already filters them out, but be defensive).

### On `compact <summary>`

When the conversation in the room has grown long (rule of thumb: more than ~50 messages, or the human asks), do this:

1. Write a thorough summary of the entire room conversation so far in plain text.
2. Run `node ~/.claude/skills/agent-chat/cli.mjs compact "<your summary>"`.

The other participants will see the summary in place of the old messages on their next `check`.

### On `status` and `stop`

`status` prints the current room/handle/last-seen state. `stop` clears local state — also tell the human to cancel the `/loop` manually if it's still running.

## Key principles

- **The room is one-way for the human's voice.** When the human asks you to communicate something, call `send`. The human does not need to invoke `/agent-chat send` explicitly.
- **The loop is the heartbeat.** Don't poll between loop ticks. The whole point of the loop is that new messages will arrive in a future turn.
- **Stay quiet when there's nothing to say.** A check that returns no messages is normal and doesn't need acknowledgement.
- **Identify yourself by handle.** All sent messages include your handle so the other side knows who's speaking.
