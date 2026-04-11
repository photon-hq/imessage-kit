/**
 * Query contract for the Messages database.
 *
 * Defines the schema adapter interface, shared query types,
 * and the chat-id SQL match helper consumed by version-specific builders.
 */

import { ChatId } from '../../domain/chat-id'
import type { ChatQuery, MessageQuery } from '../../types/query'

// -----------------------------------------------
// Schema identification
// -----------------------------------------------

/** Supported macOS schema version identifiers. */
export type SchemaId = 'macos26'

// -----------------------------------------------
// Query types
// -----------------------------------------------

/** A parameterised SQL query ready for execution. */
export interface SqlQuery {
    readonly sql: string
    readonly params: readonly QueryParam[]
}

export type QueryParam = string | number

/** Function that executes a SQL query and returns raw rows. */
export type QueryExecutor = (sql: string, params?: readonly unknown[]) => Array<Record<string, unknown>>

// -----------------------------------------------
// Query input types
// -----------------------------------------------

/** Pre-processed message query with cursor support. */
export interface MessageQueryInput extends MessageQuery {
    readonly sinceRowId?: number
    readonly orderByRowIdAsc?: boolean
}

/** Pre-processed chat query with required defaults. */
export interface ChatQueryInput extends ChatQuery {
    readonly kind: 'all' | 'group' | 'dm'
    readonly sortBy: 'recent' | 'name'
}

// -----------------------------------------------
// Schema adapter interface
// -----------------------------------------------

/**
 * Query builder contract implemented by each macOS schema version.
 *
 * Returns raw SQL + params; the reader executes them and the mapper
 * transforms rows into domain models.
 */
export interface MessagesDbQueries {
    readonly schemaId: SchemaId
    readonly buildMessageQuery: (filter: MessageQueryInput) => SqlQuery
    readonly buildChatQuery: (query: ChatQueryInput) => SqlQuery
    readonly buildAttachmentQuery: (messageIds: readonly number[]) => SqlQuery
}

// -----------------------------------------------
// Chat-id SQL matching
// -----------------------------------------------

/**
 * Build a parameterised SQL clause that matches a user-provided chat id
 * against database identifier and guid columns.
 *
 * When the input contains a service prefix, also matches the stripped
 * core identifier so `iMessage;-;user@example.com` finds rows stored
 * as `user@example.com`.
 */
export function buildChatIdMatchSql(
    userInput: string,
    columns: {
        readonly identifier: string
        readonly guid: string
    }
): { readonly sql: string; readonly params: string[] } {
    const core = ChatId.fromUserInput(userInput).coreIdentifier

    if (core === userInput) {
        return {
            sql: `(${columns.identifier} = ? OR ${columns.guid} = ?)`,
            params: [userInput, userInput],
        }
    }

    return {
        sql: `(${columns.identifier} = ? OR ${columns.guid} = ? OR ${columns.identifier} = ?)`,
        params: [userInput, userInput, core],
    }
}
