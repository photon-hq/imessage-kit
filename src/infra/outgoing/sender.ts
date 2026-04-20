/**
 * SendPort implementation.
 *
 * Internal invariants:
 *   - Every error raised by `send()` is an `IMessageError`. Recognised
 *     `IMessageError` subclasses pass through with their original `code`
 *     (CONFIG / DATABASE / SEND) preserved; anything else is wrapped as
 *     `SendError` at the pipeline or semaphore boundary.
 *   - Dispatch is non-transactional. A multi-attachment send that fails
 *     mid-way leaves completed steps delivered; step numbering in the
 *     error description shows where the failure landed so the caller
 *     can retry only the remaining part.
 *
 * For the public contract of `send()` (acceptance vs delivery, hook
 * ordering, cancellation), see `sdk.ts::IMessageSDK.send`.
 */

import { basename, resolve } from 'node:path'

import type { SendPort } from '../../application/send-port'
import type { ChatServicePrefix } from '../../domain/chat-id'
import { IMessageError, SendError, toErrorMessage } from '../../domain/errors'
import { resolveTarget } from '../../domain/routing'
import { isURL, validateMessageContent } from '../../domain/validate'
import type { SendRequest } from '../../types/send'
import { delay, retry, type Semaphore } from '../../utils/async'

import { detectChatServicePrefix } from '../platform'
import { buildSendScript, inspectAttachment, type ResolvedAttachment, type SendMethod } from './applescript-builder'
import { execAppleScript, MessagesAppProbe } from './applescript-transport'

// -----------------------------------------------
// Defaults
// -----------------------------------------------

/** Per-osascript ceiling. Large attachments need headroom; beyond this is usually stuck. */
const SEND_TIMEOUT_MS = 30_000

/** Total attempts per script (including the first); value of 3 → 1 initial + 2 retries. */
const RETRY_ATTEMPTS = 3

/** Base backoff between retries (jitter on top). */
const RETRY_DELAY_MS = 1_500

/** Gap between successive attachments; prevents Messages.app from dropping the next file. */
const INTER_ATTACHMENT_DELAY_MS = 500

// -----------------------------------------------
// Types
// -----------------------------------------------

type SendTarget = { readonly method: SendMethod; readonly identifier: string }

interface NormalizedSendJob {
    readonly target: SendTarget
    readonly text?: string
    readonly attachments: readonly string[]
}

/** Options for constructing a MessageSender. */
interface MessageSenderOptions {
    readonly semaphore?: Semaphore
    readonly debug?: boolean
    readonly timeout?: number
    /** Total attempts per AppleScript call including the first (matches `RetryOptions.attempts`). */
    readonly retryAttempts?: number
    readonly retryDelay?: number
    /** Abort signal that cancels all sends on SDK shutdown. */
    readonly signal?: AbortSignal
}

// -----------------------------------------------
// MessageSender
// -----------------------------------------------

/** Send orchestrator implementing the application-layer SendPort. */
export class MessageSender implements SendPort {
    private readonly debug: boolean
    private readonly retryAttempts: number
    private readonly retryDelay: number
    private readonly sendTimeoutMs: number
    private readonly chatServicePrefix: ChatServicePrefix
    private readonly semaphore?: Semaphore
    private readonly signal?: AbortSignal
    private readonly messagesApp = new MessagesAppProbe()

    constructor({
        debug = false,
        retryAttempts = RETRY_ATTEMPTS,
        retryDelay = RETRY_DELAY_MS,
        timeout = SEND_TIMEOUT_MS,
        semaphore,
        signal,
    }: MessageSenderOptions = {}) {
        this.debug = debug
        this.retryAttempts = retryAttempts
        this.retryDelay = retryDelay
        this.sendTimeoutMs = timeout
        this.semaphore = semaphore
        this.signal = signal
        this.chatServicePrefix = detectChatServicePrefix()
    }

    /** Implements `SendPort.send`. */
    async send(request: SendRequest): Promise<void> {
        const job = this.createSendJob(request)
        const task = () => this.runPipeline(job)

        try {
            return await (this.semaphore ? this.semaphore.run(task, this.signal) : task())
        } catch (error) {
            // `runPipeline` already wraps everything it raises, so
            // `IMessageError` passes through untouched. The uncovered
            // case is an abort thrown inside `semaphore.acquire` BEFORE
            // the task runs — wrap it here so the "always IMessageError"
            // contract holds for queue-time cancellation.
            if (error instanceof IMessageError) throw error
            throw SendError('Send cancelled', error instanceof Error ? error : undefined)
        }
    }

