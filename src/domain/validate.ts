/**
 * Send validation rules.
 *
 * Pure input validation for recipients, URLs, and message content.
 * Not a security boundary — shell/AppleScript escaping is handled in infra.
 */

import { SendError } from './errors'

// -----------------------------------------------
// Constants
// -----------------------------------------------

export const SEND_LIMITS = {
    maxRecipientLength: 320,
    maxTextLength: 100_000,
    maxAttachmentsPerMessage: 50,
} as const

const MAX_RECIPIENT_LENGTH = SEND_LIMITS.maxRecipientLength

const PHONE_REGEX = /^\+?[\d\s\-()]+$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_REGEX = /^https?:\/\/.+$/

const MIN_PHONE_DIGITS = 7

/** ITU-T E.164: max 15 digits (including country code). */
const MAX_PHONE_DIGITS = 15

// -----------------------------------------------
// Recipient validation
// -----------------------------------------------

/**
 * Validate and return a recipient string (phone or email).
 *
 * Throws `IMessageError` with code `SEND` on invalid input.
 */
export function validateRecipient(recipient: string): string {
    if (recipient === '') {
        throw SendError('Recipient cannot be empty')
    }

    if (recipient.length > MAX_RECIPIENT_LENGTH) {
        throw SendError(`Recipient exceeds maximum length of ${MAX_RECIPIENT_LENGTH} characters`)
    }

    if (EMAIL_REGEX.test(recipient)) {
        return recipient
    }

    if (PHONE_REGEX.test(recipient)) {
        const digitCount = recipient.replace(/\D/g, '').length

        if (digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS) {
            return recipient
        }
    }

    const preview = recipient.length > 80 ? `${recipient.slice(0, 80)}…` : recipient

    throw SendError(`Invalid recipient format: "${preview}"`)
}

// -----------------------------------------------
// URL validation
// -----------------------------------------------

/** Check whether a string looks like an HTTP(S) URL. */
export function isURL(value: string): boolean {
    return URL_REGEX.test(value)
}

// -----------------------------------------------
// Content validation
// -----------------------------------------------

const MAX_TEXT_LENGTH = SEND_LIMITS.maxTextLength
const MAX_ATTACHMENTS_PER_MESSAGE = SEND_LIMITS.maxAttachmentsPerMessage

export interface MessageContentValidation {
    readonly hasText: boolean
    readonly hasAttachments: boolean
}

/**
 * Validate message content (text and/or attachments).
 *
 * Enforces:
 *   - At least one piece of content (text or attachments)
 *   - Text length ≤ 100,000 characters
 *   - Attachment count ≤ 50
 *
 * Throws `IMessageError` with code `SEND` on violation.
 */
export function validateMessageContent(
    text: string | undefined,
    attachments: readonly string[] | undefined
): MessageContentValidation {
    const hasText = text != null && text !== ''
    const hasAttachments = attachments != null && attachments.length > 0

    if (!hasText && !hasAttachments) {
        throw SendError('Message must have text or at least one attachment')
    }

    if (hasText && (text as string).length > MAX_TEXT_LENGTH) {
        throw SendError(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`)
    }

    if (hasAttachments && (attachments as readonly string[]).length > MAX_ATTACHMENTS_PER_MESSAGE) {
        throw SendError(`Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE})`)
    }

    return { hasText, hasAttachments }
}
