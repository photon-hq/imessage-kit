/**
 * macOS 26 (Tahoe) query builder.
 *
 * Implements the MessagesDbQueries contract with macOS 26-specific
 * column selections, including ck_chat_id.
 */

import { CHAT_STYLE_DM, CHAT_STYLE_GROUP } from '../../domain/chat'
import { toMacTimestampNs } from '../../domain/timestamp'
import {
    buildChatIdMatchSql,
    type ChatQueryInput,
    type MessageQueryInput,
    type MessagesDbQueries,
    type QueryParam,
} from './contract'

// -----------------------------------------------
// Field selections
// -----------------------------------------------

const MESSAGE_FIELDS = [
    'message.ROWID as id',
    'message.guid',
    'message.text',
    'message.attributedBody',
    'message.service',
    'message.is_from_me',
    'message.is_read',
    'message.is_sent',
    'message.is_delivered',
    'message.was_downgraded',
    'message.did_notify_recipient',
    'message.is_auto_reply',
    'message.is_system_message',
    'message.is_forward',
    'message.is_audio_message',
    'message.is_played',
    'message.is_expirable',
    'message.error',
    'message.is_spam',
    'message.is_kt_verified',
    'message.has_unseen_mention',
    'message.was_delivered_quietly',
    'message.is_sos',
    'message.is_critical',
    'message.sent_or_received_off_grid',
    'message.date',
    'message.date_delivered',
    'message.date_read',
    'message.date_played',
    'message.date_edited',
    'message.date_retracted',
    'message.date_recovered',
    'message.is_empty',
    'message.message_summary_info',
    'message.reply_to_guid',
    'message.thread_originator_guid',
    'message.group_title',
    'message.expressive_send_style_id',
    'message.balloon_bundle_id',
    'message.destination_caller_id',
    'message.ck_chat_id as ck_chat_id',
    'message.was_detonated',
    'message.expire_state',
    'message.share_status',
    'message.share_direction',
    'message.schedule_type',
    'message.schedule_state',
    'message.part_count',
    'message.cache_has_attachments',
    'message.associated_message_type',
    'message.associated_message_guid',
    'message.associated_message_emoji',
    'message.associated_message_range_location',
    'message.associated_message_range_length',
    'message.item_type',
    'message.group_action_type',
    'handle.id as participant',
    'other_handle.id as affected_participant',
    'chat.chat_identifier as chat_id',
    'chat.guid as chat_guid',
    'chat.style as chat_style',
] as const

const CHAT_FIELDS = [
    'chat.guid',
    'chat.chat_identifier',
    'chat.service_name',
    'chat.style',
    'chat.account_login',
    'chat.is_archived',
    'chat.is_filtered',
    'chat.is_blackholed',
    'chat.is_deleting_incoming_messages',
    'chat.last_read_message_timestamp',
    'chat.display_name',
    'chat_stats.last_date',
    'COALESCE(chat_stats.unread_count, 0) AS unread_count',
] as const

const ATTACHMENT_FIELDS = [
    'message_attachment_join.message_id as msg_id',
    'attachment.guid',
    'attachment.created_date',
    'attachment.filename',
    'attachment.uti',
    'attachment.mime_type',
    'attachment.transfer_state',
    'attachment.is_outgoing',
    'attachment.transfer_name',
    'attachment.total_bytes',
    'attachment.is_sticker',
    'attachment.is_commsafety_sensitive',
    'attachment.emoji_image_short_description',
] as const

// -----------------------------------------------
// Query builder
// -----------------------------------------------

