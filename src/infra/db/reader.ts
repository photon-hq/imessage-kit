/**
 * Messages database reader.
 *
 * Extends SqliteClient with a query adapter (MessagesDbQueries), executes
 * the adapter's SQL, and maps rows to domain models. Currently wired to
 * macos26Queries; swap the assignment in the constructor to route a future
 * schema (e.g. macOS 27).
 *
 * Organization: the public class is a thin delegate façade — all work lives
 * in module-level free functions that take `(exec, queries, ...)` as
 * explicit dependencies. Keeps internal operations pure and testable
 * without reader instance state.
 */

import type { Attachment } from '../../domain/attachment'
import type { Chat } from '../../domain/chat'
import { DatabaseError, toErrorMessage } from '../../domain/errors'
import type { Message } from '../../domain/message'
import type { ChatQuery, MessageQuery } from '../../types/query'
import { delay } from '../../utils/async'
import type { MessageQueryInput, MessagesDbQueries, QueryExecutor, SqlQuery } from './contract'
import { macos26Queries } from './macos26'
import { parseNumber, patchMessageChatInfo, requireNumber, rowToAttachment, rowToChat, rowToMessage } from './mapper'
import { SqliteClient } from './sqlite-adapter'

// -----------------------------------------------
// Constants
// -----------------------------------------------

const ATTACHMENT_QUERY_CHUNK = 500
const SEARCH_PAGE_SIZE = 200

/**
 * Delay between backfill attempts. Absorbs the Messages.app two-write gap.
 * Heuristic — combined with CHAT_BACKFILL_MAX_RETRIES the total budget
 * before surrender is ~400ms.
 */
const CHAT_BACKFILL_RETRY_DELAY_MS = 200

/** Retries after the initial attempt. */
const CHAT_BACKFILL_MAX_RETRIES = 2

// -----------------------------------------------
// MessagesDatabaseReader
// -----------------------------------------------

/** High-level Messages database reader: runs the query adapter's SQL and maps rows to domain models. */
export class MessagesDatabaseReader extends SqliteClient {
    private readonly queries: MessagesDbQueries
    private readonly exec: QueryExecutor

    constructor(path: string) {
        super(path, true)
        this.exec = (sql, params) => this.all(sql, params ?? [])
        this.queries = macos26Queries
    }

    /** Get the current maximum message ROWID. */
    async getMaxRowId(): Promise<number> {
        return queryMaxRowId(this.exec, this.queries)
    }

    /** Query messages with optional filters. */
    async getMessages(query: MessageQuery = {}): Promise<readonly Message[]> {
        return queryMessages(this.exec, this.queries, query)
    }

    /** Query messages newer than the given ROWID, ordered ascending. */
    async getMessagesSinceRowId(sinceRowId: number, query: MessageQuery = {}): Promise<readonly Message[]> {
        const messages = queryMessages(this.exec, this.queries, {
            ...query,
            sinceRowId,
            orderByRowIdAsc: true,
        })
        return backfillMissingChatInfo(this.exec, this.queries, messages)
    }

    /** List chats with optional filters and sorting. */
    async listChats(query: ChatQuery = {}): Promise<readonly Chat[]> {
        return queryChats(this.exec, this.queries, query)
    }
}

// -----------------------------------------------
// Message query
// -----------------------------------------------

function queryMessages(exec: QueryExecutor, queries: MessagesDbQueries, input: MessageQueryInput): readonly Message[] {
    const { search } = input
    if (search) {
        return searchMessages(exec, queries, { ...input, search })
    }

    return executeMessageQuery(exec, queries, queries.buildMessageQuery(input))
}

function executeMessageQuery(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    sqlQuery: SqlQuery,
    includeAttachments = true
): readonly Message[] {
    let messages: readonly Message[]

    try {
        const rows = exec(sqlQuery.sql, sqlQuery.params)
        messages = rows.map((row) => rowToMessage(row, []))
    } catch (error) {
        throw DatabaseError(`Failed to query messages: ${toErrorMessage(error)}`, error)
    }

    if (!includeAttachments) {
        return messages
    }

    return mergeAttachments(exec, queries, messages)
}

/**
 * Application-layer search over decoded text.
 *
 * SQL LIKE on `message.text` would drop rows whose body lives only in the
 * `attributedBody` BLOB (the norm on macOS 26). We scan in pages, decode
 * each row, and match against the final text.
 */
function searchMessages(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    filter: MessageQueryInput & { readonly search: string }
): readonly Message[] {
    const { search: rawSearch, ...sqlFilter } = filter
    const search = rawSearch.toLowerCase()

    const requestedOffset = filter.offset ?? 0
    const requestedLimit = filter.limit ?? Number.POSITIVE_INFINITY
    // offset applies to matches, not scanned rows — accumulate the full
    // (offset + limit) window before slicing below.
    const requiredMatches = requestedOffset + requestedLimit
    // If the caller's limit exceeds the default page size, page at that
    // size to cut the number of SQL round-trips.
    const pageSize = Math.max(SEARCH_PAGE_SIZE, filter.limit ?? 0)
    const matches: Message[] = []
    let scanOffset = 0

    while (matches.length < requiredMatches) {
        const page = executeMessageQuery(
            exec,
            queries,
            queries.buildMessageQuery({ ...sqlFilter, limit: pageSize, offset: scanOffset }),
            false
        )

        if (page.length === 0) break

        for (const message of page) {
            if (message.text?.toLowerCase().includes(search) === true) {
                matches.push(message)
            }
        }

        if (page.length < pageSize) break

        scanOffset += pageSize
    }

    // Apply the requested offset/limit window to matches (not scanned rows).
    const end = Number.isFinite(requestedLimit) ? requestedOffset + requestedLimit : undefined
    return mergeAttachments(exec, queries, matches.slice(requestedOffset, end))
}

