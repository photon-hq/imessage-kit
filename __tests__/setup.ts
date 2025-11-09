/**
 * Test Setup and Utilities
 *
 * Provides mock implementations and test utilities for SDK testing
 * Supports both Bun and Node.js runtimes
 */

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Runtime detection for test database
 */
type DatabaseAdapter = any
type DatabaseConstructor = new (path: string, options?: any) => DatabaseAdapter

let Database: DatabaseConstructor

async function initTestDatabase() {
    if (Database) return

    if (typeof Bun !== 'undefined') {
        // Bun runtime
        const bunSqlite = await import('bun:sqlite')
        Database = bunSqlite.Database
    } else {
        // Node.js runtime
        const BetterSqlite3 = await import('better-sqlite3')
        Database = BetterSqlite3.default || BetterSqlite3
    }
}

// Initialize on module load
await initTestDatabase()

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
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_identifier TEXT,
            display_name TEXT,
            guid TEXT,
            service_name TEXT
        );

        CREATE TABLE IF NOT EXISTS message (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT NOT NULL UNIQUE,
            text TEXT,
            attributedBody BLOB,
            handle_id INTEGER,
            service TEXT,
            date INTEGER,
            is_read INTEGER DEFAULT 0,
            is_from_me INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chat_message_join (
            chat_id INTEGER,
            message_id INTEGER,
            PRIMARY KEY (chat_id, message_id)
        );

        CREATE TABLE IF NOT EXISTS chat_handle_join (
            chat_id INTEGER,
            handle_id INTEGER,
            PRIMARY KEY (chat_id, handle_id)
        );

        CREATE TABLE IF NOT EXISTS attachment (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            mime_type TEXT,
            total_bytes INTEGER,
            created_date INTEGER
        );

        CREATE TABLE IF NOT EXISTS message_attachment_join (
            message_id INTEGER,
            attachment_id INTEGER,
            PRIMARY KEY (message_id, attachment_id)
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
    } = options

    // Insert or get handle
    const handleResult = db.query('SELECT ROWID FROM handle WHERE id = ?').get(sender)
    let handleId: number

    if (handleResult) {
        handleId = (handleResult as any).ROWID
    } else {
        const insertHandle = db.prepare('INSERT INTO handle (id) VALUES (?)')
        insertHandle.run(sender)
        handleId = db.query('SELECT last_insert_rowid() as id').get() as any
        handleId = (handleId as any).id
    }

    // Insert chat; if chatGuid provided, treat as group GUID. service_name mirrors message.service
    const insertChat = db.prepare(
        'INSERT INTO chat (chat_identifier, display_name, guid, service_name) VALUES (?, ?, ?, ?)'
    )
    insertChat.run(sender, null, chatGuid ?? null, service)
    let chatId = db.query('SELECT last_insert_rowid() as id').get() as any
    chatId = (chatId as any).id

    // Convert to Mac timestamp (nanoseconds since 2001-01-01)
    const MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()
    const macTimestamp = (date - MAC_EPOCH) * 1000000

    // Insert message
    const guid = `test-${Date.now()}-${Math.random()}`
    const insertMessage = db.prepare(`
        INSERT INTO message (guid, text, handle_id, service, date, is_read, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    insertMessage.run(guid, text, handleId, service, macTimestamp, isRead ? 1 : 0, isFromMe ? 1 : 0)
    let messageId = db.query('SELECT last_insert_rowid() as id').get() as any
    messageId = (messageId as any).id

    // Link message to chat
    const insertJoin = db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)')
    insertJoin.run(chatId, messageId)

    // Link primary handle to chat
    const insertHandleJoin = db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)')
    insertHandleJoin.run(chatId, handleId)

    // Optionally link additional participants to simulate group chat
    for (const p of participants) {
        const hr = db.query('SELECT ROWID FROM handle WHERE id = ?').get(p)
        let hid: number
        if (hr) {
            hid = (hr as any).ROWID
        } else {
            const insH = db.prepare('INSERT INTO handle (id) VALUES (?)')
            insH.run(p)
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
 * Create a mock webhook server
 */
export class MockWebhookServer {
    private requests: Array<{ body: any; headers: Record<string, string> }> = []

    constructor(public readonly port: number = 3456) {}

    getRequests() {
        return this.requests
    }

    reset() {
        this.requests = []
    }

    // Simulate receiving a webhook
    async receive(body: any, headers: Record<string, string> = {}) {
        this.requests.push({ body, headers })
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
