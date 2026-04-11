/**
 * Send request and result types.
 *
 * Data shapes for the send pipeline. Kept in types/ so that both
 * application/ (SendPort) and types/plugin.ts can import without
 * crossing layer boundaries.
 */

import type { Message } from '../domain/message'
import type { Service } from '../domain/service'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Message content payload. */
export interface SendContent {
    readonly text?: string
    readonly attachments?: readonly string[]
}

/** Request to send a message. */
export interface SendRequest extends SendContent {
    readonly to: string
    readonly timeout?: number
    /** Requested transport. Only `iMessage` is currently supported for outbound sends. */
    readonly service?: Service
    readonly signal?: AbortSignal
}

/** Successful send result. Failures throw IMessageError. */
export interface SendResult {
    readonly chatId: string
    readonly to: string
    readonly service: Service
    readonly sentAt: Date
    readonly message?: Message
}
