/**
 * Plugin type definitions.
 *
 * Defines the contract that user-authored plugins implement.
 */

import type { Chat } from '../domain/chat'
import type { Message } from '../domain/message'
import type { ChatQuery, MessageQuery } from './query'
import type { SendRequest } from './send'

// -----------------------------------------------
// Hook contexts
// -----------------------------------------------

export interface BeforeMessageQueryContext {
    readonly query: MessageQuery
}

export interface AfterMessageQueryContext {
    readonly query: MessageQuery
    readonly messages: readonly Message[]
}

export interface BeforeChatQueryContext {
    readonly query: ChatQuery
}

export interface AfterChatQueryContext {
    readonly query: ChatQuery
    readonly chats: readonly Chat[]
}

export interface BeforeSendContext {
    readonly request: SendRequest
}

export interface AfterSendContext {
    readonly request: SendRequest
}

export interface MessageContext {
    readonly message: Message
}

export interface PluginErrorContext {
    readonly error: Error
    readonly context?: string
}

// -----------------------------------------------
// Plugin hooks
// -----------------------------------------------

/**
 * Plugin lifecycle and event hooks.
 *
 * **Dispatch modes** (see `infra/plugin.ts`):
 *
 *   - **Interrupting (sequential, fail-fast)** — `onBeforeMessageQuery`,
 *     `onBeforeChatQuery`, `onBeforeSend`. Plugins run in pre / normal /
 *     post order. The FIRST plugin that throws aborts the surrounding
 *     SDK operation (`getMessages` / `listChats` / `send`) — the remaining
 *     plugins are not invoked, and the caller receives an `IMessageError`
 *     whose `code` matches the operation (`DATABASE` for queries, `SEND`
 *     for sends) and whose `cause` is the plugin's thrown error. These
 *     hooks are therefore a legitimate gate: throw to reject auth, rate
 *     limits, or content policy.
 *
 *   - **Sequential (observing)** — `onInit`, `onError`, `onDestroy`. Run
 *     one at a time. A throw is captured, logged, and reported to `onError`
 *     (except for `onError` itself, which is logged once to avoid
 *     recursion). The surrounding operation continues so that a single
 *     plugin failure cannot take down the SDK lifecycle.
 *
 *   - **Parallel (observing)** — `onAfterMessageQuery`, `onAfterChatQuery`,
 *     `onIncomingMessage`, `onFromMe`. All matching plugins run concurrently;
 *     their promises are awaited as a group. Individual failures are
 *     reported to `onError`; the query result / incoming message still
 *     propagates to the caller or other plugins.
 *
 * Within each mode, plugins with `order: 'pre'` run before unset, and
 * `order: 'post'` run last.
 *
 * Hook return values are ignored — plugins cannot rewrite the request or
 * the result. Interception is all-or-nothing via throw from an
 * interrupting hook.
 */
export interface PluginHooks {
    /** Sequential (observing). Called once per plugin when the SDK initialises. Throws are routed to `onError`. */
    onInit?: () => void | Promise<void>

    /** Interrupting. Before each `sdk.getMessages()`. Throw to abort the query with `IMessageError` (code `DATABASE`). */
    onBeforeMessageQuery?: (ctx: BeforeMessageQueryContext) => void | Promise<void>

    /** Parallel (observing). After `sdk.getMessages()` resolves. Throws are routed to `onError`. */
    onAfterMessageQuery?: (ctx: AfterMessageQueryContext) => void | Promise<void>

    /** Interrupting. Before each `sdk.listChats()`. Throw to abort the query with `IMessageError` (code `DATABASE`). */
    onBeforeChatQuery?: (ctx: BeforeChatQueryContext) => void | Promise<void>

    /** Parallel (observing). After `sdk.listChats()` resolves. Throws are routed to `onError`. */
    onAfterChatQuery?: (ctx: AfterChatQueryContext) => void | Promise<void>

    /**
     * Interrupting. Before each `sdk.send()` dispatches via AppleScript.
     * Throw to reject the send with `IMessageError` (code `SEND`); the
     * plugin's error is attached as `cause`. Use as an auth / policy gate.
     */
    onBeforeSend?: (ctx: BeforeSendContext) => void | Promise<void>

    /**
     * Parallel (observing). Fires only after AppleScript dispatch
     * succeeded; failed sends propagate to the caller and do NOT fire
     * this hook. Reports "accepted by Messages.app" — for
     * "landed in chat.db / delivery state" use `onFromMe` via the
     * watcher. `onError` is not invoked on send failure: it covers
     * plugin hook failures, not SDK operation failures.
     */
    onAfterSend?: (ctx: AfterSendContext) => void | Promise<void>

    /** Parallel (observing). Fired for each incoming (non-from-me) message the watcher observes. */
    onIncomingMessage?: (ctx: MessageContext) => void | Promise<void>

    /**
     * Parallel (observing). Fired for each from-me message the watcher observes, regardless
     * of origin (this SDK, other Apple clients, Messages.app UI). This is the
     * authoritative source of "my send landed in chat.db" — `sdk.send()`
     * itself only reports AppleScript dispatch, not DB arrival.
     */
    onFromMe?: (ctx: MessageContext) => void | Promise<void>

    /** Sequential (observing). Receives errors from any other hook; own throws are logged, not re-dispatched. */
    onError?: (ctx: PluginErrorContext) => void | Promise<void>

    /** Sequential (observing). Called once per plugin on `sdk.close()`. Throws are routed to `onError`. */
    onDestroy?: () => void | Promise<void>
}

// -----------------------------------------------
// Plugin
// -----------------------------------------------

export interface Plugin extends PluginHooks {
    readonly name: string
    readonly version?: string
    readonly description?: string
    readonly order?: 'pre' | 'post'
}
