/**
 * iMessage message model.
 *
 * Message item types (`message.item_type`, Apple `IMItemType`):
 *
 *   0  Message                        text / media message
 *   1  ParticipantChange              add / remove (sub-typed by `group_action_type`)
 *   2  GroupTitleChange               display name changed
 *   3  GroupAction                    photo, background, or other group action
 *   4  LocationShareStatusChange      location sharing status change
 *   5  MessageAction                  message-level action (kept audio, etc.)
 *   6  TUConversation                 FaceTime / TelephonyUtilities conversation event
 */

import type { Attachment } from './attachment'
import type { ChatKind } from './chat'
import type { Reaction } from './reaction'
import type { Service } from './service'

// -----------------------------------------------
// Message kind
// -----------------------------------------------

/**
 * Normalized message kind derived from `message.item_type`.
 *
 * Orthogonal to reactions — a row with a non-null `reaction` payload still
 * carries its wire-level kind here (typically `'text'` for tapbacks).
 */
export type MessageKind = 'text' | 'memberAdded' | 'memberRemoved' | 'nameChanged' | 'groupAction' | 'unknown'

/**
 * Resolve `item_type` and `group_action_type` into a MessageKind.
 *
 * Maps itemType 0–3 to specific kinds; 4–6 fall through to 'unknown'.
 * For itemType=1, `group_action_type` distinguishes added (0) from removed (1).
 */
export function resolveMessageKind(itemType: number | null, groupActionType: number | null): MessageKind {
    switch (itemType) {
        case 0:
            return 'text'
        case 1:
            return groupActionType === 1 ? 'memberRemoved' : 'memberAdded'
        case 2:
            return 'nameChanged'
        case 3:
            return 'groupAction'
        default:
            return 'unknown'
    }
}

// -----------------------------------------------
// Expiration status
// -----------------------------------------------

/** Message expiration state derived from `message.expire_state`. */
export type ExpireStatus = 'active' | 'willExpire' | 'expired'

/** Resolve `message.expire_state` to a typed status. */
export function resolveExpireStatus(code: number | null): ExpireStatus {
    switch (code) {
        case 1:
            return 'willExpire'
        case 2:
            return 'expired'
        default:
            return 'active'
    }
}

// -----------------------------------------------
// Sharing status
// -----------------------------------------------

/** Sharing activity state derived from `message.share_status`. */
export type ShareActivity = 'none' | 'pending' | 'active' | 'unknown'

/** Resolve `message.share_status` to a typed activity state. */
export function resolveShareActivity(code: number | null): ShareActivity {
    switch (code) {
        case 0:
            return 'none'
        case 1:
            return 'pending'
        case 2:
            return 'active'
        default:
            return 'unknown'
    }
}

/** Sharing direction derived from `message.share_direction`. */
export type ShareDirection = 'none' | 'incoming' | 'outgoing' | 'unknown'

/** Resolve `message.share_direction` to a typed direction. */
export function resolveShareDirection(code: number | null): ShareDirection {
    switch (code) {
        case 0:
            return 'none'
        case 1:
            return 'incoming'
        case 2:
            return 'outgoing'
        default:
            return 'unknown'
    }
}

// -----------------------------------------------
// Scheduled messages
// -----------------------------------------------

/** Scheduled message kind derived from `message.schedule_type`. */
export type ScheduleKind = 'none' | 'sendLater' | 'unknown'

/**
 * Resolve `message.schedule_type` to a typed kind.
 *
 * Both `1` and `2` are observed in the wild as "send later" markers
 * (the `message_is_scheduled_message_index` in chat.db is defined on
 * `schedule_type = 2`); accept either for forward compatibility.
 */
export function resolveScheduleKind(code: number | null): ScheduleKind {
    switch (code) {
        case 0:
            return 'none'
        case 1:
        case 2:
            return 'sendLater'
        default:
            return 'unknown'
    }
}

/** Scheduled message status derived from `message.schedule_state`. */
export type ScheduleStatus = 'none' | 'pending' | 'sent' | 'failed' | 'unknown'

/**
 * Resolve `message.schedule_state` to a typed status.
 *
 * Other values (e.g. `4`, observed occasionally in chat.db) are Apple-internal
 * transient states not covered by a public enum and are reported as `unknown`.
 */
export function resolveScheduleStatus(code: number | null): ScheduleStatus {
    switch (code) {
        case 0:
            return 'none'
        case 1:
            return 'pending'
        case 2:
            return 'sent'
        case 3:
            return 'failed'
        default:
            return 'unknown'
    }
}

// -----------------------------------------------
// Message
// -----------------------------------------------

