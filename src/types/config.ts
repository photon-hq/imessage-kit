/**
 * SDK configuration types
 */

import type { Plugin } from '../plugins/core'

// ==================== Webhook configuration ====================

/**
 * Webhook notification configuration
 *
 * Used to send HTTP notifications when new messages are received
 */
export interface WebhookConfig {
    /** Webhook URL address */
    readonly url: string

    /** Custom HTTP headers */
    readonly headers?: Record<string, string>

    /** Request timeout in milliseconds (default: 5000) */
    readonly timeout?: number
}

// ==================== Watcher configuration ====================

/**
 * Message watcher configuration
 *
 * Controls message polling behavior
 */
export interface WatcherConfig {
    /** Poll interval in milliseconds (default: 2000) */
    readonly pollInterval?: number

    /** Only watch unread messages (default: false) */
    readonly unreadOnly?: boolean
}

// ==================== Retry configuration ====================

/**
 * Retry configuration
 *
 * Controls retry behavior when message sending fails
 */
export interface RetryConfig {
    /** Maximum retry attempts (default: 2) */
    readonly max?: number

    /** Base retry delay in milliseconds (default: 1500) */
    readonly delay?: number
}

// ==================== Temp file configuration ====================

/**
 * Temporary file configuration
 *
 * Controls cleanup behavior for temporary files created when sending attachments
 */
export interface TempFileConfig {
    /** File retention time in milliseconds (default: 10 minutes) */
    readonly maxAge?: number

    /** Cleanup interval in milliseconds (default: 5 minutes) */
    readonly cleanupInterval?: number
}

// ==================== SDK main configuration ====================

/**
 * SDK main configuration interface
 *
 * All options are optional and use default values
 */
export interface IMessageConfig {
    // ===== Database configuration =====

    /**
     * Database path
     * Default: ~/Library/Messages/chat.db
     */
    readonly databasePath?: string

    // ===== Notification configuration =====

    /** Webhook configuration (optional) */
    readonly webhook?: WebhookConfig

    // ===== Watcher configuration =====

    /** Watcher configuration (optional) */
    readonly watcher?: WatcherConfig

    // ===== Sending configuration =====

    /** Retry configuration (optional) */
    readonly retry?: RetryConfig

    /** Temporary file configuration (optional) */
    readonly tempFile?: TempFileConfig

    /**
     * AppleScript execution timeout
     * In milliseconds (default: 30000)
     */
    readonly scriptTimeout?: number

    /**
     * Maximum concurrent sends
     * Default: 5, 0 means unlimited
     */
    readonly maxConcurrent?: number

    // ===== Other configuration =====

    /** Debug mode (default: false) */
    readonly debug?: boolean

    /** Plugin list (optional) */
    readonly plugins?: readonly Plugin[]
}

// ==================== Resolved configuration ====================

/**
 * Resolved configuration
 *
 * All fields are populated with default values, guaranteed non-null
 */
export interface ResolvedConfig {
    readonly databasePath: string
    readonly webhook: WebhookConfig | null
    readonly watcher: Required<WatcherConfig>
    readonly retry: Required<RetryConfig>
    readonly tempFile: Required<TempFileConfig>
    readonly scriptTimeout: number
    readonly maxConcurrent: number
    readonly debug: boolean
}
