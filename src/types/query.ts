/**
 * Filter shapes consumed by `sdk.getMessages()` and `sdk.listChats()`.
 *
 * Both shapes flow through the query adapter (`infra/db/contract.ts`) down
 * to the active schema builder (`macos26.ts`) and back as typed domain models.
 */

import type { Service } from '../domain/service'

// -----------------------------------------------
// Message query
// -----------------------------------------------

export interface MessageQuery {
    /**
     * Chat identifier to scope results to a single conversation.
     *
     * Accepts `service;+;guid`, `service;-;address`, bare `chat<id>`, or a
     * bare recipient address — matched against `chat.chat_identifier` and
     * `chat.guid` after normalization via `ChatId.fromUserInput`.
     */
    readonly chatId?: string

    /** Remote handle (phone/email) to match against `handle.id`. */
    readonly participant?: string

    /** Transport filter. */
    readonly service?: Service

    /** `true` → only outgoing rows; `false` → only incoming; omitted → both. */
    readonly isFromMe?: boolean

    /** `true` → only read rows; `false` → only unread; omitted → both. */
    readonly isRead?: boolean

    /** `true` → only rows with ≥1 attachment; `false` → only rows with none; omitted → both. */
    readonly hasAttachments?: boolean

    /** Skip Tapback / sticker reactions (rows with non-null `associated_message_type`). */
    readonly excludeReactions?: boolean

    /** Inclusive lower bound on `message.date` (`message.date >= since`). */
    readonly since?: Date

    /** Exclusive upper bound on `message.date` (`message.date < before`). */
    readonly before?: Date

    /**
     * Case-insensitive substring search over decoded message text.
     *
     * Runs as an application-layer scan: rows are fetched and their
     * `text` (decoded from the `attributedBody` BLOB when needed) is
     * matched against the query. This is NOT a SQL `LIKE` and does not
     * use an index — narrow the result set with `since` / `chatId` /
     * `participant` / `limit` for large databases.
     */
    readonly search?: string

    /** Page size. Omit for unbounded (watch your memory on large DBs). */
    readonly limit?: number

    /** Row offset. Requires or implies `limit`. */
    readonly offset?: number
}

// -----------------------------------------------
// Chat query
// -----------------------------------------------

export interface ChatQuery {
    /**
     * Chat identifier to scope results to a single conversation.
     *
     * Accepts `service;+;guid`, `service;-;address`, bare `chat<id>`, or a
     * bare recipient address — matched against `chat.chat_identifier` and
     * `chat.guid` after normalization via `ChatId.fromUserInput`.
     */
    readonly chatId?: string

    /** Restrict to a single chat kind. Omit to include both. */
    readonly kind?: 'group' | 'dm'

    /** Transport filter. */
    readonly service?: Service

    /** `true` → only archived chats; `false` → only non-archived; omitted → both. */
    readonly isArchived?: boolean

    /** `true` → only chats with ≥1 unread incoming message; `false` → only chats with none; omitted → both. */
    readonly hasUnread?: boolean

    /**
     * Ordering.
     *   - `'recent'` → by most recent message timestamp (newest first)
     *   - `'name'`   → by display name (ASC, nulls last)
     */
    readonly sortBy?: 'recent' | 'name'

    /** Case-insensitive substring search against `display_name` and `chat_identifier`. */
    readonly search?: string

    /** Page size. Omit for unbounded. */
    readonly limit?: number

    /** Row offset. Requires or implies `limit`. */
    readonly offset?: number
}
