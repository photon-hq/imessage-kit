/**
 * Database Access Layer
 *
 * - Query message history (with multiple filter options)
 * - Read message attachment information
 * - Support all message types (iMessage, SMS, RCS)
 * - Support both Bun and Node.js runtimes
 */

import { exec } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Attachment, ChatSummary, Message, MessageFilter, MessageQueryResult, ServiceType } from '../types/message'
import { DatabaseError } from './errors'

const execAsync = promisify(exec)

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
        const { unreadOnly, excludeOwnMessages = true, sender, chatId, service, hasAttachments, since, limit } = filter

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
     * List chats with basic information
     *
     * Returns chat identifier, display name, last message time, and group flag.
     */
    async listChats(limit?: number): Promise<ChatSummary[]> {
        await this.ensureInit()
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
            (SELECT COUNT(*) FROM chat_handle_join WHERE chat_handle_join.chat_id = chat.ROWID) > 1 AS is_group_chat
        FROM chat
        ORDER BY (last_date IS NULL), last_date DESC
        `

        const params: (string | number)[] = []
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

                return {
                    chatId,
                    displayName,
                    lastMessageAt,
                    isGroup,
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
     * Decode XML entities in a string
     * @param text Text with XML entities
     * @returns Decoded text
     */
    private decodeXmlEntities(text: string): string {
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
    }

    /**
     * Extract text from attributedBody (binary plist format)
     * @param attributedBody Binary plist data
     * @returns Extracted text or null if extraction fails
     */
    private async extractTextFromAttributedBody(attributedBody: unknown): Promise<string | null> {
        if (!attributedBody) return null

        try {
            // attributedBody is typically a Buffer in Node.js or Uint8Array in Bun
            let buffer: Buffer | Uint8Array
            if (Buffer.isBuffer(attributedBody)) {
                buffer = attributedBody
            } else if (attributedBody instanceof Uint8Array) {
                buffer = Buffer.from(attributedBody)
            } else {
                return null
            }

            // First, try to extract text directly from buffer (faster fallback)
            // NSAttributedString plist often contains the actual text as readable strings
            const bufferStr = buffer.toString('utf8')
            // Look for longer readable text patterns (at least 5 characters) that are likely message content
            // Exclude common plist keywords like "NSAttributedString", "NSDictionary", etc.
            const excludedPatterns =
                /^(NSAttributedString|NSMutableAttributedString|NSObject|NSString|NSMutableString|NSDictionary|NSNumber|NSValue|streamtyped|__kIMMessagePartAttributeName|__kIMPhoneNumberAttributeName|PhoneNumber|NS\.rangeval|locationZNS\.special)$/i
            const readableMatches = bufferStr.match(/[\x20-\x7E\u4e00-\u9fff]{5,}/g)
            if (readableMatches) {
                // Filter out plist keywords and find text that looks like actual message content
                const messageCandidates = readableMatches
                    .filter((match) => {
                        // Exclude plist keywords
                        if (excludedPatterns.test(match)) return false
                        // Exclude patterns that look like metadata (contain brackets, colons in wrong places, etc.)
                        if (/^[\[\(\)\]\*,\-:X]+$/.test(match)) return false
                        // Exclude NS object property patterns like "NS.rangeval.locationZNS.special"
                        if (/^NS\.\w+/.test(match)) return false
                        // Exclude attribute names starting with __kIM
                        if (/^__kIM/.test(match)) return false
                        // Exclude plist binary format markers like "$versionY$archiverT$topX$objects"
                        if (/\$version|\$archiver|\$top|\$objects|\$class/.test(match)) return false
                        // Prefer text that contains Chinese characters or looks like actual content
                        return match.length > 5
                    })
                    .map((match) => ({
                        text: match,
                        // Score: higher for Chinese characters, longer text, and content-like patterns
                        score:
                            (match.match(/[\u4e00-\u9fff]/g)?.length || 0) * 10 +
                            match.length +
                            (match.match(/[a-zA-Z]/) ? 5 : 0) -
                            (match.match(/[\[\(\)\]\*,\-:X]/g)?.length || 0) * 5 -
                            (match.match(/^__kIM|^NS\.|\$version|\$archiver|\$top|\$objects|\$class/) ? 100 : 0), // Heavily penalize attribute names and plist markers
                    }))
                    .sort((a, b) => b.score - a.score) // Sort by score, highest first

                if (messageCandidates.length > 0) {
                    // Return the highest-scoring candidate that's likely the actual message
                    const bestCandidate = messageCandidates[0]!
                    // Clean up common prefixes/suffixes that might be plist artifacts
                    return bestCandidate.text
                        .replace(/^\+"/, '') // Remove leading +"
                        .replace(/"$/, '') // Remove trailing "
                        .trim()
                }
            }

            // If direct extraction didn't work, try plutil (macOS built-in tool)
            // Write buffer to a temporary file and convert plist to XML
            const tempFile = join(
                tmpdir(),
                `imsg_attributedBody_${Date.now()}_${Math.random().toString(36).substring(7)}.plist`
            )

            try {
                await writeFile(tempFile, buffer)

                // Convert binary plist to XML using plutil
                const { stdout } = await execAsync(`plutil -convert xml1 -o - "${tempFile}"`, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024, // 1MB buffer
                })

                // Extract string content from NSAttributedString plist
                // Look for <string> tags in the XML
                const stringMatches = stdout.match(/<string>([\s\S]*?)<\/string>/g)
                if (stringMatches && stringMatches.length > 0) {
                    // Filter out plist keywords and find the actual message text
                    const textCandidates = stringMatches
                        .map((match) => {
                            const textMatch = match.match(/<string>([\s\S]*?)<\/string>/)
                            return textMatch?.[1]
                        })
                        .filter((text): text is string => {
                            if (!text) return false
                            // Decode XML entities
                            const decoded = this.decodeXmlEntities(text)
                            // Exclude plist keywords
                            return decoded.length > 5 && !excludedPatterns.test(decoded)
                        })
                        .sort((a, b) => b.length - a.length) // Sort by length, longest first

                    if (textCandidates.length > 0) {
                        // Decode XML entities for the selected candidate
                        return this.decodeXmlEntities(textCandidates[0]!)
                    }
                }
            } finally {
                // Clean up temp file
                try {
                    await unlink(tempFile)
                } catch {
                    // Ignore cleanup errors
                }
            }
        } catch (error) {
            // If all methods fail, return null
        }

        return null
    }

    /**
     * Convert database query result to Message object
     * @param row Raw row data from database query
     * @returns Formatted Message object
     */
    private async rowToMessage(row: Record<string, unknown>): Promise<Message> {
        // Try to get text from text field first
        let messageText: string | null = row.text ? str(row.text) : null

        // If text is null and attributedBody exists, try to extract from attributedBody
        if (!messageText && row.attributedBody) {
            messageText = await this.extractTextFromAttributedBody(row.attributedBody)
        }

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
