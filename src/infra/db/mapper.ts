/**
 * Row-to-domain-model mapper for Messages database query results.
 *
 * Converts raw SQL rows into domain models, delegating all type
 * resolution to domain resolve functions.
 */

import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { Attachment } from '../../domain/attachment'
import { resolveTransferStatus } from '../../domain/attachment'
import type { Chat, ChatKind } from '../../domain/chat'
import { resolveChatKind } from '../../domain/chat'
import { ChatId, parseChatServicePrefix } from '../../domain/chat-id'
import type { Message } from '../../domain/message'
import {
    resolveExpireStatus,
    resolveMessageKind,
    resolveScheduleKind,
    resolveScheduleStatus,
    resolveShareActivity,
    resolveShareDirection,
} from '../../domain/message'
import type { Reaction } from '../../domain/reaction'
import { resolveReactionMeta } from '../../domain/reaction'
import { resolveService } from '../../domain/service'
import { fromMacTimestampNs } from '../../domain/timestamp'
import { extractTextFromAttributedBody } from './body-decoder'

const HOME_DIR = homedir()

// -----------------------------------------------
// Value parsers
// -----------------------------------------------

/** Parse an unknown value to a finite number, or null. */
export function parseNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }

    if (typeof value === 'bigint') {
        const parsed = Number(value)
        return Number.isSafeInteger(parsed) ? parsed : null
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    return null
}

function optionalNumber(value: unknown, fieldName: string): number | null {
    if (value == null) return null

    const parsed = parseNumber(value)
    if (parsed != null) return parsed

    throw new Error(`Invalid numeric field: ${fieldName}`)
}

export function requireNumber(value: unknown, fieldName: string): number {
    const parsed = optionalNumber(value, fieldName)
    if (parsed != null) return parsed

    throw new Error(`Missing numeric field: ${fieldName}`)
}

function optionalString(value: unknown, fieldName: string): string | null {
    if (value == null) return null
    if (typeof value === 'string') return value

    throw new Error(`Invalid string field: ${fieldName}`)
}

function optionalNonEmptyString(value: unknown, fieldName: string): string | null {
    const parsed = optionalString(value, fieldName)
    return parsed == null || parsed === '' ? null : parsed
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
    const parsed = optionalNonEmptyString(value, fieldName)
    if (parsed != null) return parsed

    throw new Error(`Missing string field: ${fieldName}`)
}

function flag(value: unknown, fieldName: string): boolean {
    if (typeof value === 'boolean') return value
    if (value == null) return false

    const parsed = parseNumber(value)
    if (parsed != null) return parsed !== 0

    throw new Error(`Invalid boolean field: ${fieldName}`)
}

function optionalDate(value: unknown, fieldName: string): Date | null {
    const parsed = optionalNumber(value, fieldName)
    if (parsed == null || parsed === 0) return null

    return fromMacTimestampNs(parsed)
}

function requireDate(value: unknown, fieldName: string): Date {
    return fromMacTimestampNs(requireNumber(value, fieldName))
}

// -----------------------------------------------
// Optional participant
// -----------------------------------------------

function optionalParticipant(value: unknown, fieldName: string): string | null {
    const str = optionalString(value, fieldName)
    if (str == null) return null

    const trimmed = str.trim()
    return trimmed === '' ? null : trimmed
}

// -----------------------------------------------
// Chat-id resolution
// -----------------------------------------------

function resolveMessageChatId(row: Record<string, unknown>): ChatId | null {
    // Trust the authoritative identifiers first: `chat.guid` /
    // `chat.chat_identifier` (via the LEFT JOIN chat) or the CloudKit mirror.
    //
    // Deliberate asymmetry for the fallbacks:
    //
    //   • We fall back to `message.destination_caller_id` ONLY for
    //     out-bound messages (is_from_me = 1). For those, it is the
    //     recipient the user addressed, so it correctly identifies a DM
    //     when the chat row has not yet been joined (orphan out-bound
    //     messages during a race). For INBOUND messages the same column
    //     holds *my own* caller id — using it would mint a DM chatId
    //     pointing at myself, mis-routing an incoming group message as
    //     `chatKind='dm'`.
    //
    //   • We do NOT fall back to `message.participant` (handle.id). For
    //     in-bound group messages that field is the SENDER's personal
    //     handle, not the chat. Constructing a DM chatId from it makes
    //     `message.chatId` point at an individual, so any reply keyed on
    //     that chatId (e.g. agents echoing back into "the same conversation")
    //     lands in a 1:1 thread instead of the original group.
    const primary = resolvePrimaryChatId(row.chat_guid, row.chat_id) ?? resolveCloudKitChatId(row.ck_chat_id)
    if (primary != null) return primary

    // Only trust destination_caller_id on out-bound messages.
    if (!flag(row.is_from_me, 'message.is_from_me')) return null

    return resolveRecipientChatId(row.destination_caller_id, row.service, 'message.destination_caller_id')
}

