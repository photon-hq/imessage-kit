/**
 * Message sender.
 *
 * Unified send pipeline implementing SendPort.
 * Resolves target internally (buddy vs chat method),
 * prepares attachments, executes AppleScript with retry,
 * and awaits database confirmation.
 */

import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { SendPort, SendRequest, SendResult } from '../../application/send-port'
import type { ChatServicePrefix } from '../../domain/chat-id'
import { ChatId } from '../../domain/chat-id'
import { IMessageError, SendError, toErrorMessage } from '../../domain/errors'
import type { Message } from '../../domain/message'
import { resolveTarget } from '../../domain/routing'
import { isURL, validateMessageContent } from '../../domain/validate'
import { delay, retry, type Semaphore } from '../../utils/async'
import { detectChatServicePrefix } from '../platform'
import { buildSendScript, checkMessagesApp, execAppleScript } from './applescript-transport'
import { convertToCompatibleFormat, downloadImage } from './downloader'
import { MessagePromise, type OutgoingMessageManager } from './tracker'

// -----------------------------------------------
// Send Defaults (inlined)
// -----------------------------------------------

const SEND_TIMEOUT_MS = 30_000
const RETRY_MAX_RETRIES = 2
const RETRY_DELAY_MS = 1_500

// -----------------------------------------------
// Types
// -----------------------------------------------

type SendTarget = { readonly method: 'buddy' | 'chat'; readonly identifier: string }

interface NormalizedSendJob {
    readonly target: SendTarget
    readonly chatId: string
    readonly service: 'iMessage'
    readonly text?: string
    readonly attachments: readonly string[]
    readonly signal?: AbortSignal
    readonly timeout?: number
    readonly label: string
}

/** Options for constructing a MessageSender. */
export interface MessageSenderOptions {
    readonly outgoingManager?: OutgoingMessageManager
    readonly semaphore?: Semaphore
    readonly debug?: boolean
    readonly timeout?: number
    readonly retryAttempts?: number
    readonly retryDelay?: number
}

function resolveRequestedService(service: SendRequest['service']): 'iMessage' {
    if (service == null || service === 'iMessage') {
        return 'iMessage'
    }

    throw SendError(`Outbound send service "${service}" is not supported`)
}

// -----------------------------------------------
// MessageSender
// -----------------------------------------------

/** Send orchestrator implementing the application-layer SendPort. */
export class MessageSender implements SendPort {
    private readonly debug: boolean
    private readonly maxRetries: number
    private readonly retryDelay: number
    private readonly semaphore: Semaphore | null
    private readonly sendTimeoutMs: number
    private readonly outgoingManager: OutgoingMessageManager | null
    private readonly chatServicePrefix: ChatServicePrefix

    constructor(options: MessageSenderOptions = {}) {
        this.debug = options.debug ?? false
        this.maxRetries = options.retryAttempts ?? RETRY_MAX_RETRIES
        this.retryDelay = options.retryDelay ?? RETRY_DELAY_MS
        this.semaphore = options.semaphore ?? null
        this.sendTimeoutMs = options.timeout ?? SEND_TIMEOUT_MS
        this.outgoingManager = options.outgoingManager ?? null
        this.chatServicePrefix = detectChatServicePrefix()
    }

    // -----------------------------------------------
    // Public API
    // -----------------------------------------------

    /** Send a message to a recipient or group chat. */
    async send(request: SendRequest): Promise<SendResult> {
        return this.executeSend(this.createSendJob(request))
    }

    // -----------------------------------------------
    // Send Pipeline
    // -----------------------------------------------

