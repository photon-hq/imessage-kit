/**
 * Message Promise
 *
 * Tracks outgoing messages and resolves when they appear in the database
 */

import type { Message } from '../types/message'

export class MessagePromiseRejection extends Error {
    readonly error: string
    readonly msg: Message | null
    readonly tempGuid: string | null

    constructor(error: string, message?: Message, tempGuid?: string) {
        super(error)
        this.name = this.constructor.name
        this.error = error
        this.msg = message ?? null
        this.tempGuid = tempGuid ?? null
        Error.captureStackTrace(this, this.constructor)
    }
}

export interface MessagePromiseOptions {
    chatId: string
    text?: string
    attachmentName?: string
    isAttachment: boolean
    sentAt: Date | number
    debug?: boolean
}

/**
 * Promise wrapper for tracking outgoing messages
 */
export class MessagePromise {
    promise: Promise<Message>

    private resolvePromise!: (value: Message) => void
    private rejectPromise!: (reason: MessagePromiseRejection) => void

    readonly chatId: string
    readonly text: string
    readonly attachmentName: string | null
    readonly isAttachment: boolean
    readonly sentAt: number
    private readonly debug: boolean

    isResolved = false
    errored = false
    error: any = null

    private timeoutHandle: NodeJS.Timeout

    constructor(options: MessagePromiseOptions) {
        this.debug = options.debug ?? false
        this.chatId = options.chatId
        this.text = this.normalizeText(options.text ?? '')
        this.attachmentName = options.attachmentName ?? null
        this.isAttachment = options.isAttachment
        this.sentAt = typeof options.sentAt === 'number' ? options.sentAt : options.sentAt.getTime()

        this.promise = new Promise((resolve, reject) => {
            this.resolvePromise = resolve
            this.rejectPromise = reject
        })

        this.promise.catch((err: any) => {
            this.errored = true
            this.error = err
        })

        // Timeout configuration:
        // - Attachments: 30 seconds (longer due to file upload time, especially for large files)
        // - Text messages: 10 seconds (typically faster, only text data to send)
        // These values account for AppleScript execution, Messages app processing,
        // and database write delays. Adjust if experiencing frequent timeouts.
        const timeout = this.isAttachment ? 30 * 1000 : 10 * 1000
        this.timeoutHandle = setTimeout(() => {
            if (!this.isResolved) {
                this.reject(`Message send timeout after ${timeout}ms`)
            }
        }, timeout)
    }

    /**
     * Normalize text for comparison
     * Only remove whitespace and convert to lowercase for case-insensitive matching
     * Keep all other characters including Unicode (Chinese, emoji, etc.)
     */
    private normalizeText(text: string): string {
        return text.replace(/\s+/g, '').toLowerCase()
    }

    /**
     * Get filename without extension
     */
    private getFilenameWithoutExtension(filename: string): string {
        const lastDot = filename.lastIndexOf('.')
        if (lastDot === -1) return filename
        return filename.substring(0, lastDot)
    }

    /**
     * Resolve the promise with the sent message
     */
    resolve(message: Message): void {
        if (this.isResolved) return

        this.isResolved = true
        clearTimeout(this.timeoutHandle)
        this.resolvePromise(message)
    }

    /**
     * Reject the promise with an error
     */
    reject(reason: string, message?: Message): void {
        if (this.isResolved) return

        this.isResolved = true
        clearTimeout(this.timeoutHandle)
        this.rejectPromise(new MessagePromiseRejection(reason, message))
    }

    /**
     * Check if this promise matches the given message
     */
    matches(message: Message): boolean {
        // Check if message is too old (sent before this promise was created)
        const timeDiff = message.date.getTime() - this.sentAt
        if (timeDiff < -5000) {
            if (this.debug) console.log('[MessagePromise] Time check failed:', { timeDiff, tooOld: true })
            return false
        }

        // Check chat ID
        if (!this.matchesChatId(message.chatId)) {
            if (this.debug)
                console.log('[MessagePromise] ChatId mismatch:', {
                    expected: this.chatId,
                    actual: message.chatId,
                })
            return false
        }

        // Check attachment
        if (this.isAttachment) {
            if (!message.attachments || message.attachments.length === 0) {
                if (this.debug) console.log('[MessagePromise] No attachments in message')
                return false
            }

            // Match by attachment filename
            if (this.attachmentName) {
                const normalizedName = this.getFilenameWithoutExtension(this.attachmentName).toLowerCase()
                const match = message.attachments.some((att) => {
                    const attName = this.getFilenameWithoutExtension(att.filename).toLowerCase()
                    return attName === normalizedName
                })
                if (this.debug)
                    console.log('[MessagePromise] Attachment match:', {
                        expected: normalizedName,
                        actual: message.attachments.map((a) =>
                            this.getFilenameWithoutExtension(a.filename).toLowerCase()
                        ),
                        match,
                    })
                return match
            }

            return true
        }

        // Check text content
        const messageText = this.normalizeText(message.text ?? '')
        const matches = this.text === messageText

        if (this.debug) {
            console.log('[MessagePromise] Text match:', {
                expected: this.text,
                actual: messageText,
                matches,
                originalText: message.text,
            })
        }

        return matches
    }

    /**
     * Check if chat ID matches (handles different formats)
     */
    private matchesChatId(chatId: string): boolean {
        if (chatId === this.chatId) return true

        // Handle different chat ID formats
        // e.g., "iMessage;+;chat123" vs "chat123"
        const normalized1 = this.normalizeChatId(chatId)
        const normalized2 = this.normalizeChatId(this.chatId)

        return normalized1 === normalized2
    }

    /**
     * Normalize chat ID for comparison
     *
     * Handles format differences between what we construct and what's in the database:
     *
     * Database stores (from message.chatId):
     * - DM: "pilot@photon.codes" (no prefix)
     * - Group: "chat493787071395575843" (no prefix)
     *
     * We construct (in sender.ts):
     * - DM: "iMessage;-;pilot@photon.codes"
     * - Group: "iMessage;+;chat493787071395575843" or just the GUID
     *
     * This method extracts the core identifier (last part after semicolons) to ensure
     * both formats match correctly. For example:
     * - "iMessage;-;pilot@photon.codes" → "pilot@photon.codes"
     * - "pilot@photon.codes" → "pilot@photon.codes"
     * Both normalize to the same value, enabling successful matching.
     */
    private normalizeChatId(chatId: string): string {
        // Extract the core identifier (everything after last semicolon, or the whole string)
        if (chatId.includes(';')) {
            const parts = chatId.split(';')
            // For "iMessage;+;chat123", return "chat123"
            // For "iMessage;pilot@photon.codes", return "pilot@photon.codes"
            // For "iMessage;-;pilot@photon.codes", return "pilot@photon.codes"
            return parts[parts.length - 1] ?? chatId
        }
        return chatId
    }
}