function resolveRecipientChatId(recipient: unknown, service: unknown, fieldName: string): ChatId | null {
    const value = optionalParticipant(recipient, fieldName)
    if (value == null) return null

    const servicePrefix = parseChatServicePrefix(optionalNonEmptyString(service, 'message.service'))
    return servicePrefix ? ChatId.fromDMRecipient(value, servicePrefix) : ChatId.fromUserInput(value)
}

function resolvePrimaryChatId(guid: unknown, identifier: unknown): ChatId | null {
    const raw =
        optionalNonEmptyString(guid, 'message.chat_guid') ?? optionalNonEmptyString(identifier, 'message.chat_id')

    return raw == null ? null : ChatId.fromUserInput(raw)
}

function resolveCloudKitChatId(value: unknown): ChatId | null {
    const raw = optionalParticipant(value, 'message.ck_chat_id')
    return raw == null ? null : ChatId.fromUserInput(raw)
}

// -----------------------------------------------
// Text extraction
// -----------------------------------------------

function resolveMessageText(row: Record<string, unknown>): string | null {
    const text = optionalString(row.text, 'message.text')

    if (text != null && text !== '') {
        return text
    }

    if (row.attributedBody == null) {
        return null
    }

    if (!Buffer.isBuffer(row.attributedBody) && !(row.attributedBody instanceof Uint8Array)) {
        return null
    }

    const value = extractTextFromAttributedBody(row.attributedBody)
    return value === '' ? null : value
}

// -----------------------------------------------
// Reaction mapping
// -----------------------------------------------

function mapReaction(row: Record<string, unknown>): Reaction | null {
    const meta = resolveReactionMeta(optionalNumber(row.associated_message_type, 'message.associated_message_type'))

    if (meta.kind == null) {
        return null
    }

    return {
        kind: meta.kind,
        targetMessageId: optionalNonEmptyString(row.associated_message_guid, 'message.associated_message_guid'),
        emoji: optionalNonEmptyString(row.associated_message_emoji, 'message.associated_message_emoji'),
        textRange: {
            location:
                optionalNumber(row.associated_message_range_location, 'message.associated_message_range_location') ?? 0,
            length: optionalNumber(row.associated_message_range_length, 'message.associated_message_range_length') ?? 0,
        },
        isRemoved: meta.isRemoved,
    }
}

// -----------------------------------------------
// Chat mapping
// -----------------------------------------------

function mapChatId(row: Record<string, unknown>): string {
    const guid = requireNonEmptyString(row.guid, 'chat.guid')
    return ChatId.fromUserInput(guid).toString()
}

/** Convert a raw chat row to a Chat domain model. */
export function rowToChat(row: Record<string, unknown>): Chat {
    return {
        chatId: mapChatId(row),
        name: optionalNonEmptyString(row.display_name, 'chat.display_name'),
        service: resolveService(optionalNonEmptyString(row.service_name, 'chat.service_name')),
        kind: resolveChatKind(optionalNumber(row.style, 'chat.style')),
        account: optionalNonEmptyString(row.account_login, 'chat.account_login'),
        isArchived: flag(row.is_archived, 'chat.is_archived'),
        isFiltered: flag(row.is_filtered, 'chat.is_filtered'),
        dropsIncomingMessages: flag(row.is_blackholed, 'chat.is_blackholed'),
        autoDeletesIncomingMessages: flag(row.is_deleting_incoming_messages, 'chat.is_deleting_incoming_messages'),
        lastReadAt: optionalDate(row.last_read_message_timestamp, 'chat.last_read_message_timestamp'),
        unreadCount: requireNumber(row.unread_count, 'chat.unread_count'),
        lastMessageAt: optionalDate(row.last_date, 'chat.last_date'),
    }
}

// -----------------------------------------------
// Message mapping
// -----------------------------------------------

/**
 * Resolve chatKind with `chat.style` as authoritative source.
 *
 * When `chat` did not join (WAL race before `chat_message_join` is visible),
 * fall back to the ChatId's own group detection, and finally to 'unknown'.
 */
function resolveMessageChatKind(chatStyle: number | null, resolved: ChatId | null): ChatKind {
    if (chatStyle != null) return resolveChatKind(chatStyle)
    if (resolved == null) return 'unknown'
    return resolved.isGroup ? 'group' : 'dm'
}

