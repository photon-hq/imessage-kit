/**
 * Outgoing message tracking.
 *
 * Tracks sent messages and resolves when they appear in the database.
 * MessagePromise wraps a single send; OutgoingMessageManager manages
 * the collection with O(1) lookup by coreIdentifier.
 */

import { ChatId } from '../../domain/chat-id'
import type { Message } from '../../domain/message'

// -----------------------------------------------
// MessagePromiseRejection
// -----------------------------------------------

class MessagePromiseRejection extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = this.constructor.name

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor)
        }
    }
}

// -----------------------------------------------
// MessagePromise
// -----------------------------------------------

export interface MessagePromiseOptions {
    readonly chatId: string
    readonly text?: string
    readonly attachmentName?: string
    readonly isAttachment: boolean
    readonly sentAt: Date | number
    readonly debug?: boolean
    readonly timeout?: number
}

/**
 * Promise wrapper for tracking a single outgoing message.
 */
export class MessagePromise {
    readonly promise: Promise<Message>

    private resolvePromise!: (value: Message) => void
    private rejectPromise!: (reason: MessagePromiseRejection) => void

    readonly chatId: string
    readonly coreChatId: string
    readonly text: string
    readonly attachmentName: string | null
    readonly isAttachment: boolean
    readonly sentAt: number

    private readonly debug: boolean

    isResolved = false
    errored = false
    error: Error | null = null

    private readonly timeoutHandle: NodeJS.Timeout

    constructor(options: MessagePromiseOptions) {
        this.debug = options.debug ?? false
        this.chatId = options.chatId
        this.coreChatId = ChatId.fromUserInput(options.chatId).coreIdentifier
        this.text = normalizeText(options.text ?? '')
        this.attachmentName = options.attachmentName ?? null
        this.isAttachment = options.isAttachment
        this.sentAt = typeof options.sentAt === 'number' ? options.sentAt : options.sentAt.getTime()

        this.promise = new Promise((resolve, reject) => {
            this.resolvePromise = resolve
            this.rejectPromise = reject
        })

        this.promise.catch((err: unknown) => {
            this.errored = true
            this.error = err instanceof Error ? err : new Error(String(err))
        })

        const timeout = options.timeout ?? (this.isAttachment ? 30_000 : 10_000)

        this.timeoutHandle = setTimeout(() => {
            if (!this.isResolved) {
                this.reject(`Message send timeout after ${timeout}ms`)
            }
        }, timeout)

        this.timeoutHandle.unref?.()
    }

    // -----------------------------------------------
    // Resolve / Reject
    // -----------------------------------------------

    resolve(message: Message): void {
        if (this.isResolved) return

        this.isResolved = true
        clearTimeout(this.timeoutHandle)
        this.resolvePromise(message)
    }

    reject(reason: string): void {
        if (this.isResolved) return

        this.isResolved = true
        clearTimeout(this.timeoutHandle)
        this.rejectPromise(new MessagePromiseRejection(reason))
    }

    // -----------------------------------------------
    // Matching
    // -----------------------------------------------

    /** Check whether a database message corresponds to this outgoing send. */
    matches(message: Message): boolean {
        const timeDiff = message.createdAt.getTime() - this.sentAt

        if (timeDiff < -5_000 || timeDiff > 120_000) {
            if (this.debug) console.log('[MessagePromise] Time check failed:', { timeDiff })
            return false
        }

        if (!this.matchesChatId(message.chatId)) {
            if (this.debug) {
                console.log('[MessagePromise] ChatId mismatch:', {
                    expected: this.chatId,
                    actual: message.chatId,
                })
            }
            return false
        }

        if (this.isAttachment) {
            if (!message.attachments || message.attachments.length === 0) {
                if (this.debug) console.log('[MessagePromise] No attachments in message')
                return false
            }

            if (this.attachmentName) {
                const expected = filenameWithoutExt(this.attachmentName).toLowerCase()

                const match = message.attachments.some((att) => {
                    const actual = filenameWithoutExt(att.fileName).toLowerCase()
                    return actual === expected
                })

                if (this.debug) {
                    console.log('[MessagePromise] Attachment match:', {
                        expected,
                        actual: message.attachments.map((a) => filenameWithoutExt(a.fileName).toLowerCase()),
                        match,
                    })
                }

                return match
            }

            return true
        }

        const messageText = normalizeText(message.text ?? '')
        const matches = this.text === messageText

        if (this.debug) {
            console.log('[MessagePromise] Text match:', { expected: this.text, actual: messageText, matches })
        }

        return matches
    }

    private matchesChatId(chatId: string): boolean {
        if (chatId === this.chatId) return true
        return ChatId.fromUserInput(chatId).coreIdentifier === this.coreChatId
    }
}

// -----------------------------------------------
// OutgoingMessageManager
// -----------------------------------------------

/**
 * Manages pending outgoing messages with O(1) lookup by chat coreIdentifier.
 *
 * Structurally satisfies the OutgoingMatcher interface from the application layer
 * (tryMatch + cleanup methods).
 */
export class OutgoingMessageManager {
    private readonly byChat = new Map<string, MessagePromise[]>()
    private readonly debug: boolean

    constructor(debug = false) {
        this.debug = debug
    }

    add(promise: MessagePromise): void {
        const key = promise.coreChatId
        const list = this.byChat.get(key)

        if (list) {
            list.push(promise)
        } else {
            this.byChat.set(key, [promise])
        }

        if (this.debug) {
            const type = promise.isAttachment ? 'attachment' : 'message'
            console.log(`[OutgoingManager] Tracking new ${type}: ${promise.chatId}`)
        }
    }

    tryMatch(message: Message): boolean {
        if (!message.isFromMe) return false

        const key = ChatId.fromUserInput(message.chatId).coreIdentifier
        const promises = this.byChat.get(key)
        if (!promises) return false

        for (const promise of promises) {
            if (promise.isResolved) continue

            if (promise.matches(message)) {
                if (this.debug) {
                    console.log(`[OutgoingManager] Matched message: ${message.rowId}`)
                }
                promise.resolve(message)
                return true
            }
        }

        return false
    }

    cleanup(): void {
        const now = Date.now()
        const resolvedCutoff = now - 60_000
        const staleCutoff = now - 120_000

        for (const [key, promises] of this.byChat.entries()) {
            const remaining = promises.filter((p) => {
                // Remove resolved promises older than 60s
                if (p.isResolved) return p.sentAt > resolvedCutoff

                // Remove unresolved promises older than 120s (leaked/abandoned)
                return p.sentAt > staleCutoff
            })

            remaining.length ? this.byChat.set(key, remaining) : this.byChat.delete(key)
        }
    }

    getPendingCount(): number {
        let count = 0

        for (const promises of this.byChat.values()) {
            for (const p of promises) {
                if (!p.isResolved) count++
            }
        }

        return count
    }

    rejectAll(reason = 'SDK closed'): void {
        for (const promises of this.byChat.values()) {
            for (const promise of promises) {
                if (!promise.isResolved) {
                    promise.reject(reason)
                }
            }
        }

        this.byChat.clear()
    }
}

// -----------------------------------------------
// Pure Helpers
// -----------------------------------------------

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function filenameWithoutExt(filename: string | null): string {
    const base = (filename ?? '').split(/[\\/]/).pop() ?? ''
    const lastDot = base.lastIndexOf('.')
    return lastDot === -1 ? base : base.substring(0, lastDot)
}
