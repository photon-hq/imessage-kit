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
    return (
        resolvePrimaryChatId(row.chat_guid, row.chat_id, row.chat_service) ??
        resolveCloudKitChatId(row.ck_chat_id) ??
        resolveParticipantChatId(row.participant, row.service, 'message.participant') ??
        resolveParticipantChatId(row.destination_caller_id, row.service, 'message.destination_caller_id')
    )
}

function resolvePrimaryChatId(guid: unknown, identifier: unknown, service: unknown): ChatId | null {
    const guidValue = optionalNonEmptyString(guid, 'message.chat_guid')
    const identifierValue = optionalNonEmptyString(identifier, 'message.chat_id')
    const serviceValue = optionalNonEmptyString(service, 'message.chat_service')

    if (guidValue == null && identifierValue == null && serviceValue == null) {
        return null
    }

    const raw = guidValue ?? identifierValue ?? ''
    return raw === '' ? null : ChatId.fromUserInput(raw)
}

function resolveCloudKitChatId(value: unknown): ChatId | null {
    const raw = optionalParticipant(value, 'message.ck_chat_id')
    return raw == null ? null : ChatId.fromUserInput(raw)
}

function resolveParticipantChatId(participant: unknown, service: unknown, fieldName: string): ChatId | null {
    const recipient = optionalParticipant(participant, fieldName)
    if (recipient == null) return null

    const servicePrefix = parseChatServicePrefix(optionalNonEmptyString(service, 'message.service'))
    return servicePrefix ? ChatId.fromDMRecipient(recipient, servicePrefix) : ChatId.fromUserInput(recipient)
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

/** Convert a raw message row to a Message domain model. */
export function rowToMessage(row: Record<string, unknown>, attachments: readonly Attachment[]): Message {
    const resolved = resolveMessageChatId(row)
    const chatId = resolved?.toString() ?? ''
    const chatKind: ChatKind = resolved == null ? 'unknown' : resolved.isGroup ? 'group' : 'dm'
    const errorCode = optionalNumber(row.error, 'message.error') ?? 0
    const reaction = mapReaction(row)

    return {
        rowId: requireNumber(row.id, 'message.id'),
        id: requireNonEmptyString(row.guid, 'message.guid'),
        chatId,
        chatKind,
        participant: optionalParticipant(row.participant, 'message.participant'),
        service: resolveService(optionalNonEmptyString(row.service, 'message.service')),
        text: resolveMessageText(row),
        kind:
            reaction != null
                ? 'reaction'
                : resolveMessageKind(
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
        isOffGridMessage: flag(row.sent_or_received_off_grid, 'message.sent_or_received_off_grid'),
        createdAt: requireDate(row.date, 'message.date'),
        deliveredAt: optionalDate(row.date_delivered, 'message.date_delivered'),
        readAt: optionalDate(row.date_read, 'message.date_read'),
        playedAt: optionalDate(row.date_played, 'message.date_played'),
        editedAt: optionalDate(row.date_edited, 'message.date_edited'),
        retractedAt: optionalDate(row.date_retracted, 'message.date_retracted'),
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
        isOutgoing: flag(row.is_outgoing, 'attachment.is_outgoing'),
        isSticker: flag(row.is_sticker, 'attachment.is_sticker'),
        isSensitiveContent: flag(row.is_commsafety_sensitive, 'attachment.is_commsafety_sensitive'),
        altText: optionalNonEmptyString(row.emoji_image_short_description, 'attachment.emoji_image_short_description'),
        createdAt: requireDate(row.created_date, 'attachment.created_date'),
    }
}