/**
 * macOS 26 (Tahoe) stopped populating `message.date_retracted` on unsend;
 * instead it sets `is_empty = 1` and writes a 5-entry `bplist00` into
 * `message_summary_info` containing keys `Samc` `Sust` `Rep` `Sotr` `Rrp`
 * (recoverable-record-part). Earlier versions used 2-entry dicts and the
 * date column. We detect Tahoe retracts via the `Rrp` marker.
 */
function detectTahoeRetract(row: Record<string, unknown>): boolean {
    const isEmpty = optionalNumber(row.is_empty, 'message.is_empty') === 1
    if (!isEmpty) return false
    const summary = row.message_summary_info
    if (!summary) return false
    let buf: Buffer | null = null
    if (Buffer.isBuffer(summary)) buf = summary
    else if (summary instanceof Uint8Array) buf = Buffer.from(summary)
    if (!buf || buf.length < 6) return false
    // ASCII 'Rrp' = 0x52 0x72 0x70 — present only when bplist dict has the
    // retract slot. Avoids a full bplist parse; false positives would require
    // a normal message to contain this exact 3-byte sequence in summary_info.
    return buf.includes(Buffer.from([0x52, 0x72, 0x70]))
}

/**
 * Patch chat-related fields (`chatId`, `chatKind`) on a message using a
 * backfill row from `buildChatBackfillQuery`. Used by the reader when the
 * original `buildMessageQuery` saw `chat_message_join` before it was
 * written (WAL race). Returns the original message if the backfill row
 * carries no new information.
 *
 * Backfill rows only carry `chat_guid` / `chat_id` / `chat_style` — the
 * other fallbacks (destination_caller_id, ck_chat_id) were already
 * attempted in the original mapping, so we call the primary-chat-id
 * resolver directly.
 */
export function patchMessageChatInfo(message: Message, chatRow: Record<string, unknown>): Message {
    const resolved = resolvePrimaryChatId(chatRow.chat_guid, chatRow.chat_id)
    const chatId = resolved?.toString() ?? message.chatId
    const chatKind = resolveMessageChatKind(optionalNumber(chatRow.chat_style, 'chat.style'), resolved)

    if (chatId === message.chatId && chatKind === message.chatKind) return message
    return { ...message, chatId, chatKind }
}

