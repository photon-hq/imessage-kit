/**
 * Send port definition.
 *
 * The application-layer contract for sending messages.
 * Infra implements SendPort; application orchestrators depend on it.
 *
 * Data shapes (SendContent, SendRequest, SendResult) live in types/send.ts
 * to avoid a types/ → application/ layer violation.
 */

import type { SendRequest, SendResult } from '../types/send'

// -----------------------------------------------
// Re-exports
// -----------------------------------------------

export type { SendContent, SendRequest, SendResult } from '../types/send'

// -----------------------------------------------
// Port
// -----------------------------------------------

/** Application-facing send capability. Implemented by infra. */
export interface SendPort {
    send(request: SendRequest): Promise<SendResult>
}
