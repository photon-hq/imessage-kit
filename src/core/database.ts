/**
 * Database Access Layer
 *
 * - Query message history (with multiple filter options)
 * - Read message attachment information
 * - Support all message types (iMessage, SMS, RCS)
 * - Support both Bun and Node.js runtimes
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { NSAttributedString, Unarchiver } from 'node-typedstream'
import type {
    Attachment,
    ChatSummary,
    Message,
    MessageFilter,
    MessageQueryResult,
    ReactionType,
    ServiceType,
} from '../types/message'
import { DatabaseError } from './errors'

/** Safe type conversion helper functions */
const str = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v))
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
const bool = (v: unknown): boolean => Boolean(v)

/**
 * Runtime detection and database adapter
 * Automatically uses bun:sqlite for Bun runtime, better-sqlite3 for Node.js
 */
type DatabaseAdapter = any

let Database: new (path: string, options?: { readonly?: boolean }) => DatabaseAdapter

async function initDatabase() {
    if (Database) return

    // Detect runtime
    if (typeof Bun !== 'undefined') {
        // Bun runtime
        const bunSqlite = await import('bun:sqlite')
        Database = bunSqlite.Database
    } else {
        // Node.js runtime
        try {
            const BetterSqlite3 = await import('better-sqlite3')
            // better-sqlite3 uses default export
            Database = BetterSqlite3.default || BetterSqlite3
        } catch (_error) {
            throw DatabaseError(
                'better-sqlite3 is required for Node.js runtime. Install it with: npm install better-sqlite3'
            )
        }
    }
}

/**
 * Read-only access to macOS Messages app SQLite database
 */
export class IMessageDatabase {
    /** SQLite database instance */
    private db: DatabaseAdapter
    /** macOS epoch time (timestamp of 2001-01-01) */
    private readonly MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()
    /** Initialization promise */
    private initPromise: Promise<void>

    /**
     * Open iMessage database
     * @param path Database file path
     * @throws DatabaseError When database fails to open
     */
    constructor(path: string) {
        this.initPromise = this.init(path)
    }