    private async executeSend(job: NormalizedSendJob): Promise<SendResult> {
        const { target, chatId, service, signal, timeout, label, text, attachments } = job
        const effectiveTimeout = timeout ?? this.sendTimeoutMs

        const task = async (): Promise<SendResult> => {
            this.checkAbortSignal(signal)

            let hasText: boolean

            try {
                const validation = validateMessageContent(text, attachments)
                hasText = validation.hasText
            } catch (error) {
                throw SendError(toErrorMessage(error))
            }

            try {
                this.checkAbortSignal(signal)

                await this.checkMessagesEnvironment()

                const paths = await this.prepareAttachments(attachments, signal)

                const sentAt = new Date()
                const messagePromise = this.createTrackingPromise(chatId, text, hasText, paths, sentAt)

                await this.executeAppleScripts(target, text, hasText, paths, effectiveTimeout, signal)

                const confirmedMessage = await this.awaitConfirmation(messagePromise)

                this.outgoingManager?.cleanup()

                return {
                    chatId,
                    to: target.identifier,
                    service,
                    sentAt,
                    message: confirmedMessage,
                }
            } catch (error) {
                const errorMsg = toErrorMessage(error)
                const context = `[${label}] [Text: ${hasText ? 'yes' : 'no'}] [Attachments: ${attachments.length}]`
                const cause = error instanceof Error ? error : undefined

                if (error instanceof IMessageError) {
                    throw SendError(`${errorMsg} ${context}`, cause)
                }

                throw SendError(`Send failed ${context}: ${errorMsg}`, cause)
            }
        }

        return this.semaphore ? await this.semaphore.run(task, job.signal) : await task()
    }

    private createSendJob(request: SendRequest): NormalizedSendJob {
        const { to, text, attachments = [], signal, timeout } = request
        const resolved = resolveTarget(String(to))
        const resolvedAttachments = [...attachments]
        const service = resolveRequestedService(request.service)

        if (resolved.kind === 'group') {
            const parsed = resolved.chatId

            try {
                parsed.validate()
            } catch (error) {
                throw SendError(toErrorMessage(error))
            }

            const normalizedId = parsed.buildGroupGuid(this.chatServicePrefix)

            return {
                target: { method: 'chat', identifier: normalizedId },
                chatId: to,
                service,
                text,
                attachments: resolvedAttachments,
                signal,
                timeout,
                label: `Group: ${normalizedId}`,
            }
        }

        const recipient = resolved.recipient

        return {
            target: { method: 'buddy', identifier: recipient },
            chatId: ChatId.fromDMRecipient(recipient, this.chatServicePrefix).toString(),
            service,
            text,
            attachments: resolvedAttachments,
            signal,
            timeout,
            label: `To: ${recipient}`,
        }
    }

    // -----------------------------------------------
    // Pipeline Steps
    // -----------------------------------------------

    private createTrackingPromise(
        chatId: string,
        text: string | undefined,
        hasText: boolean,
        paths: string[],
        sentAt: Date
    ): MessagePromise | null {
        if (!this.outgoingManager) return null

        let messagePromise: MessagePromise | null = null

        if (paths.length > 0) {
            messagePromise = new MessagePromise({
                chatId,
                text,
                attachmentName: paths[0] ? basename(paths[0]) : undefined,
                isAttachment: true,
                sentAt,
            })
        } else if (hasText) {
            messagePromise = new MessagePromise({
                chatId,
                text,
                isAttachment: false,
                sentAt,
            })
        }

        if (messagePromise) {
            this.outgoingManager.add(messagePromise)
        }

        return messagePromise
    }