    // -----------------------------------------------
    // Pipeline
    // -----------------------------------------------

    private async runPipeline(job: NormalizedSendJob): Promise<void> {
        this.assertNotAborted()

        try {
            validateMessageContent(job.text, job.attachments)
            await this.assertMessagesAppRunning()

            const attachments = job.attachments.map((a) => this.resolveAttachment(a))
            await this.dispatch(job.target, job.text, attachments)
        } catch (error) {
            // Inner helpers already produce fully-contextual `IMessageError`
            // (validate, attachment-precheck, dispatch all attach their own
            // detail). Re-wrapping here would duplicate recipient/step info,
            // so the catch only guarantees "always IMessageError" — it does
            // not append extra context.
            if (error instanceof IMessageError) throw error
            throw SendError(`Send failed: ${toErrorMessage(error)}`, error instanceof Error ? error : undefined)
        }
    }

    private createSendJob(request: SendRequest): NormalizedSendJob {
        const { to, text, attachments = [] } = request
        const resolved = resolveTarget(to)

        if (resolved.kind === 'group') {
            const identifier = resolved.chatId.buildGroupGuid(this.chatServicePrefix)
            return { target: { method: 'chat', identifier }, text, attachments }
        }

        return { target: { method: 'buddy', identifier: resolved.recipient }, text, attachments }
    }

    private async dispatch(
        target: SendTarget,
        text: string | undefined,
        attachments: ResolvedAttachment[]
    ): Promise<void> {
        const { method, identifier } = target
        const prefix = method === 'chat' ? `group ${identifier}` : identifier
        const total = attachments.length
        const hasText = text != null && text !== ''

        // Non-transactional: N attachments dispatch up to max(1, N)
        // osascript calls (first call bundles text + attachments[0]; each
        // later attachment is its own call). Retry is per-step, not
        // end-to-end — worst case is `retryAttempts × max(1, N)` osascript
        // invocations. Resuming mid-batch is the caller's job: re-invoke
        // send() with attachments.slice(k-1).
        const firstLabel = total === 0 ? 'text' : hasText ? `text + attachment 1/${total}` : `attachment 1/${total}`
        const firstScript = buildSendScript({
            method,
            identifier,
            text: hasText ? text : undefined,
            attachment: attachments[0],
        })
        await this.executeWithRetry(firstScript, `Send ${firstLabel} to ${prefix}`)

        for (let i = 1; i < total; i++) {
            await delay(INTER_ATTACHMENT_DELAY_MS, this.signal)
            const script = buildSendScript({ method, identifier, attachment: attachments[i] })
            await this.executeWithRetry(script, `Send attachment ${i + 1}/${total} to ${prefix}`)
        }
    }

    // -----------------------------------------------
    // Helpers
    // -----------------------------------------------

    private async executeWithRetry(script: string, description: string): Promise<void> {
        try {
            await retry(
                () => execAppleScript(script, { debug: this.debug, timeout: this.sendTimeoutMs, signal: this.signal }),
                {
                    attempts: this.retryAttempts,
                    delay: this.retryDelay,
                    signal: this.signal,
                }
            )
        } catch (error) {
            throw SendError(
                `${description} failed after ${this.retryAttempts} attempts: ${toErrorMessage(error)}`,
                error instanceof Error ? error : undefined
            )
        }
    }

    private resolveAttachment(path: string): ResolvedAttachment {
        if (isURL(path)) {
            throw SendError(
                `URLs are not supported as attachments. Download the file yourself and pass a local path instead: ${path.slice(0, 120)}`
            )
        }

        const localPath = resolve(path)
        try {
            return inspectAttachment(localPath)
        } catch (error) {
            // Preserve the underlying cause (ENOENT/EACCES/EIO/…) so debuggers
            // aren't misled into only checking whether the path exists.
            const cause = error instanceof Error ? error : new Error(String(error))
            throw SendError(`Attachment unreadable: ${basename(path) || 'unknown'}: ${cause.message}`, cause)
        }
    }

    private assertNotAborted(): void {
        if (this.signal?.aborted) throw SendError('Send cancelled')
    }

    private async assertMessagesAppRunning(): Promise<void> {
        if (!(await this.messagesApp.isRunning())) {
            throw SendError('Messages app is not running')
        }
    }
}