/** Message model. */
export interface Message {
    /** Local store row id. Useful for cursors and watcher checkpoints. */
    readonly rowId: number
    /** Stable message id derived from `message.guid`. */
    readonly id: string
    /**
     * Normalized chat id suitable for routing and matching.
     *
     * `null` only when all authoritative sources are missing from the row
     * (no `chat_guid` / `chat_id` via join, no `ck_chat_id`, and the message
     * is in-bound so no `destination_caller_id`). Observable in rare WAL
     * races before `chat_message_join` flushes — treat as "chat unknown,
     * skip routing".
     */
    readonly chatId: string | null
    /** Chat kind derived from the owning chat. */
    readonly chatKind: ChatKind
    /** Database-associated remote participant handle. */
    readonly participant: string | null
    /** Transport used for this message. `null` when the raw column is missing or unrecognized. */
    readonly service: Service | null
    /** Best-effort decoded text body. */
    readonly text: string | null
    /** Normalized message kind. */
    readonly kind: MessageKind
    /** Whether this row was sent by the local user. */
    readonly isFromMe: boolean
    /** Local read state. */
    readonly isRead: boolean
    /** Send completed on the local device. */
    readonly isSent: boolean
    /** Delivery was confirmed by the recipient device. */
    readonly isDelivered: boolean
    /** The message downgraded from iMessage to SMS. */
    readonly isDowngraded: boolean
    /** Recipient device actually displayed a notification. */
    readonly didNotifyRecipient: boolean
    /** Focus / DND auto-reply message. */
    readonly isAutoReply: boolean
    /** System-generated message row. */
    readonly isSystem: boolean
    /** Forwarded message. */
    readonly isForwarded: boolean
    /** Audio message. */
    readonly isAudioMessage: boolean
    /** Audio message has been played. */
    readonly isPlayed: boolean
    /** Message content can expire. */
    readonly isExpirable: boolean
    /** `true` when `errorCode !== 0`. */
    readonly hasError: boolean
    /** Raw error code for diagnostics. */
    readonly errorCode: number
    /** Marked as spam. */
    readonly isSpam: boolean
    /** Contact Key Verification passed. */
    readonly isContactKeyVerified: boolean
    /** Group chat has an unseen mention. */
    readonly hasUnseenMention: boolean
    /** Delivered quietly without notification. */
    readonly wasDeliveredQuietly: boolean
    /** Emergency SOS message. */
    readonly isEmergencySos: boolean
    /** Critical alert message. */
    readonly isCriticalAlert: boolean
    /** Message was sent or received off-grid via satellite. */
    readonly isOffGrid: boolean
    /** Sent or received timestamp. */
    readonly createdAt: Date
    /** Delivery confirmation timestamp. */
    readonly deliveredAt: Date | null
    /** Read timestamp. */
    readonly readAt: Date | null
    /** Audio playback timestamp. */
    readonly playedAt: Date | null
    /** Edit timestamp. */
    readonly editedAt: Date | null
    /** Unsend / retract timestamp. */
    readonly retractedAt: Date | null
    /** Recovery-from-trash timestamp. */
    readonly recoveredAt: Date | null
    /** Direct reply target message id. */
    readonly replyToMessageId: string | null
    /** Thread root message id. */
    readonly threadRootMessageId: string | null
    /** Participant affected by a membership change event. */
    readonly affectedParticipant: string | null
    /** New group name for rename events. */
    readonly newGroupName: string | null
    /** Send effect identifier. */
    readonly sendEffect: string | null
    /** Rich-message / app extension bundle identifier. */
    readonly appBundleId: string | null
    /** Invisible Ink content has been revealed. */
    readonly isInvisibleInkRevealed: boolean
    /** Expiration state derived from `message.expire_state`. */
    readonly expireStatus: ExpireStatus
    /** Sharing activity state derived from `message.share_status`. */
    readonly shareActivity: ShareActivity
    /** Sharing direction derived from `message.share_direction`. */
    readonly shareDirection: ShareDirection
    /** Scheduled-message kind derived from `message.schedule_type`. */
    readonly scheduleKind: ScheduleKind
    /** Scheduled-message status derived from `message.schedule_state`. */
    readonly scheduleStatus: ScheduleStatus
    /** Number of parts / segments in the message. */
    readonly segmentCount: number
    /**
     * Whether `message.cache_has_attachments` is set on the underlying row.
     *
     * Use this to detect a WAL race where a message row is already visible
     * but its `message_attachment_join` entries have not yet been flushed —
     * `hasAttachments === true && attachments.length === 0` means the
     * attachments will arrive on a subsequent batch. Treat such messages
     * as provisional and re-query (or wait for the next watcher tick).
     */
    readonly hasAttachments: boolean
    /** Reaction payload when this row is a reaction. */
    readonly reaction: Reaction | null
    /** Attachments linked to the message. */
    readonly attachments: readonly Attachment[]
}
