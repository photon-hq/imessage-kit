/**
 * Common utility functions
 */

/**
 * Delay for specified milliseconds
 * @param ms Milliseconds
 */
export const delay = (ms: number): Promise<void> => {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Validate message content
 * @param text Text content
 * @param attachments Attachment list
 * @returns Validation result: hasText, hasAttachments
 * @throws Error when content is empty
 */
export function validateMessageContent(
    text: string | undefined,
    attachments: readonly string[] | undefined
): { hasText: boolean; hasAttachments: boolean } {
    const hasText = Boolean(text && text.trim().length > 0)
    const hasAttachments = Boolean(attachments && attachments.length > 0)

    if (!hasText && !hasAttachments) {
        throw new Error('Message must contain text or attachments')
    }

    return { hasText, hasAttachments }
}

/**
 * normalizeChatId strips the service prefix from group chatIds.
 *   "any;+;chat687..." → "chat687..."
 * Non-group IDs are returned as-is.
 */
export function normalizeChatId(chatId: string): string {
    if (chatId.includes(';')) {
        const parts = chatId.split(';')
        if (parts.length >= 3 && parts[1] === '+') {
            return parts.slice(2).join(';')
        }
    }
    return chatId
}

/**
 * Check if a chatId represents a group chat (not a DM)
 *
 * @param chatId The chat identifier to check
 * @returns true if it's a group chat, false if it's a DM
 */
export function isGroupChatId(chatId: string): boolean {
    if (chatId.includes(';+;')) return true

    // Pure GUID format (no semicolon, starts with 'chat')
    if (!chatId.includes(';') && chatId.startsWith('chat') && chatId.length > 10) return true

    return false
}

/**
 * Extract recipient from a DM chatId
 *
 * @param chatId e.g., `any;-;+1234567890` or `iMessage;+1234567890`
 * @returns The address part (e.g., `+1234567890`), or null if group/unknown format
 */
export function extractRecipientFromChatId(chatId: string): string | null {
    if (!chatId.includes(';')) {
        return null
    }

    // Skip group chat formats
    if (isGroupChatId(chatId)) {
        return null
    }

    const parts = chatId.split(';')
    // 3-part DM: service;-;address (e.g., any;-;+1234567890)
    if (parts.length === 3 && parts[1] === '-') return parts[2] || null
    // 2-part legacy DM: service;address (e.g., iMessage;+1234567890)
    if (parts.length === 2) return parts[1] || null

    return null
}

/**
 * Validate chatId format
 * @throws Error when chatId is invalid
 *
 * Accepted forms:
 *   1) Group: `service;+;guid` (e.g., `any;+;chat687...`, `iMessage;+;chat613...`)
 *   2) DM: `service;-;address` (e.g., `any;-;+1234567890`)
 *   3) Legacy DM: `service;address` (e.g., `iMessage;+1234567890`)
 *   4) Bare GUID: `chat{id}` or raw hex (length >= 8, no semicolons)
 */
export function validateChatId(chatId: string): void {
    if (!chatId || typeof chatId !== 'string') {
        throw new Error('chatId must be a non-empty string')
    }

    if (chatId.includes(';')) {
        const parts = chatId.split(';')

        // service;+;guid
        if (parts.length >= 3 && parts[1] === '+') {
            const guidPart = parts.slice(2).join(';')
            if (guidPart.length < 8) {
                throw new Error('Invalid chatId format: GUID too short')
            }
            return
        }

        // service;-;address
        if (parts.length === 3 && parts[1] === '-') {
            if (!parts[2]) {
                throw new Error('Invalid chatId format: missing address')
            }
            return
        }

        // service;address (legacy)
        if (parts.length === 2) {
            const service = parts[0] || ''
            const address = parts[1] || ''
            const allowedServices = new Set(['iMessage', 'SMS', 'RCS', 'any'])
            if (!allowedServices.has(service) || !address) {
                throw new Error('Invalid chatId format: expected "<service>;<address>" or group GUID')
            }
            return
        }

        throw new Error('Invalid chatId format: unrecognized semicolon pattern')
    }

    // No semicolon: treat as GUID-like; ensure non-trivial length
    if (chatId.length < 8) {
        throw new Error('Invalid chatId format: GUID too short')
    }
}
