/**
 * Message Sender
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Recipient } from '../types/advanced'
import { isURL as checkIsURL } from '../types/advanced'
import type { RetryConfig } from '../types/config'
import {
    checkIMessageStatus,
    checkMessagesApp,
    execAppleScript,
    generateSendAttachmentScript,
    generateSendTextScript,
    generateSendWithAttachmentScript,
} from '../utils/applescript'
import { delay, validateMessageContent } from '../utils/common'
import { convertToCompatibleFormat, downloadImage } from '../utils/download'
import { Semaphore } from '../utils/semaphore'
import { IMessageError, SendError } from './errors'

/** Send result */
export interface SendResult {
    readonly sentAt: Date
}

/** Send options */
export interface SendOptions {
    /** Recipient */
    readonly to: string | Recipient
    /** Text content */
    readonly text?: string
    /** Attachments */
    readonly attachments?: readonly string[]
    /** Abort signal (optional) */
    readonly signal?: AbortSignal
}

/**
 * Message Sender Class
 */
export class MessageSender {
    /** Debug mode */
    private readonly debug: boolean
    /** Maximum retry attempts */
    private readonly maxRetries: number
    /** Retry delay */
    private readonly retryDelay: number
    /** Concurrency limiter */
    private readonly semaphore: Semaphore | null
    /** AppleScript timeout */
    private readonly scriptTimeout: number

    constructor(debug = false, retryConfig?: Required<RetryConfig>, maxConcurrent = 5, scriptTimeout = 30000) {
        this.debug = debug
        this.maxRetries = retryConfig?.max ?? 2
        this.retryDelay = retryConfig?.delay ?? 1500
        this.semaphore = maxConcurrent > 0 ? new Semaphore(maxConcurrent) : null
        this.scriptTimeout = scriptTimeout
    }

    /**
     * Execute script with retry
     *
     * @param script AppleScript code
     * @param description Operation description
     * @returns Execution result
     */
    private async executeWithRetry(script: string, description: string): Promise<void> {
        let lastError: Error | null = null

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    await delay(this.retryDelay)
                }

