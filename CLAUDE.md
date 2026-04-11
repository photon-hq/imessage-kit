# CLAUDE.md

> Context for AI assistants working on this codebase.

## Project

`@photon-ai/imessage-kit` — Type-safe macOS iMessage SDK (TypeScript). Reads from `~/Library/Messages/chat.db` via SQLite, sends via AppleScript.

## Commands

```bash
bun test              # Run all tests
npx tsc --noEmit      # Type-check
npx biome check --write src/  # Format + lint
npm run build         # Build via tsup → dist/
```

## Architecture

```
src/
├── index.ts                    # Public API barrel
├── sdk.ts                      # SDK class — composition root
├── sdk-bounds.ts               # Runtime config bounds (standalone, zero deps)
├── config.ts                   # Compat facade: re-exports BOUNDS + LIMITS
├── domain/                     # Pure business logic — zero I/O, zero external deps
│   ├── attachment.ts           # Attachment interface + TransferStatus
│   ├── chat.ts                 # Chat interface + ChatKind + style constants
│   ├── chat-id.ts              # ChatId value object (parsing, normalization, matching)
│   ├── errors.ts               # IMessageError class + named factories
│   ├── message.ts              # Message interface + enums (Kind, Expire, Share, Schedule)
│   ├── reaction.ts             # Reaction interface + ReactionKind + resolveReactionMeta
│   ├── routing.ts              # MessageTarget + resolveTarget (DM vs group routing)
│   ├── service.ts              # Service type + resolveService
│   ├── timestamp.ts            # MAC_EPOCH + timestamp conversion
│   └── validate.ts             # Recipient, URL, content validation + SEND_LIMITS
├── application/                # Application orchestration — depends on domain + types only
│   ├── send-port.ts            # SendPort interface (implemented by SDK + Sender)
│   ├── message-chain.ts        # Fluent message processing API
│   ├── message-dispatcher.ts   # Incoming event routing (watch → callbacks + plugins)
│   ├── message-scheduler.ts    # Scheduled message delivery (once + recurring)
│   ├── reminders.ts            # Natural language reminder facade
│   └── reminder-time.ts        # Duration + time expression parsing
├── infra/                      # External system adapters
│   ├── platform.ts             # Platform detection, default paths, Darwin version
│   ├── attachments.ts          # Read-only file ops on existing attachments
│   ├── db/                     # SQLite read + watch
│   │   ├── sqlite-adapter.ts   # Runtime-agnostic SQLite (bun:sqlite / better-sqlite3)
│   │   ├── contract.ts         # Query contract + ChatId SQL match helper
│   │   ├── macos26.ts          # macOS 26 query builder (MESSAGE/CHAT/ATTACHMENT fields)
│   │   ├── mapper.ts           # Row → Message/Chat/Attachment conversion
│   │   ├── reader.ts           # High-level database reader facade
│   │   ├── body-decoder.ts     # attributedBody BLOB decoding
│   │   └── watcher.ts          # WAL-based real-time message monitor
│   ├── outgoing/               # Send pipeline
│   │   ├── sender.ts           # Send orchestrator (buddy vs chat method)
│   │   ├── tracker.ts          # MessagePromise + OutgoingMessageManager
│   │   ├── applescript-transport.ts  # AppleScript generation + stdin execution
│   │   ├── downloader.ts       # URL download + format conversion (AVIF/WebP → JPEG)
│   │   └── temp-files.ts       # Temp file lifecycle management
│   └── plugin/                 # Plugin system
│       ├── manager.ts          # Plugin lifecycle + hook dispatch
│       └── logger.ts           # Built-in logger plugin
├── utils/                      # Shared pure utilities (importable by any layer)
│   └── async.ts                # delay, retry, Semaphore
└── types/                      # Type definitions only — no logic
    ├── config.ts               # IMessageConfig
    ├── query.ts                # MessageQuery, ChatQuery
    ├── send.ts                 # SendContent, SendRequest, SendResult
    └── plugin.ts               # Plugin, PluginHooks, hook contexts
```

## Layer Dependency Rules

Enforced by `__tests__/25-architecture-boundaries.test.ts`:

| Layer | May import from |
|-------|----------------|
| `types/` | `types/`, `domain/` types only |
| `domain/` | `domain/`, `types/` |
| `application/` | `application/`, `domain/`, `types/` |
| `infra/` | `infra/`, `domain/`, `types/`, `utils/`, `application/send-port.ts` |
| `utils/` | nothing (pure, zero deps) |
| `sdk.ts` | everything except `index.ts` and `config.ts` |
| `config.ts` | `sdk-bounds.ts`, `domain/validate.ts` |
| `sdk-bounds.ts` | nothing |
| `index.ts` | anything (public API barrel) |

## Code Style

- Biome: 4-space indent, single quotes, trailing commas, semicolons as needed, 120 line width
- Section headers: `// -----------------------------------------------`
- Errors: `SendError(msg)` returns `IMessageError` (not `new SendError()`). Use `instanceof IMessageError` in catch; prefer factories over `new IMessageError` so `code` matches intent.
- 1 production dependency: `@parseaple/typedstream` (for attributedBody BLOB parsing)
- Dual runtime: `bun:sqlite` (Bun) / `better-sqlite3` (Node.js)

## Key Patterns

- **ChatId value object** (`domain/chat-id.ts`): All chatId parsing/normalization in one place. Supports `any;+;guid` (macOS 26+), `iMessage;+;chatGUID` (legacy), `service;-;address` (DM).
- **Port/Adapter**: `application/send-port.ts` defines `SendPort`; infra implements it. `application/message-dispatcher.ts` defines `OutgoingMatcher`; `infra/outgoing/tracker.ts` satisfies it via structural typing.
- **Schema versioning**: `infra/db/contract.ts` defines the query contract; `infra/db/macos26.ts` implements it. Schema detected at init via PRAGMA column introspection, with Darwin version as fallback.
- **WAL watcher**: `infra/db/watcher.ts` monitors the SQLite WAL file for real-time message detection, with fallback to directory watching on WAL rotation.
- **Shared retry**: `utils/async.ts` provides `retry()` with exponential backoff + jitter, `Semaphore` for concurrency control.

## Testing

- Tests in `__tests__/`, run with `bun test`
- `setup.ts` provides `createMockDatabase()`, `insertTestMessage()`, `createSpy()`
- Mock database mirrors macOS Messages schema (includes macOS 26 columns)
- No real macOS or iMessage needed for tests
- Architecture boundaries enforced in `25-architecture-boundaries.test.ts`