// -----------------------------------------------
// Chat-info backfill (WAL race mitigation)
// -----------------------------------------------

/**
 * Messages.app writes a new message row and its `chat_message_join` row as
 * two separate SQLite writes. A WAL-triggered watcher can observe the first
 * write before the second, so the LEFT JOIN in `buildMessageQuery` comes
 * back with `chat.*` all NULL — leaving `chatId === null` / `chatKind ===
 * 'unknown'` and silently routing the message away from `onGroupMessage` /
 * `onDirectMessage`.
 *
 * Mitigation: re-query chat metadata for any `chatId == null` row, with up
 * to `CHAT_BACKFILL_MAX_RETRIES` retries spaced by
 * `CHAT_BACKFILL_RETRY_DELAY_MS`. Skipped entirely when every row already
 * has a chat resolved (the common case). Rows still unjoined after the
 * budget are surfaced as-is — `chatId = null` is part of the public
 * contract (see llms.txt "Auto-Reply Bot").
 */
async function backfillMissingChatInfo(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    messages: readonly Message[]
): Promise<readonly Message[]> {
    const collectMissing = (list: readonly Message[]): number[] => {
        const ids: number[] = []
        for (const message of list) {
            if (message.chatId == null) ids.push(message.rowId)
        }
        return ids
    }

    let current = messages
    let missing = collectMissing(current)
    if (missing.length === 0) return current

    for (let attempt = 0; attempt <= CHAT_BACKFILL_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            await delay(CHAT_BACKFILL_RETRY_DELAY_MS)
        }
        current = runChatBackfillOnce(exec, queries, current, missing)
        missing = collectMissing(current)
        if (missing.length === 0) break
    }

    return current
}

function runChatBackfillOnce(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    messages: readonly Message[],
    missingIds: readonly number[]
): readonly Message[] {
    const query = queries.buildChatBackfillQuery(missingIds)
    const byRowId = new Map<number, Record<string, unknown>>()

    try {
        const rows = exec(query.sql, query.params)
        for (const row of rows) {
            const id = parseNumber(row.message_rowid)
            if (id != null) byRowId.set(id, row)
        }
    } catch (error) {
        throw DatabaseError(`Failed to backfill chat info: ${toErrorMessage(error)}`, error)
    }

    if (byRowId.size === 0) return messages

    return messages.map((message) => {
        if (message.chatId != null) return message
        const row = byRowId.get(message.rowId)
        return row ? patchMessageChatInfo(message, row) : message
    })
}

// -----------------------------------------------
// Chat queries
// -----------------------------------------------

function queryChats(exec: QueryExecutor, queries: MessagesDbQueries, input: ChatQuery): readonly Chat[] {
    const sqlQuery = queries.buildChatQuery({
        ...input,
        sortBy: input.sortBy ?? 'recent',
    })

    try {
        const rows = exec(sqlQuery.sql, sqlQuery.params)
        return rows.map((row) => rowToChat(row))
    } catch (error) {
        throw DatabaseError(`Failed to list chats: ${toErrorMessage(error)}`, error)
    }
}

// -----------------------------------------------
// Attachment loading
// -----------------------------------------------

function mergeAttachments(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    messages: readonly Message[]
): readonly Message[] {
    if (messages.length === 0) return messages

    const attachmentMap = batchGetAttachments(
        exec,
        queries,
        messages.map((message) => message.rowId)
    )

    return messages.map((message) => ({
        ...message,
        attachments: attachmentMap.get(message.rowId) ?? [],
    }))
}

function batchGetAttachments(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    messageIds: readonly number[]
): Map<number, Attachment[]> {
    const result = new Map<number, Attachment[]>()

    if (messageIds.length === 0) return result

    for (let i = 0; i < messageIds.length; i += ATTACHMENT_QUERY_CHUNK) {
        const chunk = messageIds.slice(i, i + ATTACHMENT_QUERY_CHUNK)
        const query = queries.buildAttachmentQuery(chunk)

        try {
            const rows = exec(query.sql, query.params)

            for (const row of rows) {
                const messageId = requireNumber(row.msg_id, 'attachment.msg_id')
                const attachment = rowToAttachment(row)
                const existing = result.get(messageId)

                if (existing) {
                    existing.push(attachment)
                } else {
                    result.set(messageId, [attachment])
                }
            }
        } catch (error) {
            throw DatabaseError(`Failed to query attachments: ${toErrorMessage(error)}`, error)
        }
    }

    return result
}

// -----------------------------------------------
// Misc
// -----------------------------------------------

function queryMaxRowId(exec: QueryExecutor, queries: MessagesDbQueries): number {
    const { sql, params } = queries.buildMaxRowIdQuery()
    try {
        const rows = exec(sql, params)
        return parseNumber(rows[0]?.max_id) ?? 0
    } catch (error) {
        throw DatabaseError(`Failed to read max ROWID: ${toErrorMessage(error)}`, error)
    }
}