                await execAppleScript(script, this.debug, this.scriptTimeout)
                return
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error))
            }
        }

        const errorMsg = lastError?.message || 'unknown error'
        throw SendError(`${description} failed (retried ${this.maxRetries} times): ${errorMsg}`)
    }

    /**
     * Resolve attachment path
     * - Download network images (HTTP URL) → ~/Pictures/imsg_temp_*
     * - Validate local file path
     * - Auto-convert incompatible formats (AVIF/WebP -> JPEG) → ~/Pictures/imsg_temp_*
     *
     * Note: All temporary files are automatically named imsg_temp_* and stored in ~/Pictures
     *       TempFileManager will automatically scan and clean up these files, no manual tracking needed
     *
     * @param path Attachment path (local path or HTTP URL)
     * @returns Local path
     */
    private async resolveAttachment(path: string): Promise<string> {
        if (checkIsURL(path)) {
            // Download network image (auto-converts incompatible formats)
            return await downloadImage(path, { debug: this.debug })
        }

        // Handle local file
        const localPath = resolve(path)
        if (!existsSync(localPath)) {
            throw SendError(`File not found: ${path}`)
        }

        // Convert incompatible formats (AVIF/WebP -> JPEG) for local files
        const converted = await convertToCompatibleFormat(localPath)

        if (converted.converted && this.debug) {
            const originalFile = localPath.split('/').pop()
            const convertedFile = converted.path.split('/').pop()
            console.log(`[Format Conversion] ${originalFile} -> ${convertedFile}`)
        }

        return converted.path
    }

    /**
     * Send message
     */
    async send(options: SendOptions): Promise<SendResult> {
        if (this.semaphore) {
            return await this.semaphore.run(() => this.sendInternal(options))
        }
        return await this.sendInternal(options)
    }

    /**
     * Check abort signal
     */
    private checkAbortSignal(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw SendError('Send cancelled')
        }
    }

    /**
     * Check Messages environment
     */
    private async checkMessagesEnvironment(): Promise<void> {
        const isAvailable = await checkMessagesApp()

        if (!isAvailable) {
            throw SendError('Messages app is not running')
        }

        // Check iMessage account status (debug mode)
        if (this.debug) {
            const iMessageActive = await checkIMessageStatus(this.debug)

            if (!iMessageActive) {
                console.warn(
                    '[Warning] iMessage account may not be logged in or activated, ' +
                        'messages may show "Not Delivered"'
                )
                console.warn('[Suggestion] Open Messages app > Settings > iMessage, ' + 'ensure Apple ID is logged in')
            }
        }
    }

    /**
     * Prepare all attachments (download, convert)
     */
    private async prepareAttachments(attachments: readonly string[]): Promise<string[]> {
        if (attachments.length === 0) {
            return []
        }

        if (this.debug) {
            console.log(`[Processing Attachments] Total ${attachments.length} attachments`)
        }

        const resolvedPaths: string[] = []

        for (let i = 0; i < attachments.length; i++) {
            const attachment = attachments[i]!

            if (this.debug) {
                const attachmentPreview = attachment.length > 80 ? `${attachment.slice(0, 80)}...` : attachment

                console.log(`[Processing Attachments] ${i + 1}/${attachments.length}: ${attachmentPreview}`)
            }

            const resolved = await this.resolveAttachment(attachment)
            resolvedPaths.push(resolved)
        }

        return resolvedPaths
    }

    /**
     * Execute send strategy
     */
    private async executeSendStrategy(
        recipient: string,
        text: string | undefined,
        hasText: boolean,
        resolvedPaths: string[]
    ): Promise<void> {
        if (hasText && resolvedPaths.length > 0) {
            // Strategy 1: Text + Attachments
            const firstAttachment = resolvedPaths[0]!
            const { script } = generateSendWithAttachmentScript(recipient, text!, firstAttachment)
            await this.executeWithRetry(script, `Send text and attachment to ${recipient}`)

            // Send remaining attachments
            for (let i = 1; i < resolvedPaths.length; i++) {
                const { script: attachScript } = generateSendAttachmentScript(recipient, resolvedPaths[i]!, this.debug)
                await this.executeWithRetry(attachScript, `Send attachment ${i + 1}/${resolvedPaths.length}`)
            }
        } else if (hasText) {
            // Strategy 2: Text only
            const script = generateSendTextScript(recipient, text!)
            await this.executeWithRetry(script, `Send text to ${recipient}`)
        } else {
            // Strategy 3: Attachments only
            for (let i = 0; i < resolvedPaths.length; i++) {
                const { script } = generateSendAttachmentScript(recipient, resolvedPaths[i]!, this.debug)
                const description = `Send attachment ${i + 1}/${resolvedPaths.length} to ${recipient}`
                await this.executeWithRetry(script, description)
            }
        }
    }

    /**
     * Send message (internal implementation)
     */
    private async sendInternal(options: SendOptions): Promise<SendResult> {
        const { to, text, attachments = [], signal } = options
        const recipient = String(to)

        this.checkAbortSignal(signal)

        // Validate message content
        let hasText: boolean
        try {
            const validation = validateMessageContent(text, attachments)
            hasText = validation.hasText
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            throw SendError(errorMsg)
        }

        try {
            this.checkAbortSignal(signal)

            // Check environment
            await this.checkMessagesEnvironment()

            // Prepare attachments
            const resolvedPaths = await this.prepareAttachments(attachments)

            // Execute send
            await this.executeSendStrategy(recipient, text, hasText, resolvedPaths)

            return { sentAt: new Date() }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            const contextInfo =
                `[Recipient: ${recipient}] ` +
                `[Text: ${hasText ? 'yes' : 'no'}] ` +
                `[Attachments: ${attachments.length}]`

            if (error instanceof IMessageError) {
                throw SendError(`${errorMsg} ${contextInfo}`)
            }

            throw SendError(`Send failed ${contextInfo}: ${errorMsg}`)
        }
    }

    async text(to: string | Recipient, text: string): Promise<SendResult> {
        return this.send({ to, text })
    }

    async image(to: string | Recipient, imagePath: string): Promise<SendResult> {
        return this.send({ to, attachments: [imagePath] })
    }

    async textWithImages(to: string | Recipient, text: string | undefined, imagePaths: string[]): Promise<SendResult> {
        return this.send({
            to,
            text,
            attachments: imagePaths,
        })
    }
}
