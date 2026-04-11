/**
 * Messages database reader.
 *
 * Merges the query engine and store into a single class that extends
 * SqliteClient. Detects the schema version, builds queries via the
 * appropriate schema adapter, executes them, and maps rows to domain models.
 */

import type { Attachment } from '../../domain/attachment'
import type { Chat } from '../../domain/chat'
import { DatabaseError, toErrorMessage } from '../../domain/errors'
import type { Message } from '../../domain/message'
import type { ChatQuery, MessageQuery } from '../../types/query'
import type { MessageQueryInput, MessagesDbQueries, QueryExecutor, SchemaId, SqlQuery } from './contract'
import { macos26Queries } from './macos26'
import { parseNumber, requireNumber, rowToAttachment, rowToChat, rowToMessage } from './mapper'
import { SqliteClient } from './sqlite-adapter'

// -----------------------------------------------
// Constants
// -----------------------------------------------

const ATTACHMENT_QUERY_CHUNK = 500
const SEARCH_PAGE_SIZE = 200

// -----------------------------------------------
// Schema resolution
// -----------------------------------------------

const QUERIES_BY_SCHEMA: Record<SchemaId, MessagesDbQueries> = {
    macos26: macos26Queries,
}

/**
 * Detect the schema version from the message table columns.
 *
 * Currently always returns 'macos26'. Future macOS 27 support will
 * add a column check here (e.g. a new column unique to macOS 27).
 */
export function resolveSchemaId(columns: readonly string[]): SchemaId {
    void columns
    return 'macos26'
}

// -----------------------------------------------
// Internal query execution
// -----------------------------------------------

function queryMaxRowId(exec: QueryExecutor): number {
    try {
        const rows = exec('SELECT MAX(ROWID) as max_id FROM message')
        return parseNumber(rows[0]?.max_id) ?? 0
    } catch (error) {
        throw DatabaseError(`Failed to read max ROWID: ${toErrorMessage(error)}`)
    }
}

interface ExecuteOptions {
    readonly includeAttachments?: boolean
}

function executeMessageQuery(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    sqlQuery: SqlQuery,
    options: ExecuteOptions = {}
): readonly Message[] {
    const includeAttachments = options.includeAttachments ?? true

    let messages: readonly Message[]

    try {
        const rows = exec(sqlQuery.sql, sqlQuery.params)
        messages = rows.map((row) => rowToMessage(row, []))
    } catch (error) {
        throw DatabaseError(`Failed to query messages: ${toErrorMessage(error)}`)
    }

    if (!includeAttachments) {
        return messages
    }

    return mergeAttachments(exec, queries, messages)
}

function queryMessages(exec: QueryExecutor, queries: MessagesDbQueries, input: MessageQueryInput): readonly Message[] {
    if (input.search) {
        return searchMessages(exec, queries, input)
    }

    return executeMessageQuery(exec, queries, queries.buildMessageQuery(input))
}

// -----------------------------------------------
// Application-level text search
// -----------------------------------------------

function searchMessages(
    exec: QueryExecutor,
    queries: MessagesDbQueries,
    filter: MessageQueryInput
): readonly Message[] {
    const search = filter.search?.toLowerCase()

    if (!search) {
        return executeMessageQuery(exec, queries, queries.buildMessageQuery(filter))
    }

    const requestedOffset = filter.offset ?? 0
    const requestedLimit = filter.limit ?? Number.POSITIVE_INFINITY
    const requiredMatches = requestedOffset + requestedLimit
    const pageSize = Math.max(SEARCH_PAGE_SIZE, filter.limit ?? 0)
    const matches: Message[] = []
    let scanOffset = 0

    while (matches.length < requiredMatches) {
        const page = executeMessageQuery(
            exec,
            queries,
            queries.buildMessageQuery({
                ...filter,
                limit: pageSize,
                offset: scanOffset,
            }),
            { includeAttachments: false }
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

    const end = Number.isFinite(requestedLimit) ? requestedOffset + requestedLimit : undefined
    return mergeAttachments(exec, queries, matches.slice(requestedOffset, end))
}

// -----------------------------------------------
// Chat queries
// -----------------------------------------------

function queryChats(exec: QueryExecutor, queries: MessagesDbQueries, input: ChatQuery): readonly Chat[] {
    const sqlQuery = queries.buildChatQuery({
        ...input,
        kind: input.kind ?? 'all',
        sortBy: input.sortBy ?? 'recent',
    })

    try {
        const rows = exec(sqlQuery.sql, sqlQuery.params)
        return rows.map((row) => rowToChat(row))
    } catch (error) {
        throw DatabaseError(`Failed to list chats: ${toErrorMessage(error)}`)
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
            throw DatabaseError(`Failed to query attachments: ${toErrorMessage(error)}`)
        }
    }

    return result
}

// -----------------------------------------------
// MessagesDatabaseReader
// -----------------------------------------------

/** High-level Messages database reader with schema detection and query orchestration. */
export class MessagesDatabaseReader extends SqliteClient {
    private readonly queries: MessagesDbQueries
    private readonly exec: QueryExecutor

    constructor(path: string) {
        super(path, true)
        this.exec = (sql, params) => this.all(sql, params ?? [])
        this.queries = QUERIES_BY_SCHEMA[this.detectSchemaId()]
    }

    /** Get the current maximum message ROWID. */
    async getMaxRowId(): Promise<number> {
        return queryMaxRowId(this.exec)
    }

    /** Query messages with optional filters. */
    async getMessages(query: MessageQuery = {}): Promise<readonly Message[]> {
        return queryMessages(this.exec, this.queries, query)
    }

    /** Query messages newer than the given ROWID, ordered ascending. */
    async getMessagesSinceRowId(sinceRowId: number, query: MessageQuery = {}): Promise<readonly Message[]> {
        return queryMessages(this.exec, this.queries, {
            ...query,
            sinceRowId,
            orderByRowIdAsc: true,
        })
    }

    /** List chats with optional filters and sorting. */
    async listChats(query: ChatQuery = {}): Promise<readonly Chat[]> {
        return queryChats(this.exec, this.queries, query)
    }

    /** Search messages by text content (application-level filtering). */
    async searchMessages(query: MessageQuery): Promise<readonly Message[]> {
        return queryMessages(this.exec, this.queries, query)
    }

    private detectSchemaId(): SchemaId {
        const rows = this.all("PRAGMA table_info('message')")
        const columns = rows
            .map((row) => row.name)
            .filter((name): name is string => typeof name === 'string' && name !== '')
        return resolveSchemaId(columns)
    }
}
