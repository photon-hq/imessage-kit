import { describe, expect, it } from 'bun:test'
import { rowToAttachment, rowToChat, rowToMessage } from '../src/infra/db/mapper'

const MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()

function toMacTimestamp(dateMs: number): number {
    return (dateMs - MAC_EPOCH) * 1_000_000
}

function createMessageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 1,
        guid: 'message-guid-1',
        text: 'hello',
        attributedBody: null,
        service: 'iMessage',
        is_from_me: 0,
        is_read: 1,
        is_sent: 1,
        is_delivered: 1,
        was_downgraded: 0,
        did_notify_recipient: 0,
        is_auto_reply: 0,
        is_system_message: 0,
        is_forward: 0,
        is_audio_message: 0,
        is_played: 0,
        is_expirable: 0,
        error: 0,
        is_spam: 0,
        is_kt_verified: 0,
        has_unseen_mention: 0,
        was_delivered_quietly: 0,
        is_sos: 0,
        is_critical: 0,
        sent_or_received_off_grid: 0,
        date: toMacTimestamp(Date.now()),
        date_delivered: 0,
        date_read: 0,
        date_played: 0,
        date_edited: 0,
        date_retracted: 0,
        date_recovered: 0,
        reply_to_guid: null,
        thread_originator_guid: null,
        group_title: null,
        expressive_send_style_id: null,
        balloon_bundle_id: null,
        destination_caller_id: null,
        ck_chat_id: null,
        was_detonated: 0,
        expire_state: 0,
        share_status: 0,
        share_direction: 0,
        schedule_type: 0,
        schedule_state: 0,
        part_count: 0,
        associated_message_type: 0,
        associated_message_guid: null,
        associated_message_emoji: null,
        associated_message_range_location: null,
        associated_message_range_length: null,
        item_type: 0,
        group_action_type: 0,
        participant: '+1234567890',
        affected_participant: null,
        chat_id: null,
        chat_guid: null,
        chat_service: null,
        ...overrides,
    }
}

function createAttachmentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        guid: 'attachment-guid-1',
        created_date: toMacTimestamp(Date.now()),
        filename: '~/Library/test.jpg',
        uti: 'public.jpeg',
        mime_type: 'image/jpeg',
        transfer_state: 3,
        is_outgoing: 0,
        transfer_name: 'test.jpg',
        total_bytes: 42,
        is_sticker: 0,
        is_commsafety_sensitive: 0,
        emoji_image_short_description: null,
        ...overrides,
    }
}

function createChatRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        guid: 'chat1234567890',
        chat_identifier: 'chat1234567890',
        service_name: 'iMessage',
        style: 43,
        account_login: null,
        is_archived: 0,
        is_filtered: 0,
        is_blackholed: 0,
        is_deleting_incoming_messages: 0,
        last_read_message_timestamp: 0,
        display_name: 'Test Chat',
        last_date: toMacTimestamp(Date.now()),
        unread_count: 1,
        ...overrides,
    }
}

describe('Messages DB Semantic Mapping', () => {
    it('parses numeric boolean flags explicitly instead of using JS truthiness', () => {
        const message = rowToMessage(
            createMessageRow({
                is_from_me: '0',
                is_read: '1',
                is_sent: '1',
                is_delivered: '0',
            }),
            []
        )

        expect(message.isFromMe).toBe(false)
        expect(message.isRead).toBe(true)
        expect(message.isSent).toBe(true)
        expect(message.isDelivered).toBe(false)
    })

    it('throws when a required message identifier is invalid', () => {
        expect(() => rowToMessage(createMessageRow({ id: 'bad-id' }), [])).toThrow(/message.id/)
        expect(() => rowToMessage(createMessageRow({ guid: '' }), [])).toThrow(/message.guid/)
    })

    it('throws when a required timestamp is missing instead of fabricating the macOS epoch', () => {
        expect(() => rowToMessage(createMessageRow({ date: null }), [])).toThrow(/message.date/)
        expect(() => rowToAttachment(createAttachmentRow({ created_date: null }))).toThrow(/attachment.created_date/)
    })

    it('keeps optional reaction ranges at 0,0 when the database leaves them unset', () => {
        const reaction = rowToMessage(
            createMessageRow({
                associated_message_type: 2000,
                associated_message_guid: 'target-guid',
                associated_message_range_location: null,
                associated_message_range_length: null,
            }),
            []
        ).reaction

        expect(reaction?.textRange.location).toBe(0)
        expect(reaction?.textRange.length).toBe(0)
    })

    it('throws when chat summary aggregates are malformed', () => {
        expect(() => rowToChat(createChatRow({ unread_count: 'bad-count' }))).toThrow(/chat.unread_count/)
    })
})
