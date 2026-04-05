# iMessage AI Agent

A minimal iMessage-native AI agent built with TypeScript, [`@photon-ai/imessage-kit`](https://www.npmjs.com/package/@photon-ai/imessage-kit), and a local Qwen model running through Ollama on macOS.

This agent is designed to do two useful jobs:

- ignore suspected spam messages
- summarize long incoming messages and send back a short natural reply

The implementation lives in [../16-ai-agent.ts](/Users/maruthienugula/imessage-kit/examples/16-ai-agent.ts).

## What It Does

The agent watches incoming direct iMessages in real time and decides whether it should act.

Its behavior is intentionally narrow:

- ignores messages sent by you
- ignores messages that look like spam or scams
- ignores short normal messages
- summarizes long messages over 200 characters
- sends back a short, friendly, human-sounding reply
- avoids simple reply loops by remembering recent replies

This keeps the agent practical and predictable instead of trying to answer every message.

## Why This Is Useful

Two kinds of messages tend to create the most friction in iMessage:

- spammy messages that waste attention
- long messages that take effort to read and respond to

This agent helps by filtering the first category and compressing the second. The result is a lightweight assistant that reduces noise and helps you react faster without sending your messages to a cloud API.

## How It Works

The system has three parts:

1. `@photon-ai/imessage-kit` watches your iMessages
2. Ollama runs a local Qwen model on your Mac
3. the TypeScript script sends long messages to Qwen and sends the reply back through iMessage

The message flow is:

1. a new direct message arrives
2. the SDK triggers `onDirectMessage`
3. the script ignores it if it is from you, empty, spam-like, or recently sent by the agent
4. the script ignores it if it is short
5. if it is long, the script asks Qwen for a concise summary-style reply
6. the reply is sent back with `sdk.send()`

## Core Behaviors

### 1. Spam Filtering

Before the model is called, the script checks for common spam signals such as:

- phrases like `free money`, `claim now`, `winner`, `verify your account`
- suspicious short-link patterns
- aggressive urgency wording
- unusually high all-caps ratio

If a message looks suspicious, it is ignored.

Why this matters:

- avoids wasting model calls
- reduces noise
- keeps the agent focused on meaningful messages

### 2. Long-Message Summarization

If a message is longer than 200 characters, the script sends it to the local Qwen model.

The prompt tells the model to:

- sound like a normal person texting a friend
- avoid saying it is an AI
- avoid explaining its reasoning
- reply briefly and naturally
- respond in a concise summary-style way

Why this matters:

- long messages are the most mentally expensive to process
- a concise summary-style reply is often enough to keep the conversation moving
- this gives you a lightweight assistant instead of a full chatbot

### 3. Anti-Loop Protection

Messaging agents can accidentally respond to their own synced messages. To reduce that risk, the script stores recent outgoing replies in memory for 60 seconds.

If an incoming message exactly matches one of those recent replies, it is ignored.

Why this matters:

- prevents basic reply loops
- keeps the chat clean
- avoids visible tags like `[AGENT]`

## Requirements

You need:

- macOS
- access to the Messages app
- Bun
- Ollama
- a local Qwen model
- Full Disk Access for the app running the script

## Setup

### 1. Install Bun

Bun is used to install dependencies and run the TypeScript file.

```bash
curl -fsSL https://bun.com/install | bash
source ~/.zshrc
bun --version
```

Install project dependencies:

```bash
cd /Users/maruthienugula/imessage-kit
bun install
```

### 2. Install Ollama

Ollama runs the local model on your Mac.

Install it from:

- [Ollama](https://ollama.com)
- [Ollama macOS docs](https://docs.ollama.com/macos)

Then verify the CLI:

```bash
ollama --version
```

### 3. Download a Qwen Model

Pull a local Qwen model with Ollama. A good starting point is:

```bash
ollama pull qwen2:0.5b
```

If you want an instruct-tuned tag and it is available locally, you can use:

```bash
ollama pull qwen2:0.5b-instruct
```

Quick test:

```bash
ollama run qwen2:0.5b
```

If your model name differs, you can point the script to it with `LLM_MODEL`.

### 4. Grant Full Disk Access

This step is required for `imessage-kit` to read the Messages database.

Open:

`System Settings -> Privacy & Security -> Full Disk Access`

Add the app you use to run the script, for example:

- Terminal
- iTerm
- VS Code
- Cursor

Why this matters:

- without Full Disk Access, the script may not be able to watch your messages

### 5. Run the Agent

The agent file is [../16-ai-agent.ts](/Users/maruthienugula/imessage-kit/examples/16-ai-agent.ts).

Run it from the repo root:

```bash
cd /Users/maruthienugula/imessage-kit
LLM_MODEL=qwen2:0.5b bun examples/16-ai-agent.ts
```

If you are using a different model tag:

```bash
LLM_MODEL=qwen2:0.5b-instruct bun examples/16-ai-agent.ts
```

The script talks to Ollama at:

```text
http://127.0.0.1:11434/api/generate
```

You can override that with `OLLAMA_URL` if needed.

## How To Test It

For the cleanest test:

- send a message from another phone number or another Apple account
- do not test only by messaging yourself from the same iMessage identity
- send a spam-like message and confirm it is ignored
- send a long message over 200 characters and confirm it gets summarized

Expected behavior:

- spam-like message: ignored
- short normal message: ignored
- long message: summarized and replied to

## Environment Variables

### `LLM_MODEL`

Controls which Ollama model tag is used.

Examples:

```bash
LLM_MODEL=qwen2:0.5b bun examples/16-ai-agent.ts
```

```bash
LLM_MODEL=qwen2:0.5b-instruct bun examples/16-ai-agent.ts
```

### `OLLAMA_URL`

Controls the Ollama API endpoint.

Default:

```text
http://127.0.0.1:11434/api/generate
```

## Internal Logic

The agent’s decision flow is:

1. wait for a new direct message
2. ignore it if it is from you
3. ignore it if it is empty
4. ignore it if it matches a recent agent reply
5. ignore it if it looks like spam
6. ignore it if it is short
7. if it is long, send it to Qwen
8. generate a short summary-style reply
9. send the reply back through iMessage

## Why Use a Local Model

Using a local Qwen model gives this setup a few strong advantages:

- message content stays on your device
- no per-message API billing
- no external credentials needed
- lower-friction experimentation
- better privacy for personal conversations

This makes the project a good fit for private messaging workflows.

## Current Limitations

This is still a minimal agent, so there are a few tradeoffs:

- the spam filter is heuristic-based and not perfect
- anti-loop protection is memory-based and resets when the script restarts
- the current agent only watches direct messages
- short messages are intentionally ignored
- summary quality depends on the Qwen model you use

My practical recommendation: `qwen2:0.5b` is a fine starting point, but a slightly larger local model may produce better summaries if you want stronger results.

## Files

- implementation: [../16-ai-agent.ts](/Users/maruthienugula/imessage-kit/examples/16-ai-agent.ts)
- SDK docs: [/Users/maruthienugula/imessage-kit/README.md](/Users/maruthienugula/imessage-kit/README.md)