    private async executeAppleScripts(
        target: SendTarget,
        text: string | undefined,
        hasText: boolean,
        resolvedPaths: string[],
        timeoutMs: number,
        signal?: AbortSignal
    ): Promise<void> {
        const { method, identifier: id } = target
        const descPrefix = method === 'chat' ? `group ${id}` : id

        if (hasText && resolvedPaths.length > 0) {
            // Send text + first attachment as a combined message
            const firstAttachment = resolvedPaths[0] as string
            const { script } = buildSendScript({ method, identifier: id, text, attachmentPath: firstAttachment })
            await this.executeWithRetry(script, `Send text and attachment to ${descPrefix}`, timeoutMs, signal)

            // Send remaining attachments individually
            for (let i = 1; i < resolvedPaths.length; i++) {
                const path = resolvedPaths[i]
                if (!path) continue

                const { script: attachScript } = buildSendScript({
                    method,
                    identifier: id,
                    attachmentPath: path,
                })
                await this.executeWithRetry(
                    attachScript,
                    `Send attachment ${i + 1}/${resolvedPaths.length}`,
                    timeoutMs,
                    signal
                )

                if (i < resolvedPaths.length - 1) await delay(500, signal)
            }
        } else if (hasText) {
            const { script } = buildSendScript({ method, identifier: id, text })
            await this.executeWithRetry(script, `Send text to ${descPrefix}`, timeoutMs, signal)
        } else {
            for (let i = 0; i < resolvedPaths.length; i++) {
                const path = resolvedPaths[i]
                if (!path) continue

                const { script } = buildSendScript({ method, identifier: id, attachmentPath: path })
                await this.executeWithRetry(
                    script,
                    `Send attachment ${i + 1}/${resolvedPaths.length} to ${descPrefix}`,
                    timeoutMs,
                    signal
                )

                if (i < resolvedPaths.length - 1) await delay(500, signal)
            }
        }
    }

    private async awaitConfirmation(messagePromise: MessagePromise | null): Promise<Message | undefined> {
        if (!messagePromise) return undefined

        try {
            const message = await messagePromise.promise

            if (this.debug) {
                console.log('[Sender] Message confirmed in database')
            }

            return message
        } catch (promiseError) {
            if (this.debug) {
                console.warn('[Sender] Message promise rejected:', promiseError)
            }

            return undefined
        }
    }

    // -----------------------------------------------
    // Shared Helpers
    // -----------------------------------------------

    private async executeWithRetry(
        script: string,
        description: string,
        timeoutMs: number,
        signal?: AbortSignal
    ): Promise<void> {
        const totalAttempts = this.maxRetries + 1

        try {
            await retry(() => execAppleScript(script, { debug: this.debug, timeout: timeoutMs }), {
                attempts: totalAttempts,
                delay: this.retryDelay,
                signal,
            })
        } catch (error) {
            throw SendError(`${description} failed after ${totalAttempts} attempts: ${toErrorMessage(error)}`)
        }
    }

    private async resolveAttachment(path: string, signal?: AbortSignal): Promise<string> {
        if (isURL(path)) {
            return await downloadImage(path, { debug: this.debug, signal })
        }

        const localPath = resolve(path)

        if (!existsSync(localPath)) {
            const name = basename(path) || 'unknown'
            throw SendError(`File not found: ${name}`)
        }

        const converted = await convertToCompatibleFormat(localPath)

        if (converted.converted && this.debug) {
            const originalFile = basename(localPath)
            const convertedFile = basename(converted.path)
            console.log(`[Format Conversion] ${originalFile} -> ${convertedFile}`)
        }

        return converted.path
    }

    private checkAbortSignal(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw SendError('Send cancelled')
        }
    }

    private async checkMessagesEnvironment(): Promise<void> {
        const isAvailable = await checkMessagesApp()

        if (!isAvailable) {
            throw SendError('Messages app is not running')
        }
    }

    private async prepareAttachments(attachments: readonly string[], signal?: AbortSignal): Promise<string[]> {
        if (attachments.length === 0) return []

        if (this.debug) {
            console.log(`[Processing Attachments] Total ${attachments.length} attachments`)
        }

        const resolvedPaths: string[] = []

        for (let i = 0; i < attachments.length; i++) {
            this.checkAbortSignal(signal)

            const attachment = attachments[i]
            if (attachment === undefined) continue

            if (this.debug) {
                const preview = attachment.length > 80 ? `${attachment.slice(0, 80)}...` : attachment
                console.log(`[Processing Attachments] ${i + 1}/${attachments.length}: ${preview}`)
            }

            const resolved = await this.resolveAttachment(attachment, signal)
            resolvedPaths.push(resolved)
        }

        return resolvedPaths
    }
}
