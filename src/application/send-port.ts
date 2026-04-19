/**
 * Send port definition.
 *
 * The application-layer contract for sending messages.
 * Infra implements SendPort; application orchestrators depend on it.
 *
 * The data shape (`SendRequest`) lives in `types/send.ts` as the canonical
 * source; this module defines only the port contract.
 */

import type { SendRequest } from '../types/send'

// -----------------------------------------------
// Port
// -----------------------------------------------

/**
 * Application-facing send capability. Implemented by infra.
 *
 * Resolves when Messages.app accepts the AppleScript dispatch —
 * acceptance, not delivery. For the chat.db row or later `isDelivered`
 * transitions observe the watcher (`onFromMeMessage` callback on
 * `startWatching`, or plugin hook `onFromMe`).
 *
 * Throws `IMessageError` on validation, AppleScript dispatch, or
 * cancellation.
 */
export interface SendPort {
    send(request: SendRequest): Promise<void>
}
