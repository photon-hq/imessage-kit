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

    /** Maximum concurrent send operations. @default 5 */
    readonly maxConcurrentSends?: number

    /** Enable verbose debug logging. @default false */
    readonly debug?: boolean

    /** Plugin list. */
    readonly plugins?: readonly Plugin[]
}
