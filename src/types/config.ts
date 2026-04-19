/**
 * Public SDK configuration types.
 */

import type { Plugin } from './plugin'

// -----------------------------------------------
// SDK Config
// -----------------------------------------------

export interface IMessageConfig {
    /** Path to the Messages SQLite database. @default ~/Library/Messages/chat.db */
    readonly databasePath?: string

    /** Maximum concurrent send operations. @default 10 */
    readonly maxConcurrentSends?: number

    /**
     * Ceiling (ms) for a single osascript dispatch. On timeout the
     * child is killed and the attempt counts as a failure; `retry`
     * decides whether to try again (3 attempts total by default), and
     * `sdk.send()` throws `SendError` only after attempts are
     * exhausted. Large attachments need headroom. Governs per-script
     * execution only — `sdk.send()` never waits for chat.db arrival.
     * @default 30_000
     */
    readonly sendTimeout?: number

    /** Enable verbose debug logging. @default false */
    readonly debug?: boolean

    /** Plugin list. */
    readonly plugins?: readonly Plugin[]
}
