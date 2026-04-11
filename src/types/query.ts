/**
 * Query parameter types for database operations.
 *
 * Used by SDK public API and infra query engine.
 */

import type { Service } from '../domain/service'

// -----------------------------------------------
// Message query
// -----------------------------------------------

export interface MessageQuery {
    readonly chatId?: string
    readonly participant?: string
    readonly service?: Service
    readonly isFromMe?: boolean
    readonly unreadOnly?: boolean
    readonly hasAttachments?: boolean
    readonly excludeReactions?: boolean
    readonly since?: Date
    readonly before?: Date
    readonly search?: string
    readonly limit?: number
    readonly offset?: number
}

// -----------------------------------------------
// Chat query
// -----------------------------------------------

export interface ChatQuery {
    readonly chatId?: string
    readonly kind?: 'all' | 'group' | 'dm'
    readonly service?: Service
    readonly isArchived?: boolean
    readonly hasUnread?: boolean
    readonly sortBy?: 'recent' | 'name'
    readonly search?: string
    readonly limit?: number
}
