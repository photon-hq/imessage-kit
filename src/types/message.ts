/**
 * Message related types
 */

// ==================== Service type ====================

/**
 * Message service type
 *
 * - iMessage: Apple's iMessage service
 * - SMS: Traditional SMS service
 * - RCS: Rich Communication Services
 */
export type ServiceType = 'iMessage' | 'SMS' | 'RCS'

// ==================== Attachment ====================

/**
 * Message attachment information
 *
 * Contains file metadata and local path
 */
export interface Attachment {
    // ===== Basic information =====

    /** Unique ID of the attachment in database */
    readonly id: string

    /** Filename */
    readonly filename: string

    // ===== File properties =====

    /** MIME type (e.g. image/jpeg) */
    readonly mimeType: string

    /** Full local path to the file */
    readonly path: string

    /** File size in bytes */
    readonly size: number

    /** Whether this is an image type */
    readonly isImage: boolean

    // ===== Time information =====

    /** Attachment creation time */
    readonly createdAt: Date
}

// ==================== Message ====================

/**
 * Message object
 *
 * Represents a complete iMessage/SMS message
 */
export interface Message {
    // ===== Basic identifiers =====

    /** Unique ID of the message in database */
    readonly id: string

    /** Globally unique identifier for the message */
    readonly guid: string

    // ===== Content information =====

    /** Message text content (null for non-text messages) */
    readonly text: string | null

    // ===== Sender information =====

    /** Sender identifier (phone number or email) */
    readonly sender: string

    /** Sender display name (may be null) */
    readonly senderName: string | null

    // ===== Chat information =====

    /** ID of the chat this message belongs to */
    readonly chatId: string

    /** Whether this is a group chat message */
    readonly isGroupChat: boolean

    // ===== Service information =====

    /** Message service type */
    readonly service: ServiceType

    // ===== Status information =====

    /** Whether the message is read */
    readonly isRead: boolean

    /** Whether the message is sent by me */
    readonly isFromMe: boolean

    // ===== Attachment information =====

    /** List of attachments (readonly array) */
    readonly attachments: readonly Attachment[]

    // ===== Time information =====

    /** Message sent/received time */
    readonly date: Date
}

// ==================== Query filter ====================

/**
 * Message query filter
 *
 * All fields are optional, used to filter messages
 */
export interface MessageFilter {
    // ===== Status filter =====

    /** Only query unread messages */
    readonly unreadOnly?: boolean

    /** Exclude messages sent by current user (default: true) */
    readonly excludeOwnMessages?: boolean

    // ===== Source filter =====

    /** Filter by sender */
    readonly sender?: string

    /** Filter by chat ID */
    readonly chatId?: string

    // ===== Type filter =====

    /** Filter by service type */
    readonly service?: ServiceType

    /** Only query messages with attachments */
    readonly hasAttachments?: boolean

    // ===== Time filter =====

    /** Only query messages after this time */
    readonly since?: Date

    // ===== Search filter =====

    /** Search message text content (case-insensitive) */
    readonly search?: string

    // ===== Limit control =====

    /** Limit number of results */
    readonly limit?: number
}

// ==================== Query result ====================

/**
 * Message query result
 *
 * Contains message list and statistics
 */
export interface MessageQueryResult {
    /** List of messages */
    readonly messages: readonly Message[]

    /** Total number of messages found */
    readonly total: number

    /** Number of unread messages */
    readonly unreadCount: number
}

// ==================== Send result ====================

/**
 * Unread messages result
 *
 * Contains unread messages grouped by sender with statistics
 */
export interface UnreadMessagesResult {
    /** Messages grouped by sender */
    readonly groups: ReadonlyArray<{
        readonly sender: string
        readonly messages: readonly Message[]
    }>

    /** Total number of unread messages */
    readonly total: number

    /** Number of unique senders */
    readonly senderCount: number
}

/**
 * Send result
 *
 * Represents successful message sending result
 */
export interface SendResult {
    /** Message sent time */
    readonly sentAt: Date
}

// ==================== Chat Summary ====================

/**
 * Options for listing chats
 */
export interface ListChatsOptions {
    /** Maximum number of chats to return */
    limit?: number

    /** Filter by chat type */
    type?: 'all' | 'group' | 'dm'

    /** Only return chats with unread messages */
    hasUnread?: boolean

    /** Sort order */
    sortBy?: 'recent' | 'name'

    /** Search by display name (case-insensitive) */
    search?: string
}

/**
 * Chat summary information
 *
 * Used by sdk.listChats() to help developers discover chatId
 */
export interface ChatSummary {
    /** Chat identifier (e.g., 'iMessage;+1234567890' or group guid) */
    readonly chatId: string

    /** Display name (group name or contact name); may be null */
    readonly displayName: string | null

    /** Time of the last message in this chat; may be null */
    readonly lastMessageAt: Date | null

    /** Whether this chat is a group */
    readonly isGroup: boolean

    /** Number of unread messages in this chat */
    readonly unreadCount: number
}
