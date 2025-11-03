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
import type { Attachment, Message, MessageFilter, MessageQueryResult, ServiceType } from '../types/message'
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
        } catch (error) {
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
        const { unreadOnly, excludeOwnMessages = true, sender, chatId, service, hasAttachments, since, limit } = filter

        let query = `
        SELECT 
            message.ROWID as id,
            message.guid,
            message.text,
            message.date,
            message.is_read,
            message.is_from_me,
            message.service,
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

        if (since) {
            /** Convert to macOS timestamp (nanoseconds since 2001-01-01) */
            const macTimestampNs = (since.getTime() - this.MAC_EPOCH) * 1000000
            query += ' AND message.date >= ?'
            params.push(macTimestampNs)
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
     * @returns Map where key is sender identifier and value is array of messages from that sender
     *
     * @example
     * ```ts
     * const grouped = await db.getUnreadMessages()
     * for (const [sender, messages] of grouped) {
     *   console.log(`${sender}: ${messages.length} unread messages`)
     * }
     * ```
     */
    async getUnreadMessages(): Promise<Map<string, Message[]>> {
        const { messages } = await this.getMessages({ unreadOnly: true })
        const grouped = new Map<string, Message[]>()

        for (const msg of messages) {
            const existing = grouped.get(msg.sender)
            if (existing) {
                existing.push(msg)
            } else {
                grouped.set(msg.sender, [msg])
            }
        }

        return grouped
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
     * Convert database query result to Message object
     * @param row Raw row data from database query
     * @returns Formatted Message object
     */
    private async rowToMessage(row: Record<string, unknown>): Promise<Message> {
        return {
            id: str(row.id),
            guid: str(row.guid),
            text: row.text ? str(row.text) : null,
            sender: str(row.sender, 'Unknown'),
            senderName: null,
            chatId: str(row.chat_id),
            isGroupChat: bool(row.is_group_chat),
            service: this.mapService(row.service),
            isRead: bool(row.is_read),
            isFromMe: bool(row.is_from_me),
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