/** Convert a raw message row to a Message domain model. */
export function rowToMessage(row: Record<string, unknown>, attachments: readonly Attachment[]): Message {
    const resolved = resolveMessageChatId(row)
    const chatId = resolved?.toString() ?? null
    const chatKind = resolveMessageChatKind(optionalNumber(row.chat_style, 'message.chat_style'), resolved)
    const errorCode = optionalNumber(row.error, 'message.error') ?? 0
    const reaction = mapReaction(row)
    // Tahoe retract fallback: use date_edited (retract happens after edits)
    // or the original send date as an approximate retract time.
    const directRetract = optionalDate(row.date_retracted, 'message.date_retracted')
    const retractedAt =
        directRetract ??
        (detectTahoeRetract(row)
            ? (optionalDate(row.date_edited, 'message.date_edited') ?? optionalDate(row.date, 'message.date'))
            : null)

    return {
        rowId: requireNumber(row.id, 'message.id'),
        id: requireNonEmptyString(row.guid, 'message.guid'),
        chatId,
        chatKind,
        participant: optionalParticipant(row.participant, 'message.participant'),
        service: resolveService(optionalNonEmptyString(row.service, 'message.service')),
        text: resolveMessageText(row),
        kind: resolveMessageKind(
            optionalNumber(row.item_type, 'message.item_type'),
            optionalNumber(row.group_action_type, 'message.group_action_type')
        ),
        isFromMe: flag(row.is_from_me, 'message.is_from_me'),
        isRead: flag(row.is_read, 'message.is_read'),
        isSent: flag(row.is_sent, 'message.is_sent'),
        isDelivered: flag(row.is_delivered, 'message.is_delivered'),
        isDowngraded: flag(row.was_downgraded, 'message.was_downgraded'),
        didNotifyRecipient: flag(row.did_notify_recipient, 'message.did_notify_recipient'),
        isAutoReply: flag(row.is_auto_reply, 'message.is_auto_reply'),
        isSystem: flag(row.is_system_message, 'message.is_system_message'),
        isForwarded: flag(row.is_forward, 'message.is_forward'),
        isAudioMessage: flag(row.is_audio_message, 'message.is_audio_message'),
        isPlayed: flag(row.is_played, 'message.is_played'),
        isExpirable: flag(row.is_expirable, 'message.is_expirable'),
        hasError: errorCode !== 0,
        errorCode,
        isSpam: flag(row.is_spam, 'message.is_spam'),
        isContactKeyVerified: flag(row.is_kt_verified, 'message.is_kt_verified'),
        hasUnseenMention: flag(row.has_unseen_mention, 'message.has_unseen_mention'),
        wasDeliveredQuietly: flag(row.was_delivered_quietly, 'message.was_delivered_quietly'),
        isEmergencySos: flag(row.is_sos, 'message.is_sos'),
        isCriticalAlert: flag(row.is_critical, 'message.is_critical'),
        isOffGrid: flag(row.sent_or_received_off_grid, 'message.sent_or_received_off_grid'),
        createdAt: requireDate(row.date, 'message.date'),
        deliveredAt: optionalDate(row.date_delivered, 'message.date_delivered'),
        readAt: optionalDate(row.date_read, 'message.date_read'),
        playedAt: optionalDate(row.date_played, 'message.date_played'),
        editedAt: optionalDate(row.date_edited, 'message.date_edited'),
        retractedAt,
        recoveredAt: optionalDate(row.date_recovered, 'message.date_recovered'),
        replyToMessageId: optionalNonEmptyString(row.reply_to_guid, 'message.reply_to_guid'),
        threadRootMessageId: optionalNonEmptyString(row.thread_originator_guid, 'message.thread_originator_guid'),
        affectedParticipant: optionalParticipant(row.affected_participant, 'message.affected_participant'),
        newGroupName: optionalNonEmptyString(row.group_title, 'message.group_title'),
        sendEffect: optionalNonEmptyString(row.expressive_send_style_id, 'message.expressive_send_style_id'),
        appBundleId: optionalNonEmptyString(row.balloon_bundle_id, 'message.balloon_bundle_id'),
        isInvisibleInkRevealed: flag(row.was_detonated, 'message.was_detonated'),
        expireStatus: resolveExpireStatus(optionalNumber(row.expire_state, 'message.expire_state')),
        shareActivity: resolveShareActivity(optionalNumber(row.share_status, 'message.share_status')),
        shareDirection: resolveShareDirection(optionalNumber(row.share_direction, 'message.share_direction')),
        scheduleKind: resolveScheduleKind(optionalNumber(row.schedule_type, 'message.schedule_type')),
        scheduleStatus: resolveScheduleStatus(optionalNumber(row.schedule_state, 'message.schedule_state')),
        segmentCount: optionalNumber(row.part_count, 'message.part_count') ?? 0,
        hasAttachments: flag(row.cache_has_attachments, 'message.cache_has_attachments'),
        reaction,
        attachments,
    }
}

// -----------------------------------------------
// Attachment mapping
// -----------------------------------------------

function resolveAttachmentLocalPath(rawFilename: unknown): string | null {
    const filename = optionalNonEmptyString(rawFilename, 'attachment.filename')

    if (filename == null) return null

    if (filename.startsWith('~')) {
        return filename.replace(/^~/, HOME_DIR)
    }

    if (!filename.startsWith('/')) {
        return join(HOME_DIR, 'Library/Messages/Attachments', filename)
    }

    return filename
}

function resolveAttachmentFileName(rawTransferName: unknown, localPath: string | null): string | null {
    const transferName = optionalNonEmptyString(rawTransferName, 'attachment.transfer_name')

    if (transferName != null) return transferName

    if (!localPath) return null

    const name = basename(localPath)
    return name === '' ? null : name
}

/** Convert a raw attachment row to an Attachment domain model. */
export function rowToAttachment(row: Record<string, unknown>): Attachment {
    const localPath = resolveAttachmentLocalPath(row.filename)

    return {
        id: requireNonEmptyString(row.guid, 'attachment.guid'),
        fileName: resolveAttachmentFileName(row.transfer_name, localPath),
        localPath,
        mimeType: optionalNonEmptyString(row.mime_type, 'attachment.mime_type') ?? 'application/octet-stream',
        uti: optionalNonEmptyString(row.uti, 'attachment.uti'),
        sizeBytes: optionalNumber(row.total_bytes, 'attachment.total_bytes') ?? 0,
        transferStatus: resolveTransferStatus(optionalNumber(row.transfer_state, 'attachment.transfer_state')),
        isFromMe: flag(row.is_outgoing, 'attachment.is_outgoing'),
        isSticker: flag(row.is_sticker, 'attachment.is_sticker'),
        isSensitiveContent: flag(row.is_commsafety_sensitive, 'attachment.is_commsafety_sensitive'),
        altText: optionalNonEmptyString(row.emoji_image_short_description, 'attachment.emoji_image_short_description'),
        createdAt: requireDate(row.created_date, 'attachment.created_date'),
    }
}
