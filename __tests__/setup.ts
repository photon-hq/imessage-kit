/**
 * Test Setup and Utilities
 *
 * Provides mock implementations and test utilities for SDK testing
 * Supports both Bun and Node.js runtimes
 */

import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHAT_STYLE_DM, CHAT_STYLE_GROUP } from '../src/domain/chat'

type DatabaseAdapter = Database

/**
 * Create a temporary directory for tests
 */
export function createTempDir(): string {
    const tempPath = join(tmpdir(), `imessage-sdk-test-${Date.now()}`)
    mkdirSync(tempPath, { recursive: true })
    return tempPath
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(path: string) {
    try {
        rmSync(path, { recursive: true, force: true })
    } catch (error) {
        console.warn(`Failed to cleanup ${path}:`, error)
    }
}

/**
 * Create a mock iMessage database with test data
 */
export function createMockDatabase(): { db: DatabaseAdapter; path: string; cleanup: () => void } {
    const tempPath = join(tmpdir(), `test-imessage-${Date.now()}.db`)
    const db = new Database(tempPath)

    // Create tables matching macOS Messages database schema
    db.exec(`
        CREATE TABLE IF NOT EXISTS handle (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
            id TEXT NOT NULL,
            country TEXT,
            service TEXT NOT NULL,
            uncanonicalized_id TEXT,
            person_centric_id TEXT,
            UNIQUE (id, service)
        );

        CREATE TABLE IF NOT EXISTS chat (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT UNIQUE NOT NULL,
            style INTEGER,
            state INTEGER,
            account_id TEXT,
            properties BLOB,
            chat_identifier TEXT,
            service_name TEXT,
            room_name TEXT,
            account_login TEXT,
            is_archived INTEGER DEFAULT 0,
            last_addressed_handle TEXT,
            display_name TEXT,
            group_id TEXT,
            is_filtered INTEGER,
            successful_query INTEGER,
            engram_id TEXT,
            server_change_token TEXT,
            ck_sync_state INTEGER DEFAULT 0,
            original_group_id TEXT,
            last_read_message_timestamp INTEGER DEFAULT 0,
            cloudkit_record_id TEXT,
            last_addressed_sim_id TEXT,
            is_blackholed INTEGER DEFAULT 0,
            syndication_date INTEGER DEFAULT 0,
            syndication_type INTEGER DEFAULT 0,
            is_recovered INTEGER DEFAULT 0,
            is_deleting_incoming_messages INTEGER DEFAULT 0,
            is_pending_review INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS message (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT NOT NULL UNIQUE,
            text TEXT,
            replace INTEGER DEFAULT 0,
            service_center TEXT,
            handle_id INTEGER DEFAULT 0,
            attributedBody BLOB,
            subject TEXT,
            country TEXT,
            version INTEGER DEFAULT 0,
            type INTEGER DEFAULT 0,
            service TEXT,
            account TEXT,
            account_guid TEXT,
            error INTEGER DEFAULT 0,
            date INTEGER,
            date_read INTEGER,
            date_delivered INTEGER,
            is_delivered INTEGER DEFAULT 0,
            is_finished INTEGER DEFAULT 0,
            is_emote INTEGER DEFAULT 0,
            is_from_me INTEGER DEFAULT 0,
            is_empty INTEGER DEFAULT 0,
            is_delayed INTEGER DEFAULT 0,
            is_auto_reply INTEGER DEFAULT 0,
            is_prepared INTEGER DEFAULT 0,
            is_read INTEGER DEFAULT 0,
            is_sent INTEGER DEFAULT 0,
            has_dd_results INTEGER DEFAULT 0,
            is_service_message INTEGER DEFAULT 0,
            is_forward INTEGER DEFAULT 0,
            was_downgraded INTEGER DEFAULT 0,
            is_system_message INTEGER DEFAULT 0,
            is_archive INTEGER DEFAULT 0,
            cache_has_attachments INTEGER DEFAULT 0,
            cache_roomnames TEXT,
            was_data_detected INTEGER DEFAULT 0,
            was_deduplicated INTEGER DEFAULT 0,
            is_audio_message INTEGER DEFAULT 0,
            is_played INTEGER DEFAULT 0,
            date_played INTEGER,
            item_type INTEGER DEFAULT 0,
            other_handle INTEGER DEFAULT 0,
            group_title TEXT,
            group_action_type INTEGER DEFAULT 0,
            share_status INTEGER DEFAULT 0,
            share_direction INTEGER DEFAULT 0,
            is_expirable INTEGER DEFAULT 0,
            expire_state INTEGER DEFAULT 0,
            message_action_type INTEGER DEFAULT 0,
            message_source INTEGER DEFAULT 0,
            associated_message_guid TEXT,
            associated_message_type INTEGER DEFAULT 0,
            balloon_bundle_id TEXT,
            payload_data BLOB,
            expressive_send_style_id TEXT,
            associated_message_range_location INTEGER DEFAULT 0,
            associated_message_range_length INTEGER DEFAULT 0,
            time_expressive_send_played INTEGER,
            message_summary_info BLOB,
            ck_sync_state INTEGER DEFAULT 0,
            ck_record_id TEXT,
            ck_record_change_tag TEXT,
            destination_caller_id TEXT,
            is_corrupt INTEGER DEFAULT 0,
            reply_to_guid TEXT,
            sort_id INTEGER,
            is_spam INTEGER DEFAULT 0,
            has_unseen_mention INTEGER DEFAULT 0,
            thread_originator_guid TEXT,
            thread_originator_part TEXT,
            syndication_ranges TEXT,
            synced_syndication_ranges TEXT,
            was_delivered_quietly INTEGER DEFAULT 0,
            did_notify_recipient INTEGER DEFAULT 0,
            date_retracted INTEGER,
            date_edited INTEGER,
            date_recovered INTEGER,
            was_detonated INTEGER DEFAULT 0,
            part_count INTEGER,
            is_stewie INTEGER DEFAULT 0,
            is_sos INTEGER DEFAULT 0,
            is_critical INTEGER DEFAULT 0,
            bia_reference_id TEXT,
            is_kt_verified INTEGER DEFAULT 0,
            fallback_hash TEXT,
            associated_message_emoji TEXT,
            is_pending_satellite_send INTEGER DEFAULT 0,
            needs_relay INTEGER DEFAULT 0,
            schedule_type INTEGER DEFAULT 0,
            schedule_state INTEGER DEFAULT 0,
            sent_or_received_off_grid INTEGER DEFAULT 0,
            is_time_sensitive INTEGER DEFAULT 0,
            ck_chat_id TEXT,
            index_state INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chat_message_join (
            chat_id INTEGER,
            message_id INTEGER,
            message_date INTEGER DEFAULT 0,
            index_state INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (chat_id, message_id)
        );

        CREATE TABLE IF NOT EXISTS chat_handle_join (
            chat_id INTEGER,
            handle_id INTEGER,
            UNIQUE(chat_id, handle_id)
        );

        CREATE TABLE IF NOT EXISTS attachment (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT NOT NULL UNIQUE,
            created_date INTEGER DEFAULT 0,
            start_date INTEGER DEFAULT 0,
            filename TEXT,
            uti TEXT,
            mime_type TEXT,
            transfer_state INTEGER DEFAULT 0,
            is_outgoing INTEGER DEFAULT 0,
            user_info BLOB,
            transfer_name TEXT,
            total_bytes INTEGER DEFAULT 0,
            is_sticker INTEGER DEFAULT 0,
            sticker_user_info BLOB,
            attribution_info BLOB,
            hide_attachment INTEGER DEFAULT 0,
            ck_sync_state INTEGER DEFAULT 0,
            ck_server_change_token_blob BLOB,
            ck_record_id TEXT,
            original_guid TEXT,
            is_commsafety_sensitive INTEGER DEFAULT 0,
            emoji_image_content_identifier TEXT,
            emoji_image_short_description TEXT,
            preview_generation_state INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS message_attachment_join (
            message_id INTEGER,
            attachment_id INTEGER,
            UNIQUE(message_id, attachment_id)
        );
    `)

    const cleanup = () => {
        db.close()
        try {
            rmSync(tempPath, { force: true })
        } catch {}
    }

    return { db, path: tempPath, cleanup }
}

/**
 * Insert test message into mock database
 */
export function insertTestMessage(
    db: DatabaseAdapter,
    options: {
        text: string
        sender: string
        isRead?: boolean
        isFromMe?: boolean
        service?: string
        date?: number
        chatGuid?: string
        participants?: string[]
        /** Reaction type: 2000=love, 2001=like, 2002=dislike, 2003=laugh, 2004=emphasize, 2005=question, 2006=emoji, 2007=sticker */
        associatedMessageType?: number
        /** GUID of the message being reacted to */
        associatedMessageGuid?: string
        /** Emoji character for emoji tapback (type 2006) */
        associatedMessageEmoji?: string
        /** Range within target message body (UTF-16 offsets; default 0,0) */
        associatedMessageRangeLocation?: number
        associatedMessageRangeLength?: number
    }
): number {
    const {
        text,
        sender,
        isRead = false,
        isFromMe = false,
        service = 'iMessage',
        date = Date.now(),
        chatGuid,
        participants = [],
        associatedMessageType = 0,
        associatedMessageGuid,
        associatedMessageEmoji,
        associatedMessageRangeLocation = 0,
        associatedMessageRangeLength = 0,
    } = options

    // Insert or get handle
    const handleResult = db.query('SELECT ROWID FROM handle WHERE id = ? AND service = ?').get(sender, service)
    let handleId: number

    if (handleResult) {
        handleId = (handleResult as any).ROWID
    } else {
        const insertHandle = db.prepare('INSERT INTO handle (id, service) VALUES (?, ?)')
        insertHandle.run(sender, service)
        handleId = db.query('SELECT last_insert_rowid() as id').get() as any
        handleId = (handleId as any).id
    }

    const resolvedChatGuid = chatGuid ?? `${service};-;${sender}`
    const isGroupChat = chatGuid != null || participants.length > 0
    const resolvedChatIdentifier = isGroupChat
        ? resolvedChatGuid.includes(';')
            ? (resolvedChatGuid.split(';').at(-1) ?? resolvedChatGuid)
            : resolvedChatGuid
        : sender
    const chatStyle = isGroupChat ? CHAT_STYLE_GROUP : CHAT_STYLE_DM

    // Insert or reuse chat; service_name mirrors message.service.
    const chatResult = db.query('SELECT ROWID FROM chat WHERE guid = ?').get(resolvedChatGuid)
    let chatId: number
    if (chatResult) {
        chatId = (chatResult as any).ROWID
    } else {
        const insertChat = db.prepare(
            'INSERT INTO chat (chat_identifier, display_name, guid, service_name, style) VALUES (?, ?, ?, ?, ?)'
        )
        insertChat.run(resolvedChatIdentifier, null, resolvedChatGuid, service, chatStyle)
        const insertedChatId = db.query('SELECT last_insert_rowid() as id').get() as any
        chatId = (insertedChatId as any).id
    }

    // Convert to Mac timestamp (nanoseconds since 2001-01-01)
    const MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()
    const macTimestamp = (date - MAC_EPOCH) * 1000000

    // Insert message
    const guid = `test-${Date.now()}-${Math.random()}`
    const insertMessage = db.prepare(`
        INSERT INTO message (guid, text, handle_id, service, date, is_read, is_from_me, associated_message_type, associated_message_guid, associated_message_emoji, associated_message_range_location, associated_message_range_length)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertMessage.run(
        guid,
        text,
        handleId,
        service,
        macTimestamp,
        isRead ? 1 : 0,
        isFromMe ? 1 : 0,
        associatedMessageType,
        associatedMessageGuid ?? null,
        associatedMessageEmoji ?? null,
        associatedMessageRangeLocation,
        associatedMessageRangeLength
    )
    let messageId = db.query('SELECT last_insert_rowid() as id').get() as any
    messageId = (messageId as any).id

    // Link message to chat
    const insertJoin = db.prepare('INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)')
    insertJoin.run(chatId, messageId, macTimestamp)

    // Link primary handle to chat
    const insertHandleJoin = db.prepare('INSERT OR IGNORE INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)')
    insertHandleJoin.run(chatId, handleId)

    // Optionally link additional participants to simulate group chat
    for (const p of participants) {
        const hr = db.query('SELECT ROWID FROM handle WHERE id = ? AND service = ?').get(p, service)
        let hid: number
        if (hr) {
            hid = (hr as any).ROWID
        } else {
            const insH = db.prepare('INSERT INTO handle (id, service) VALUES (?, ?)')
            insH.run(p, service)
            const last = db.query('SELECT last_insert_rowid() as id').get() as any
            hid = (last as any).id
        }
        insertHandleJoin.run(chatId, hid)
    }

    return messageId
}

/**
 * Mock AppleScript executor for testing
 */
export function mockAppleScript() {
    const calls: Array<{ script: string; args: string[] }> = []

    return {
        calls,
        execute: async (script: string, ...args: string[]) => {
            calls.push({ script, args })
            return ''
        },
        reset: () => {
            calls.length = 0
        },
    }
}

/**
 * Wait for condition to be true
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout = 5000,
    interval = 100
): Promise<void> {
    const start = Date.now()

    while (Date.now() - start < timeout) {
        if (await condition()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, interval))
    }

    throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Create a spy function that tracks calls
 */
export function createSpy<T extends (...args: any[]) => any>(implementation?: T) {
    const calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error }> = []

    const spy = ((...args: Parameters<T>) => {
        const call: any = { args }
        calls.push(call)
        if (implementation) {
            return implementation(...args)
        }
        return undefined
    }) as T

    return {
        fn: spy,
        calls,
        callCount: () => calls.length,
        getCalls: () => calls.map((c) => c.args[0]),
        reset: () => {
            calls.length = 0
        },
    }
}
