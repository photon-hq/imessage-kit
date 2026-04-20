/**
 * Port between `reader.ts` and schema-specific query builders.
 *
 * Defines the SQL execution primitives, the `MessagesDbQueries` adapter
 * contract (implemented per macOS version — currently `macos26.ts`), the
 * reader→adapter input shapes, and the cross-version chat-id match helper.
 */

import { ChatId } from '../../domain/chat-id'
import type { ChatQuery, MessageQuery } from '../../types/query'

// -----------------------------------------------
// SQL primitives
// -----------------------------------------------

export type QueryParam = string | number

/** A parameterised SQL query ready for execution. */
export interface SqlQuery {
    readonly sql: string
    readonly params: readonly QueryParam[]
}

/** Function that executes a SQL query and returns raw rows. */
export type QueryExecutor = (sql: string, params?: readonly QueryParam[]) => Array<Record<string, unknown>>

// -----------------------------------------------
// Query input types
// -----------------------------------------------

// Input forms feed the reader→adapter boundary. They extend the public
// query DTOs in two different directions:
//   - add internal cursor fields the public API must not expose (MessageQueryInput)
//   - narrow optional fields to required once the reader has applied defaults,
//     so the builder can skip `undefined` handling (ChatQueryInput)

/** `MessageQuery` plus internal cursor fields used by the watcher. */
export interface MessageQueryInput extends MessageQuery {
    readonly sinceRowId?: number
    readonly orderByRowIdAsc?: boolean
}

/**
 * `ChatQuery` with `sortBy` defaulted by the reader so the builder can skip
 * its `undefined` check. `kind` stays optional — `undefined` means "both
 * kinds" and the builder simply omits the filter, with no pseudo-`'all'`
 * sentinel in the type.
 */
export interface ChatQueryInput extends ChatQuery {
    readonly sortBy: NonNullable<ChatQuery['sortBy']>
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
    readonly buildMessageQuery: (input: MessageQueryInput) => SqlQuery
    readonly buildChatQuery: (input: ChatQueryInput) => SqlQuery
    readonly buildAttachmentQuery: (messageIds: readonly number[]) => SqlQuery
    /**
     * Look up chat metadata (guid / identifier / style) for a set of
     * message ROWIDs. Used to backfill chat info when `buildMessageQuery`'s
     * LEFT JOIN observed the message row before its `chat_message_join` row
     * had been committed (WAL race between the two INSERTs written by
     * Messages.app).
     *
     * Returned rows: `{ message_rowid, chat_id, chat_guid, chat_style }`.
     * A row is absent (or has nulls) if the join still has not settled.
     */
    readonly buildChatBackfillQuery: (messageIds: readonly number[]) => SqlQuery
    /** Return `MAX(ROWID)` from the message table. Returned row: `{ max_id }`. */
    readonly buildMaxRowIdQuery: () => SqlQuery
}

// -----------------------------------------------
// Chat-id SQL matching
// -----------------------------------------------

/**
 * Build a parameterised SQL clause that matches a user-provided chat id
 * against database identifier and guid columns.
 *
 * Both columns are matched against the raw input and — when the input
 * carries a service prefix — the stripped core identifier, so
 * `iMessage;-;user@example.com` finds rows stored as `user@example.com`
 * and `iMessage;+;chatX` finds rows whose guid is `any;+;chatX`.
 *
 * Return type uses `string[]` instead of `SqlQuery` on purpose: this
 * helper only ever emits string parameters, and the narrower type lets
 * callers spread into a wider `QueryParam[]` without losing precision.
 */
export function buildChatIdMatchSql(
    userInput: string,
    columns: {
        readonly identifier: string
        readonly guid: string
    }
): { readonly sql: string; readonly params: string[] } {
    const core = ChatId.fromUserInput(userInput).coreIdentifier
    const values = core === userInput ? [userInput] : [userInput, core]
    const placeholders = values.map(() => '?').join(', ')

    return {
        sql: `(${columns.identifier} IN (${placeholders}) OR ${columns.guid} IN (${placeholders}))`,
        params: [...values, ...values],
    }
}