    /**
     * Initialize database (async)
     */
    private async init(path: string): Promise<void> {
        try {
            await initDatabase()
            this.db = new Database(path, { readonly: true })
        } catch (error) {
            throw DatabaseError(
                `Failed to open database at ${path}: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    /**
     * Ensure database is initialized before any operation
     */
    private async ensureInit(): Promise<void> {
        await this.initPromise
    }

    /**
     * Query messages (with multiple filter options)
     *
     * @param filter Filter conditions (optional)
     * @returns Message query result (includes message list and statistics)
     * @throws DatabaseError When query fails
     *
     * @example Query all unread messages
     * ```ts
     * const result = await db.getMessages({ unreadOnly: true })
     * ```
     *
     * @example Query messages from specific sender
     * ```ts
     * const result = await db.getMessages({
     *   sender: '+1234567890',
     *   limit: 20
     * })
     * ```
     *
     * @example Query recent messages with attachments
     * ```ts
     * const result = await db.getMessages({
     *   hasAttachments: true,
     *   since: new Date('2024-01-01'),
     *   limit: 10
     * })
     * ```
     */
    async getMessages(filter: MessageFilter = {}): Promise<MessageQueryResult> {
        await this.ensureInit()
        const {
            unreadOnly,
            excludeOwnMessages = true,
            sender,
            chatId,
            service,
            hasAttachments,
            excludeReactions,
            since,
            search,
            limit,
        } = filter

        let query = `
        SELECT 
            message.ROWID as id,
            message.guid,
            message.text,
            message.attributedBody,
            message.date,
            message.is_read,
            message.is_from_me,
            message.service,
            message.associated_message_type,
            message.associated_message_guid,
            handle.id as sender,
            handle.ROWID as sender_rowid,
            chat.chat_identifier as chat_id,
            chat.display_name as chat_name,
            chat.ROWID as chat_rowid,
            (SELECT COUNT(*) FROM chat_handle_join WHERE chat_handle_join.chat_id = chat.ROWID) > 1 as is_group_chat
        FROM message
        LEFT JOIN handle ON message.handle_id = handle.ROWID
        LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
        LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
        WHERE 1=1
        `

        const params: (string | number)[] = []

        if (unreadOnly) {
            query += ' AND message.is_read = 0'
        }

        if (excludeOwnMessages) {
            query += ' AND message.is_from_me = 0'
        }

        if (sender) {
            query += ' AND handle.id = ?'
            params.push(sender)
        }

        if (chatId) {
            query += ' AND chat.chat_identifier = ?'
            params.push(chatId)
        }

        if (service) {
            query += ' AND message.service = ?'
            params.push(service)
        }

        if (hasAttachments) {
            query += `
            AND EXISTS (
                SELECT 1 FROM message_attachment_join 
                WHERE message_attachment_join.message_id = message.ROWID
            )
            `
        }

        if (excludeReactions) {
            query += ' AND (message.associated_message_type IS NULL OR message.associated_message_type = 0)'
        }

        if (since) {
            /** Convert to macOS timestamp (nanoseconds since 2001-01-01) */
            const macTimestampNs = (since.getTime() - this.MAC_EPOCH) * 1000000
            query += ' AND message.date >= ?'
            params.push(macTimestampNs)
        }

        if (search) {
            query += ' AND (message.text LIKE ? OR message.attributedBody LIKE ?)'
            params.push(`%${search}%`, `%${search}%`)
        }

        query += ' ORDER BY message.date DESC'

        if (limit) {
            query += ' LIMIT ?'
            params.push(limit)
        }

        try {
            const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>
            const messages = await Promise.all(rows.map((row) => this.rowToMessage(row)))

            return {
                messages,
                total: messages.length,
                unreadCount: messages.filter((m) => !m.isRead).length,
            }
        } catch (error) {
            throw DatabaseError(`Failed to query messages: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Get unread messages grouped by sender
     *
     * @returns Object with grouped messages and total count
     *
     * @example
     * ```ts
     * const { grouped, total } = await db.getUnreadMessages()
     * for (const [sender, messages] of grouped) {
     *   console.log(`${sender}: ${messages.length} unread messages`)
     * }
     * console.log(`Total: ${total}`)
     * ```
     */
    async getUnreadMessages(): Promise<{ grouped: Map<string, Message[]>; total: number }> {
        const { messages, total } = await this.getMessages({ unreadOnly: true })
        const grouped = new Map<string, Message[]>()

        for (const msg of messages) {
            const existing = grouped.get(msg.sender)
            if (existing) {
                existing.push(msg)
            } else {
                grouped.set(msg.sender, [msg])
            }
        }

        return { grouped, total }
    }

    /**
     * List chats with filtering and sorting options
     *
     * @param options Filter and sort options
     * @returns Array of chat summaries with unread counts
     *
     * @example
     * ```ts
     * // Get recent group chats with unread messages
     * const chats = await db.listChats({
     *   type: 'group',
     *   hasUnread: true,
     *   limit: 20
     * })
     * ```
     */
    async listChats(options: import('../types/message').ListChatsOptions = {}): Promise<ChatSummary[]> {
        await this.ensureInit()
        const { limit, type = 'all', hasUnread, sortBy = 'recent', search } = options

        let query = `
        SELECT 
            chat.chat_identifier AS chat_identifier,
            chat.guid AS chat_guid,
            chat.service_name AS service_name,
            chat.display_name AS display_name,
            (
              SELECT MAX(message.date) 
              FROM chat_message_join cmj 
              INNER JOIN message ON message.ROWID = cmj.message_id 
              WHERE cmj.chat_id = chat.ROWID
            ) AS last_date,
            (SELECT COUNT(*) FROM chat_handle_join WHERE chat_handle_join.chat_id = chat.ROWID) > 1 AS is_group_chat,
            (
              SELECT COUNT(*) 
              FROM chat_message_join cmj 
              INNER JOIN message ON message.ROWID = cmj.message_id 
              WHERE cmj.chat_id = chat.ROWID 
                AND message.is_read = 0 
                AND message.is_from_me = 0
            ) AS unread_count
        FROM chat
        WHERE 1=1
        `

        const params: (string | number)[] = []

        // Filter by type
        if (type === 'group') {
            query += ' AND (SELECT COUNT(*) FROM chat_handle_join WHERE chat_handle_join.chat_id = chat.ROWID) > 1'
        } else if (type === 'dm') {
            query += ' AND (SELECT COUNT(*) FROM chat_handle_join WHERE chat_handle_join.chat_id = chat.ROWID) <= 1'
        }

        // Filter by unread
        if (hasUnread) {
            query +=
                ' AND (SELECT COUNT(*) FROM chat_message_join cmj INNER JOIN message ON message.ROWID = cmj.message_id WHERE cmj.chat_id = chat.ROWID AND message.is_read = 0 AND message.is_from_me = 0) > 0'
        }

        // Search by display name
        if (search) {
            query += ' AND chat.display_name LIKE ?'
            params.push(`%${search}%`)
        }

        // Sort order
        if (sortBy === 'recent') {
            query += ' ORDER BY (last_date IS NULL), last_date DESC'
        } else if (sortBy === 'name') {
            query += ' ORDER BY (chat.display_name IS NULL), chat.display_name ASC'
        }

        // Limit
        if (limit && limit > 0) {
            query += ' LIMIT ?'
            params.push(limit)
        }

        try {
            const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>
            return rows.map((row) => {
                const isGroup = bool(row.is_group_chat)
                const guid = str(row.chat_guid)
                const identifierRaw = row.chat_identifier == null ? '' : str(row.chat_identifier)
                const service = row.service_name == null ? '' : str(row.service_name)

                // chatId rules:
                // - Group chats: use chat.guid (stable routing key)
                // - Direct chats (DM): prefer database chat_identifier if it already contains a semicolon; otherwise prefix with service_name
                let chatId: string
                if (isGroup || !identifierRaw) {
                    chatId = guid
                } else if (identifierRaw.includes(';')) {
                    chatId = identifierRaw
                } else if (service) {
                    chatId = `${service};${identifierRaw}`
                } else {
                    // In rare cases service_name is missing, default to iMessage prefix for consistency
                    chatId = `iMessage;${identifierRaw}`
                }

                const displayName = row.display_name == null ? null : str(row.display_name)
                const lastDateRaw = row.last_date
                const lastMessageAt = typeof lastDateRaw === 'number' ? this.convertMacTimestamp(lastDateRaw) : null
                const unreadCount = typeof row.unread_count === 'number' ? row.unread_count : 0

                return {
                    chatId,
                    displayName,
                    lastMessageAt,
                    isGroup,
                    unreadCount,
                }
            })
        } catch (error) {
            throw DatabaseError(`Failed to list chats: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * Get all attachments for specified message
     * @param messageId Message ID
     * @returns Array of attachments, returns empty array if no attachments
     */
    private async getAttachments(messageId: string): Promise<Attachment[]> {
        await this.ensureInit()
        const query = `
        SELECT 
            attachment.ROWID as id,
            attachment.filename,
            attachment.mime_type,
            attachment.total_bytes as size,
            attachment.created_date as created_date
        FROM attachment
        INNER JOIN message_attachment_join ON attachment.ROWID = message_attachment_join.attachment_id
        WHERE message_attachment_join.message_id = ?
        `

        try {
            const rows = this.db.prepare(query).all(messageId) as Array<Record<string, unknown>>

            return rows.map((row) => {
                const rawPath = str(row.filename)
                const mimeType = str(row.mime_type, 'application/octet-stream')

                /** Expand path: ~ to home directory, relative paths joined to Messages attachments directory */
                let fullPath: string
                if (rawPath.startsWith('~')) {
                    fullPath = rawPath.replace(/^~/, homedir())
                } else if (rawPath && !rawPath.startsWith('/')) {
                    fullPath = join(homedir(), 'Library/Messages/Attachments', rawPath)
                } else {
                    fullPath = rawPath
                }

                return {
                    id: str(row.id),
                    filename: rawPath.split('/').pop() || 'unknown',
                    mimeType,
                    path: fullPath,
                    size: num(row.size, 0),
                    isImage: mimeType.startsWith('image/'),
                    createdAt: this.convertMacTimestamp(row.created_date),
                }
            })
        } catch {
            return []
        }
    }

    /**
     * Extract text from attributedBody using node-typedstream
     * Uses proper NSKeyedArchiver deserialization for accurate text extraction
     * @param attributedBody Binary plist data (NSKeyedArchiver format)
     * @returns Extracted text or null if extraction fails
     */
    private extractTextFromAttributedBody(attributedBody: unknown): string | null {
        if (!attributedBody) return null

        try {
            let buffer: Buffer
            if (Buffer.isBuffer(attributedBody)) {
                buffer = attributedBody
            } else if (attributedBody instanceof Uint8Array) {
                buffer = Buffer.from(attributedBody)
            } else {
                return null
            }

            if (buffer.length === 0) return null

            // Use node-typedstream to properly decode NSKeyedArchiver format
            const decoded = Unarchiver.open(buffer, Unarchiver.BinaryDecoding.decodable).decodeAll()

            if (!decoded) return null

            const items = Array.isArray(decoded) ? decoded : [decoded]

            // Extract text from NSAttributedString objects
            for (const item of items) {
                // Direct NSAttributedString
                if (item instanceof NSAttributedString && item.string) {
                    return item.string
                }

                // Nested in values array (common structure)
                if (item?.values && Array.isArray(item.values)) {
                    for (const val of item.values) {
                        if (val instanceof NSAttributedString && val.string) {
                            return val.string
                        }
                    }
                }
            }
        } catch {
            // Silently fail - attributedBody format may vary
        }

        return null
    }

    /**
     * Convert database query result to Message object
     * @param row Raw row data from database query
     * @returns Formatted Message object
     */
    private async rowToMessage(row: Record<string, unknown>): Promise<Message> {
        // Priority: attributedBody > text field
        // The text field may be truncated or incomplete in some cases,
        // while attributedBody contains the complete message text
        let messageText: string | null = null

        // Try to extract from attributedBody first (more reliable)
        if (row.attributedBody) {
            messageText = this.extractTextFromAttributedBody(row.attributedBody)
        }

        // Fall back to text field if attributedBody extraction failed
        if (!messageText && row.text) {
            messageText = str(row.text)
        }

        // Parse reaction information
        const reaction = this.mapReactionType(row.associated_message_type)

        return {
            id: str(row.id),
            guid: str(row.guid),
            text: messageText,
            sender: str(row.sender, 'Unknown'),
            senderName: null,
            chatId: str(row.chat_id),
            isGroupChat: bool(row.is_group_chat),
            service: this.mapService(row.service),
            isRead: bool(row.is_read),
            isFromMe: bool(row.is_from_me),
            isReaction: reaction.isReaction,
            reactionType: reaction.reactionType,
            isReactionRemoval: reaction.isReactionRemoval,
            associatedMessageGuid: row.associated_message_guid ? str(row.associated_message_guid) : null,
            attachments: await this.getAttachments(str(row.id)),
            date: this.convertMacTimestamp(row.date),
        }
    }

    /**
     * Map service type string from database
     * @param service Service identifier from database
     * @returns Standardized service type
     */
    private mapService(service: unknown): ServiceType {
        if (!service || typeof service !== 'string') return 'iMessage'
        const lower = service.toLowerCase()
        if (lower.includes('sms')) return 'SMS'
        if (lower.includes('rcs')) return 'RCS'
        return 'iMessage'
    }

    /**
     * Map associated_message_type to reaction information
     * @param type Raw associated_message_type from database
     * @returns Reaction details (isReaction, reactionType, isReactionRemoval)
     */
    private mapReactionType(type: unknown): {
        isReaction: boolean
        reactionType: ReactionType | null
        isReactionRemoval: boolean
    } {
        const typeNum = typeof type === 'number' && Number.isFinite(type) ? type : 0

        // 0 or null (or non-numeric) means not a reaction
        if (!typeNum) {
            return { isReaction: false, reactionType: null, isReactionRemoval: false }
        }

        // Only 2000-2005 (add) and 3000-3005 (remove) are valid reaction types
        const isInAddRange = typeNum >= 2000 && typeNum <= 2005
        const isInRemoveRange = typeNum >= 3000 && typeNum <= 3005

        if (!isInAddRange && !isInRemoveRange) {
            return { isReaction: false, reactionType: null, isReactionRemoval: false }
        }

        const isRemoval = isInRemoveRange
        const baseType = isRemoval ? typeNum - 1000 : typeNum

        const typeMap: Record<number, ReactionType> = {
            2000: 'love',
            2001: 'like',
            2002: 'dislike',
            2003: 'laugh',
            2004: 'emphasize',
            2005: 'question',
        }

        return {
            isReaction: true,
            reactionType: typeMap[baseType] ?? null,
            isReactionRemoval: isRemoval,
        }
    }

    /**
     * Convert macOS timestamp to JavaScript Date object
     *
     * macOS epoch starts at 2001-01-01, unit is nanoseconds
     * @param timestamp macOS timestamp
     * @returns JavaScript Date object
     */
    private convertMacTimestamp(timestamp: unknown): Date {
        if (!timestamp || typeof timestamp !== 'number') return new Date()
        return new Date(this.MAC_EPOCH + timestamp / 1000000)
    }

    /**
     * Close database connection
     */
    async close() {
        await this.ensureInit()
        this.db.close()
    }
}
