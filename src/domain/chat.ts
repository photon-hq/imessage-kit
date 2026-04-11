/**
 * iMessage chat (conversation) model.
 *
 * Chat style values (`chat.style`):
 *   43  (ASCII '+')  group chat
 *   45  (ASCII '-')  DM (1-on-1) chat
 */

import type { Service } from './service'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Normalized chat kind derived from `chat.style`. */
export type ChatKind = 'dm' | 'group' | 'unknown'

/** Chat summary. */
export interface Chat {
    /** Normalized chat id suitable for routing and matching. */
    readonly chatId: string
    /** User-visible display name. */
    readonly name: string | null
    /** Transport used by the chat when known. */
    readonly service: Service | null
    /** Normalized chat kind. */
    readonly kind: ChatKind
    /** Account login associated with the chat when known. */
    readonly account: string | null
    /** Chat is archived. */
    readonly isArchived: boolean
    /** Chat is in the filtered / unknown-senders bucket. */
    readonly isFiltered: boolean
    /** Incoming messages are silently dropped for this chat. */
    readonly dropsIncomingMessages: boolean
    /** Incoming messages are automatically deleted. */
    readonly autoDeletesIncomingMessages: boolean
    /** Last read timestamp for the chat. */
    readonly lastReadAt: Date | null
    /** Number of unread incoming messages. */
    readonly unreadCount: number
    /** Timestamp of the most recent message in the chat. */
    readonly lastMessageAt: Date | null
}

// -----------------------------------------------
// Constants
// -----------------------------------------------

/** `chat.style` value for group chats (ASCII '+' = 43). */
export const CHAT_STYLE_GROUP = 43

/** `chat.style` value for DM chats (ASCII '-' = 45). */
export const CHAT_STYLE_DM = 45

// -----------------------------------------------
// Resolution
// -----------------------------------------------

/** Resolve `chat.style` to a typed ChatKind. */
export function resolveChatKind(style: number | null): ChatKind {
    switch (style) {
        case CHAT_STYLE_GROUP:
            return 'group'
        case CHAT_STYLE_DM:
            return 'dm'
        default:
            return 'unknown'
    }
}
