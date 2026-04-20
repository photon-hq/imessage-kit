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
├── domain/                     # Pure business logic — zero I/O, zero external deps
│   ├── attachment.ts           # Attachment interface + TransferStatus
│   ├── chat.ts                 # Chat interface + ChatKind + style constants
│   ├── chat-id.ts              # ChatId value object (parsing, normalization, matching)
│   ├── errors.ts               # IMessageError class + named factories
│   ├── message.ts              # Message interface + enums (Kind, Expire, Share, Schedule)
│   ├── messages-app.ts         # macOS/Messages.app protocol facts (TCC safe dirs, temp prefix)
│   ├── reaction.ts             # Reaction interface + ReactionKind + resolveReactionMeta
│   ├── routing.ts              # MessageTarget + resolveTarget (DM vs group routing)
│   ├── service.ts              # Service type + resolveService
│   ├── timestamp.ts            # MAC_EPOCH + timestamp conversion
│   └── validate.ts             # URL + content validation
├── application/                # Application orchestration — depends on domain + types only
│   ├── send-port.ts            # SendPort interface (implemented by SDK + Sender)
│   └── message-dispatcher.ts   # Incoming event routing (watch → callbacks + plugins)
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
│   │   ├── applescript-transport.ts  # AppleScript generation + stdin execution
│   │   └── temp-files.ts       # Sandbox-bypass mktemp file cleanup (~/Pictures/imsg_temp_*)
│   └── plugin.ts               # Plugin lifecycle + hook dispatch (interrupting / sequential / parallel)
├── utils/                      # Shared pure utilities (importable by any layer)
│   └── async.ts                # delay, retry, Semaphore
└── types/                      # Type definitions only — no logic
    ├── config.ts               # IMessageConfig
    ├── query.ts                # MessageQuery, ChatQuery
    ├── send.ts                 # SendRequest
    └── plugin.ts               # Plugin, PluginHooks, hook contexts
```

## Layer Dependency Rules

Enforced by `__tests__/25-architecture-boundaries.test.ts`:

| Layer | May import from |
|-------|----------------|
| `types/` | `types/`, `domain/` types only |
| `domain/` | `domain/`, `types/` |
| `application/` | `application/`, `domain/`, `types/` |
| `infra/` | `infra/`, `domain/`, `types/`, `utils/`, `application/send-port.ts`, `application/message-dispatcher.ts` |
| `utils/` | nothing (pure, zero deps) |
| `sdk.ts` | everything except `index.ts` |
| `sdk-bounds.ts` | nothing |
| `index.ts` | anything (public API barrel) |

## Code Style

- Biome: 4-space indent, single quotes, trailing commas, semicolons as needed, 120 line width
- Section headers: `// -----------------------------------------------`
- Errors: `SendError(msg)` returns `IMessageError` (not `new SendError()`). Use `instanceof IMessageError` in catch; prefer factories over `new IMessageError` so `code` matches intent. Exception: when re-throwing an `IMessageError` with added context, use `new IMessageError(upstream.code, msg, { cause: upstream })` so the original `code` is preserved (see `sender.ts` attachment-precheck re-throw).
- 1 production dependency: `@parseaple/typedstream` (for attributedBody BLOB parsing)
- Dual runtime: `bun:sqlite` (Bun) / `better-sqlite3` (Node.js)

## Key Patterns