function escapeLikePattern(input: string): string {
    return input.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

/** macOS 26 (Tahoe) query builder. */
export const macos26Queries: MessagesDbQueries = {
    buildMessageQuery(filter: MessageQueryInput) {
        const conditions: string[] = []
        const params: QueryParam[] = []

        if (filter.isRead === true) {
            conditions.push('message.is_read = 1')
        } else if (filter.isRead === false) {
            conditions.push('message.is_read = 0')
        }

        if (filter.isFromMe === true) {
            conditions.push('message.is_from_me = 1')
        } else if (filter.isFromMe === false) {
            conditions.push('message.is_from_me = 0')
        }

        if (filter.participant) {
            conditions.push('handle.id = ?')
            params.push(filter.participant)
        }

        if (filter.chatId) {
            const match = buildChatIdMatchSql(filter.chatId, {
                identifier: 'chat.chat_identifier',
                guid: 'chat.guid',
            })
            conditions.push(match.sql)
            params.push(...match.params)
        }

        if (filter.service) {
            conditions.push('message.service = ?')
            params.push(filter.service)
        }

        if (filter.hasAttachments === true) {
            conditions.push(
                'EXISTS (SELECT 1 FROM message_attachment_join WHERE message_attachment_join.message_id = message.ROWID)'
            )
        } else if (filter.hasAttachments === false) {
            conditions.push(
                'NOT EXISTS (SELECT 1 FROM message_attachment_join WHERE message_attachment_join.message_id = message.ROWID)'
            )
        }

        if (filter.excludeReactions) {
            conditions.push('(message.associated_message_type IS NULL OR message.associated_message_type = 0)')
        }

        if (filter.sinceRowId != null) {
            conditions.push('message.ROWID > ?')
            params.push(filter.sinceRowId)
        }

        if (filter.since) {
            conditions.push('message.date >= ?')
            params.push(toMacTimestampNs(filter.since))
        }

        if (filter.before) {
            conditions.push('message.date < ?')
            params.push(toMacTimestampNs(filter.before))
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const hasLimit = filter.limit != null && filter.limit > 0
        const hasOffset = filter.offset != null && filter.offset > 0

        let limitClause = ''

        if (hasLimit) {
            limitClause = 'LIMIT ?'
            params.push(filter.limit as number)
        } else if (hasOffset) {
            // SQLite requires a LIMIT clause whenever OFFSET is present;
            // `LIMIT -1` means "no limit" and is the canonical idiom.
            limitClause = 'LIMIT -1'
        }

        const offsetClause = hasOffset ? 'OFFSET ?' : ''

        if (hasOffset) {
            params.push(filter.offset as number)
        }

        const orderBy = filter.orderByRowIdAsc ? 'ORDER BY message.ROWID ASC' : 'ORDER BY message.date DESC'

        return {
            sql: `
                SELECT
                    ${MESSAGE_FIELDS.join(',\n                    ')}
                FROM message
                LEFT JOIN handle ON message.handle_id = handle.ROWID
                LEFT JOIN handle AS other_handle ON message.other_handle = other_handle.ROWID
                -- A message can appear in multiple chat_message_join rows (rare,
                -- e.g. cross-posted group messages). MIN(chat_id) picks the
                -- lowest-ROWID chat deterministically so repeated queries
                -- return the same chat_guid/chat_identifier for the message.
                LEFT JOIN chat ON chat.ROWID = (
                    SELECT MIN(chat_message_join.chat_id)
                    FROM chat_message_join
                    WHERE chat_message_join.message_id = message.ROWID
                )
                ${where}
                ${orderBy}
                ${limitClause}
                ${offsetClause}
            `,
            params,
        }
    },

    buildChatQuery(query: ChatQueryInput) {
        const conditions: string[] = []
        const params: QueryParam[] = []

        if (query.chatId) {
            const match = buildChatIdMatchSql(query.chatId, {
                identifier: 'chat_identifier',
                guid: 'guid',
            })
            conditions.push(match.sql)
            params.push(...match.params)
        }

        if (query.kind === 'group') {
            conditions.push('style = ?')
            params.push(CHAT_STYLE_GROUP)
        } else if (query.kind === 'dm') {
            conditions.push('style = ?')
            params.push(CHAT_STYLE_DM)
        }

        if (query.service) {
            conditions.push('service_name = ?')
            params.push(query.service)
        }

        if (query.isArchived === true) {
            conditions.push('is_archived = 1')
        } else if (query.isArchived === false) {
            conditions.push('is_archived = 0')
        }

        if (query.hasUnread === true) {
            conditions.push('unread_count > 0')
        } else if (query.hasUnread === false) {
            conditions.push('unread_count = 0')
        }

        if (query.search) {
            const escaped = escapeLikePattern(query.search)
            conditions.push("(display_name LIKE ? ESCAPE '\\' OR chat_identifier LIKE ? ESCAPE '\\')")
            params.push(`%${escaped}%`, `%${escaped}%`)
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        let orderBy = ''

        if (query.sortBy === 'recent') {
            orderBy = 'ORDER BY (last_date IS NULL), last_date DESC'
        } else if (query.sortBy === 'name') {
            orderBy = 'ORDER BY (display_name IS NULL), display_name ASC'
        }

        const hasLimit = query.limit != null && query.limit > 0
        const hasOffset = query.offset != null && query.offset > 0

        let limitClause = ''

        if (hasLimit) {
            limitClause = 'LIMIT ?'
            params.push(query.limit as number)
        } else if (hasOffset) {
            // SQLite requires a LIMIT clause whenever OFFSET is present;
            // `LIMIT -1` means "no limit" and is the canonical idiom.
            limitClause = 'LIMIT -1'
        }

        const offsetClause = hasOffset ? 'OFFSET ?' : ''

        if (hasOffset) {
            params.push(query.offset as number)
        }

        return {
            sql: `
                WITH chat_stats AS (
                    SELECT
                        chat_message_join.chat_id,
                        MAX(message.date) AS last_date,
                        SUM(
                            CASE
                                WHEN message.is_read = 0 AND message.is_from_me = 0 THEN 1
                                ELSE 0
                            END
                        ) AS unread_count
                    FROM chat_message_join
                    INNER JOIN message ON message.ROWID = chat_message_join.message_id
                    GROUP BY chat_message_join.chat_id
                ),
                enriched AS (
                    SELECT
                        ${CHAT_FIELDS.join(',\n                        ')}
                    FROM chat
                    LEFT JOIN chat_stats ON chat_stats.chat_id = chat.ROWID
                )
                SELECT *
                FROM enriched
                ${where}
                ${orderBy}
                ${limitClause}
                ${offsetClause}
            `,
            params,
        }
    },

    buildAttachmentQuery(messageIds: readonly number[]) {
        const placeholders = messageIds.map(() => '?').join(',')

        return {
            sql: `
                SELECT
                    ${ATTACHMENT_FIELDS.join(',\n                    ')}
                FROM attachment
                INNER JOIN message_attachment_join ON attachment.ROWID = message_attachment_join.attachment_id
                WHERE message_attachment_join.message_id IN (
                    ${placeholders}
                )
                AND (attachment.hide_attachment IS NULL OR attachment.hide_attachment = 0)
                ORDER BY message_attachment_join.message_id ASC, message_attachment_join.attachment_id ASC
            `,
            params: messageIds,
        }
    },

    buildMaxRowIdQuery() {
        return { sql: 'SELECT MAX(ROWID) AS max_id FROM message', params: [] }
    },

    buildChatBackfillQuery(messageIds: readonly number[]) {
        const placeholders = messageIds.map(() => '?').join(',')

        // Same chat-resolution logic as buildMessageQuery: pick the lowest
        // ROWID chat per message. Runs a moment later so chat_message_join
        // has had time to commit.
        return {
            sql: `
                SELECT
                    chat_message_join.message_id AS message_rowid,
                    chat.chat_identifier AS chat_id,
                    chat.guid AS chat_guid,
                    chat.style AS chat_style
                FROM chat_message_join
                INNER JOIN chat ON chat.ROWID = chat_message_join.chat_id
                WHERE chat_message_join.message_id IN (${placeholders})
                    AND chat_message_join.chat_id = (
                        SELECT MIN(inner_join.chat_id)
                        FROM chat_message_join inner_join
                        WHERE inner_join.message_id = chat_message_join.message_id
                    )
            `,
            params: messageIds,
        }
    },
}
