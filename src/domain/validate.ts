/**
 * Send validation — minimal, non-heuristic.
 *
 * Only API-contract checks live here:
 *   - A send request must have text or at least one attachment.
 *   - `isURL` classifies a string as HTTP(S); infra uses it as a
 *     UX-friendly pre-check so attachment paths that look like URLs
 *     surface a clearer error than "file not found".
 *
 * Everything else (phone/email shape, recipient length, text length,
 * attachment count) is intentionally left to Messages.app so the user sees
 * the authoritative error instead of a local guess.
 *
 * Not a security boundary — shell/AppleScript escaping is handled in infra.
 */

import { SendError } from './errors'

// -----------------------------------------------
// URL classification
// -----------------------------------------------

/** Check whether a string looks like an HTTP(S) URL. UX pre-check only, not a security boundary. */
export function isURL(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://')
}

// -----------------------------------------------
// Content validation
// -----------------------------------------------

/**
 * Validate that a send request has at least one piece of content.
 *
 * This is an API-contract check, not a heuristic gate: a message with
 * neither text nor attachments has nothing to send. Other dimensions
 * (text size, attachment count) are not enforced here.
 *
 * Throws `IMessageError` with code `SEND` on violation.
 */
export function validateMessageContent(text: string | undefined, attachments: readonly string[] | undefined): void {
    const hasText = text != null && text !== ''
    const hasAttachments = attachments != null && attachments.length > 0

    if (!hasText && !hasAttachments) {
        throw SendError('Message must have text or at least one attachment')
    }
}