- **ChatId value object** (`domain/chat-id.ts`): All chatId parsing/normalization in one place. Supports `any;+;guid` (macOS 26+), `iMessage;+;chatGUID` (legacy), `service;-;address` (DM).
- **Port/Adapter**: `application/send-port.ts` defines `SendPort` (`send(request): Promise<void>`); `infra/outgoing/sender.ts` implements it. `send()` resolves on AppleScript dispatch only — to observe the chat.db row, subscribe via the watcher (see Naming Quirk below).
- **Runtime bounds** (`sdk-bounds.ts`): `maxConcurrentSends` (default 10, 1..50) and `sendTimeout` (default 30_000 ms, 1_000..300_000) are the only user-tunable knobs. `validateBound` in `sdk.ts` **throws `IMessageError(CONFIG)`** on out-of-range — it does NOT clamp.
- **Schema versioning**: `infra/db/contract.ts` defines the `MessagesDbQueries` contract; `infra/db/macos26.ts` is the sole current implementation. The contract is the extension seam — future schemas (e.g. macOS 27) add a new adapter and the reader picks one at construction time.
- **WAL watcher**: `infra/db/watcher.ts` monitors the SQLite WAL file for real-time message detection, with fallback to directory watching on WAL rotation.
- **Shared retry**: `utils/async.ts` provides `retry()` with exponential backoff + jitter, `Semaphore` for concurrency control.

## Plugin Dispatch Modes

`infra/plugin.ts` dispatches hooks in three modes — pick by hook semantics, not by convenience. The classifier is `SEQUENTIAL_HOOKS` in `src/infra/plugin.ts:43`; everything observing but not in that set goes through parallel dispatch.

| Mode | Hooks | Semantics |
|------|-------|-----------|
| **interrupting** | `onBeforeSend`, `onBeforeMessageQuery`, `onBeforeChatQuery` | `pre → normal → post` order; first throw short-circuits and is re-thrown as `IMessageError(code)` with the original error as `cause`. Throws do **not** flow through `onError` (gate rejections are intended behaviour). |
| **sequential** | `onInit`, `onDestroy`, `onError` | One plugin at a time in `pre → normal → post` order. `onInit`/`onDestroy` throws route to `onError`. `onError` throws are suppressed (logged once) to prevent recursion. |
| **parallel** | `onAfterSend`, `onAfterMessageQuery`, `onAfterChatQuery`, `onIncomingMessage`, `onFromMe` | `Promise.all` over all plugins; every error is collected and routed to `onError`. Use for idempotent observers — order is not guaranteed. |

## Naming Quirk — `onFromMeMessage` vs `onFromMe`

Two intentionally-distinct names for the same underlying event:

- `DispatchEvents.onFromMeMessage` — user callback passed to `sdk.startWatching({ events: { onFromMeMessage } })`. Fires on every from-me row the watcher observes (this SDK, other Apple clients, Messages.app UI).
- `PluginHooks.onFromMe` — plugin hook. Same event, plugin-side entry point.

Do **not** unify them — users configure watcher events inline but register plugins ahead of time, and the two names make the mental boundary explicit. The SDK internally fans out a single watcher observation to both surfaces.

## Testing

- Tests in `__tests__/`, run with `bun test`
- `setup.ts` provides `createMockDatabase()`, `insertTestMessage()`, `createSpy()`
- Mock database mirrors macOS Messages schema (includes macOS 26 columns)
- No real macOS or iMessage needed for tests
- Architecture boundaries enforced in `25-architecture-boundaries.test.ts`

## AI Hardness — mandatory for non-trivial changes

Before proposing any non-trivial change, follow this protocol:

1. **Define axes** — correctness, simplicity, decoupling, clarity, API impact, performance (in priority order)
2. **Generate ≥3 candidates** (conservative / aggressive / middle) with trade-offs
3. **Adversarial self-check** — when does it break? root or symptom? would I approve this PR?
4. **Red flags stop work** — "add a JSDoc / keep shell / add fallback / special-case / silently coerce" means re-diagnose, not patch
5. **Loose-coupling & clean-code rules** — one responsibility per module, no silent fallbacks, no shells, delete > add, small blast radius, test-first for behavior changes
6. **Produce a decision artifact** before writing code. No artifact = not enough thought = do not act.

Dead-code diagnosis: grep consumers first. Zero internal consumers → delete, don't document. Exception: public API surface (exported methods, interface fields) is kept since SDK users live outside this repo.
