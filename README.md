<div align="center">
  
![Banner](./.github/assets/banner.png)

# @photon-ai/imessage-kit

> A type-safe, elegant iMessage SDK for macOS with cross-runtime support

</div>

[![npm version](https://img.shields.io/npm/v/@photon-ai/imessage-kit.svg)](https://www.npmjs.com/package/@photon-ai/imessage-kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/bZd4CMd2H5)

A full-featured iMessage SDK for **reading**, **sending**, and **automating** iMessage conversations on macOS. Perfect for building AI agents, automation tools, and chat-first applications.

> [!NOTE]
> **✨ Looking for advanced features like threaded replies, tapbacks, message editing, unsending, live typing indicators? Check out [Advanced iMessage Kit](https://github.com/photon-hq/advanced-imessage-kit) and contact us at daniel@photon.codes.**

---

## Features

| Feature | Method | Example |
|---------|--------|---------|
| [Send Text](#send-messages) | `sdk.send()` | [01-send-text.ts](./examples/01-send-text.ts) |
| [Send Image](#send-attachments) | `sdk.send()` | [02-send-image.ts](./examples/02-send-image.ts) |
| [Send File](#send-attachments) | `sdk.send()` | [03-send-file.ts](./examples/03-send-file.ts) |
| [Send to Group](#send-to-groups) | `sdk.send()` | [04-send-group.ts](./examples/04-send-group.ts) |
| [Query Messages](#query-messages) | `sdk.getMessages()` | [05-query-messages.ts](./examples/05-query-messages.ts) |
| [List Chats](#list-chats) | `sdk.listChats()` | [06-list-chats.ts](./examples/06-list-chats.ts) |
| [Real-time Watching](#real-time-watching) | `sdk.startWatching()` | [07-watch-messages.ts](./examples/07-watch-messages.ts) |
| [Auto Reply](#auto-reply) | `onDirectMessage` → `sdk.send()` | [08-auto-reply.ts](./examples/08-auto-reply.ts) |
| [Plugin System](#plugin-system) | `sdk.use()` | [10-plugin.ts](./examples/10-plugin.ts) |
| [Error Handling](#error-handling) | `IMessageError` | [11-error-handling.ts](./examples/11-error-handling.ts) |

---

## Quick Start

### Installation

```bash
# For Bun (zero dependencies)
bun add @photon-ai/imessage-kit

# For Node.js (requires better-sqlite3)
npm install @photon-ai/imessage-kit better-sqlite3
```

### Basic Usage

```typescript
import { IMessageSDK } from '@photon-ai/imessage-kit'

const sdk = new IMessageSDK()

// Send a text message
await sdk.send({ to: '+1234567890', text: 'Hello from iMessage Kit!' })

// Or use async-dispose to guarantee teardown:
await using disposable = new IMessageSDK()
await disposable.send({ to: '+1234567890', text: 'Hi!' })

// Manual teardown
await sdk.close()
```

### Configuration

```typescript
// Simplified; `readonly` modifiers omitted for readability — see src/types/config.ts
interface IMessageConfig {
    databasePath?: string        // Path to Messages SQLite database (default: ~/Library/Messages/chat.db)
    maxConcurrentSends?: number  // Concurrent send cap (default 10, range 1..50)
    sendTimeout?: number         // ms per AppleScript invocation (default 30_000, range 1_000..300_000)
    debug?: boolean              // Verbose SDK logs
    plugins?: Plugin[]           // Plugins registered at construction; sdk.use() is also available later
}
```

Out-of-range numeric values **throw** `IMessageError(code: 'CONFIG')` at construction — they are not silently clamped. The accepted ranges are exposed as the `BOUNDS` constant exported from the package root.

### Granting Permission

`IMessageKit` requires **Full Disk Access** to read `chat.db`.

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **"+"** and add your IDE or terminal (e.g., Cursor, VS Code, Terminal, Warp)

---

## Send vs Observe Semantics

- `sdk.send(request)` returns `Promise<void>` that resolves when `osascript` exits successfully. It does **not** confirm the message landed in `chat.db`, nor does it return a `Message` object.
- To correlate your send with a `chat.db` row (and observe delivery transitions), subscribe to `onFromMeMessage` via the watcher — it fires for every from-me row observed, whether authored by this SDK, another Apple client, or Messages.app.

```typescript
// Fire-and-forget send
await sdk.send({ to: '+1234567890', text: 'Hi' })

// Observe the landed row
await sdk.startWatching({
    onFromMeMessage: (msg) => console.log('Landed in chat.db:', msg.id, msg.isDelivered),
})
```

---

## Messages

> Examples: [01-send-text.ts](./examples/01-send-text.ts) | [02-send-image.ts](./examples/02-send-image.ts) | [03-send-file.ts](./examples/03-send-file.ts) | [05-query-messages.ts](./examples/05-query-messages.ts)

### Send Messages

`sdk.send(request: SendRequest): Promise<void>`

```typescript
// Simplified; `readonly` modifiers omitted for readability — see src/types/send.ts
interface SendRequest {
    to: string                  // phone, email, or chatId
    text?: string
    attachments?: string[]      // local absolute paths; remote URLs are rejected
}

// Text
await sdk.send({ to: '+1234567890', text: 'Hello World!' })

// Email recipient
await sdk.send({ to: 'user@example.com', text: 'Hello!' })
```

### Send Attachments

```typescript
// Local file paths only — download remote URLs yourself first.
await sdk.send({ to: '+1234567890', attachments: ['/abs/path/image.jpg'] })

// Text + multiple attachments — non-transactional: the first osascript call
// bundles text + attachments[0]; each later attachment is its own call with
// a ~500ms inter-step pacing. A mid-batch failure is labelled
// "attachment N/total".
await sdk.send({
    to: '+1234567890',
    text: 'Check this out',
    attachments: ['/abs/path/photo.jpg', '/abs/path/report.pdf']
})
```

### Query Messages

```typescript
const messages = await sdk.getMessages({
    chatId: 'any;+;chat534ce85d...',   // optional — scopes to one conversation
    participant: '+1234567890',
    service: 'iMessage',                // 'iMessage' | 'SMS' | 'RCS'
    isFromMe: false,                    // tri-state: omit → both
    isRead: false,                      // tri-state: omit → both
    hasAttachments: true,               // tri-state: omit → both
    excludeReactions: true,             // drop tapback/sticker rows
    since: new Date('2025-01-01'),
    before: new Date('2025-02-01'),
    search: 'meeting',                  // app-layer substring over decoded text
    limit: 20,
    offset: 0,
})
```

`search` runs in application layer over decoded `attributedBody` — there is no SQL `LIKE` index. Narrow with `chatId` / `participant` / `since` / `limit` on large databases.

---

## Chats

> Examples: [04-send-group.ts](./examples/04-send-group.ts) | [06-list-chats.ts](./examples/06-list-chats.ts)

### List Chats

```typescript
const chats = await sdk.listChats({
    chatId: 'any;+;chat...',   // optional — scope to one chat
    kind: 'group',              // 'group' | 'dm'
    service: 'iMessage',
    isArchived: false,
    hasUnread: true,
    sortBy: 'recent',           // 'recent' | 'name'
    search: 'Project',          // LIKE over display_name / chat_identifier (escaped)
    limit: 20,
    offset: 0,
})

for (const chat of chats) {
    console.log({
        chatId: chat.chatId,
        name: chat.name,
        kind: chat.kind,
        unread: chat.unreadCount,
        lastMessageAt: chat.lastMessageAt,
    })
}
```

### Send to Groups

Never hand-write a group `chatId`. Always use one surfaced by the SDK.

```typescript
// From listChats
const groups = await sdk.listChats({ kind: 'group' })
await sdk.send({ to: groups[0].chatId, text: 'Hello group!' })

// From the watcher
await sdk.startWatching({
    onGroupMessage: async (msg) => {
        if (msg.chatId) await sdk.send({ to: msg.chatId, text: 'ack' })
    }
})
```

### ChatId Formats

| Format | Example | Used for |
|--------|---------|----------|
| DM bare address | `+1234567890` / `user@example.com` | DM routing; SDK prefixes internally |
| DM prefixed | `iMessage;-;+1234567890` | Canonical DM chatId |
| Group (macOS 26+) | `any;+;chat534ce85d...` | Group chat (current) |
| Group (legacy) | `iMessage;+;chat534ce85d...` | Pre-macOS-26 group chat |
| Group (bare GUID) | `chat45e2b868...` | Accepted as input; SDK prefixes internally |

Parse / validate directly via the exported value object when needed:

```typescript
import { ChatId, resolveTarget } from '@photon-ai/imessage-kit'

const cid = ChatId.fromUserInput('iMessage;-;pilot@photon.codes')
cid.isGroup            // false
cid.coreIdentifier     // 'pilot@photon.codes'

const target = resolveTarget('+1234567890')   // MessageTarget (dm | group)
```

---

## Real-time Events

> Examples: [07-watch-messages.ts](./examples/07-watch-messages.ts) | [08-auto-reply.ts](./examples/08-auto-reply.ts) | [09-get-sent-message.ts](./examples/09-get-sent-message.ts)

### Real-time Watching

`sdk.startWatching(events)` accepts five callbacks. Calling it while a watcher is already running throws `IMessageError(code: 'CONFIG', message: 'Watcher is already running')` — stop it first.

```typescript
await sdk.startWatching({
    onIncomingMessage: (msg) => { /* every incoming (non-from-me) row */ },
    onDirectMessage:   (msg) => { /* incoming DMs only */ },
    onGroupMessage:    (msg) => { /* incoming group messages only */ },
    onFromMeMessage:   (msg) => { /* any from-me row — this SDK or another client */ },
    onError:           (err) => { /* dispatch errors */ },
})

await sdk.stopWatching()   // safe to call even if never started
```

### Auto Reply

```typescript
await sdk.startWatching({
    onDirectMessage: async (msg) => {
        if (!msg.text || !/hello/i.test(msg.text)) return
        if (!msg.chatId) return   // rare WAL race before chat_message_join flushes
        await sdk.send({ to: msg.chatId, text: 'Hi there!' })
    }
})
```

---

## Attachments

> Examples: [02-send-image.ts](./examples/02-send-image.ts) | [03-send-file.ts](./examples/03-send-file.ts)

### Attachment Helpers

Only iMessage-specific helpers are exported. For copy / read / stat, use `node:fs` directly against `attachment.localPath`.

```typescript
import {
    attachmentExists,
    getAttachmentExtension,
    isImageAttachment,
    isVideoAttachment,
    isAudioAttachment,
} from '@photon-ai/imessage-kit'

const [msg] = await sdk.getMessages({ hasAttachments: true, limit: 1 })
const attachment = msg?.attachments[0]

if (attachment && await attachmentExists(attachment)) {
    if (isImageAttachment(attachment)) {
        const ext = getAttachmentExtension(attachment)   // lowercase, no leading dot — e.g. 'jpg'
        // Use node:fs for anything further (copyFile, createReadStream, stat, …)
    }
}
```

---

## Plugin System

> Example: [10-plugin.ts](./examples/10-plugin.ts) · reference logger: [logger-plugin.ts](./examples/logger-plugin.ts)

`sdk.use(plugin)` can be called before or after `sdk` is initialized — late registrations are joined to the pipeline on the next hook. Plugins are torn down on `sdk.close()`.

```typescript
import { definePlugin } from '@photon-ai/imessage-kit'

const audit = definePlugin({
    name: 'audit',
    version: '1.0.0',
    onBeforeSend: ({ request }) => {
        // Throw here to veto the send; cause is attached to IMessageError(SEND).
        if (request.text?.includes('forbidden')) throw new Error('blocked by policy')
    },
    onAfterSend: ({ request }) => {
        console.log('[audit] dispatched to', request.to)
    },
})

sdk.use(audit)
```

### Hook contract

All 11 hooks, grouped by dispatch mode:

| Hook | Mode | Behaviour on throw |
|------|------|--------------------|
| `onInit` | sequential | Routed to `onError` |
| `onDestroy` | sequential | Routed to `onError` |
| `onError` | sequential | Logged once; not re-routed (prevents recursion) |
| `onBeforeMessageQuery` | **interrupting** | Aborts `getMessages` with `IMessageError(DATABASE)` |
| `onBeforeChatQuery` | **interrupting** | Aborts `listChats` with `IMessageError(DATABASE)` |
| `onBeforeSend` | **interrupting** | Aborts `send` with `IMessageError(SEND)` — use as auth/policy gate |
| `onAfterMessageQuery` | parallel | Routed to `onError` |
| `onAfterChatQuery` | parallel | Routed to `onError` |
| `onAfterSend` | parallel | Fires only on successful AppleScript dispatch |
| `onIncomingMessage` | parallel | Every incoming row observed by the watcher |
| `onFromMe` | parallel | Every from-me row observed — authoritative DB-arrival signal |

> **Naming quirk.** The same from-me event surfaces as `DispatchEvents.onFromMeMessage` (user callback passed to `startWatching`) and `PluginHooks.onFromMe` (plugin entry point). They are intentionally distinct to mark the "inline handler" vs "plugin observer" boundary.

---

## Error Handling

> Example: [11-error-handling.ts](./examples/11-error-handling.ts)

All SDK failures surface as `IMessageError` with a typed `code`.

```typescript
import { IMessageError } from '@photon-ai/imessage-kit'

try {
    await sdk.send({ to: '+1234567890', text: 'Hello' })
} catch (error) {
    if (error instanceof IMessageError) {
        // error.code: 'PLATFORM' | 'DATABASE' | 'SEND' | 'CONFIG'
        // error.cause: original thrown Error (when applicable)
        console.error(`[${error.code}] ${error.message}`)
    }
}
```

`IMessageError` codes map to failure classes:
- `PLATFORM` — non-darwin runtime, or missing `$HOME` (only raised by `requireMacOS()` / `getDefaultDatabasePath()`)
- `DATABASE` — SQLite open failure, query errors, decoder issues, or `onBeforeMessageQuery` / `onBeforeChatQuery` plugin veto
- `SEND` — AppleScript dispatch failure, `osascript` non-zero exit, Messages.app not running, attachment unreadable, send cancellation, or `onBeforeSend` plugin veto
- `CONFIG` — out-of-bounds config, malformed chatId, SDK already destroyed, watcher already running, duplicate plugin name

---

## Examples

Run any example with Bun (requires macOS and Full Disk Access):

```bash
bun run examples/01-send-text.ts
```

### Getting Started
- [01-send-text.ts](./examples/01-send-text.ts) — basic text message
- [02-send-image.ts](./examples/02-send-image.ts) — send an image attachment
- [03-send-file.ts](./examples/03-send-file.ts) — send an arbitrary file

### Message Operations
- [05-query-messages.ts](./examples/05-query-messages.ts) — filter history
- [09-get-sent-message.ts](./examples/09-get-sent-message.ts) — correlate a send with its chat.db row

### Chats & Groups
- [04-send-group.ts](./examples/04-send-group.ts) — send to a group
- [06-list-chats.ts](./examples/06-list-chats.ts) — list conversations

### Real-time & Automation
- [07-watch-messages.ts](./examples/07-watch-messages.ts) — watcher lifecycle
- [08-auto-reply.ts](./examples/08-auto-reply.ts) — auto-reply bot

### Advanced
- [10-plugin.ts](./examples/10-plugin.ts) — custom plugin
- [11-error-handling.ts](./examples/11-error-handling.ts) — `IMessageError` handling
- [logger-plugin.ts](./examples/logger-plugin.ts) — a reference logger plugin to adapt

---

## API Reference

### Core Methods

| Method | Description |
|--------|-------------|
| `new IMessageSDK(config?)` | Construct the SDK (sync). Opens the DB lazily. |
| `sdk.use(plugin)` | Register a plugin; valid before or after init. |
| `sdk.getMessages(query?)` | Query historical messages. Returns `Message[]`. |
| `sdk.listChats(query?)` | Query chat summaries. Returns `Chat[]`. |
| `sdk.send(request)` | Dispatch a send via AppleScript. Resolves on `osascript` exit. |
| `sdk.startWatching(events)` | Begin WAL-based real-time watching. Throws `IMessageError(CONFIG)` if a watcher is already live. |
| `sdk.stopWatching()` | Stop the watcher. Safe when never started. |
| `sdk.close()` | Tear down watcher, plugins, and DB. Concurrent callers share the in-flight teardown; teardown failures surface as `AggregateError`. |
| `await using sdk = new IMessageSDK()` | `Symbol.asyncDispose` integration — auto-close on scope exit. |

### Types

```typescript
interface Message {
    rowId: number
    id: string
    text: string | null
    participant: string | null
    chatId: string | null
    chatKind: 'dm' | 'group' | 'unknown'
    service: 'iMessage' | 'SMS' | 'RCS' | null
    kind: 'text' | 'memberAdded' | 'memberRemoved' | 'nameChanged' | 'groupAction' | 'unknown'
    isFromMe: boolean
    isRead: boolean
    isSent: boolean
    isDelivered: boolean
    createdAt: Date
    deliveredAt: Date | null
    readAt: Date | null
    editedAt: Date | null
    retractedAt: Date | null
    reaction: Reaction | null
    attachments: Attachment[]
    // ...plus ~30 additional fields; see src/domain/message.ts for the full interface
}
```

Full types — `Message`, `Chat`, `Attachment`, `Reaction`, `SendRequest`, `MessageQuery`, `ChatQuery`, `Plugin`, `PluginHooks`, `DispatchEvents`, `MessageTarget` — are exported from the package root. See `llms.txt` for the condensed reference.

---

## Requirements

- **OS**: macOS only
- **Runtime**: Node.js >= 20.0.0 or Bun >= 1.0.0
- **Permissions**: Full Disk Access

---

## LLMs

Download `llms.txt` for language model context:

- [Download llms.txt](./llms.txt)

### Context7 MCP

- [Context7 Docs](https://context7.com/photon-hq/imessage-kit)

Add [Context7 MCP](https://context7.com/docs/installation) to your IDE, then use:

```
use context7: photon-hq/imessage-kit
```

---

## License

[MIT License](./LICENSE)

---

**Note**: This SDK is for educational and development purposes. Always respect user privacy and follow Apple's terms of service.
