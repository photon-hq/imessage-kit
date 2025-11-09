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
 * Normalize chatId format
 * - Extracts GUID from AppleScript group format (e.g., `iMessage;+;chat...` -> `chat...`)
 * - Returns normalized chatId for consistent handling
 * @param chatId Chat identifier (may be in various formats)
 * @returns Normalized chatId
 */
export function normalizeChatId(chatId: string): string {
    // AppleScript group format: iMessage;+;chat...
    // Extract GUID part (chat...) for normalization
    if (chatId.includes(';')) {
        const parts = chatId.split(';')
        // Check if it matches AppleScript group format: iMessage;+;chat...
        if (parts.length >= 3 && parts[0] === 'iMessage' && parts[1] === '+' && parts[2]?.startsWith('chat')) {
            // Extract GUID part (everything after the second semicolon)
            return parts.slice(2).join(';')
        }
    }
    return chatId
}

/**
 * Validate chatId format
 * - Must be a non-empty string
 * - Three accepted forms:
 *   1) Group chats: GUID-like string without semicolon (e.g., `chat...`)
 *   2) Group chats (AppleScript): `iMessage;+;chat...` format
 *   3) DMs: service-prefixed identifier with semicolon (e.g., `iMessage;+1234567890`)
 * @throws Error when chatId is invalid
 */
export function validateChatId(chatId: string): void {
    if (!chatId || typeof chatId !== 'string') {
        throw new Error('chatId must be a non-empty string')
    }

    // Check for AppleScript group format: iMessage;+;chat...
    if (chatId.includes(';')) {
        const parts = chatId.split(';')
        // AppleScript group format: iMessage;+;chat...
        if (parts.length >= 3 && parts[0] === 'iMessage' && parts[1] === '+' && parts[2]?.startsWith('chat')) {
            // Validate GUID part length
            const guidPart = parts.slice(2).join(';')
            if (guidPart.length < 8) {
                throw new Error('Invalid chatId format: GUID too short')
            }
            return
        }

        // DM format: <service>;<address>
        const service = parts[0] || ''
        const address = parts[1] || ''
        const allowedServices = new Set(['iMessage', 'SMS', 'RCS'])
        if (!allowedServices.has(service) || !address) {
            throw new Error('Invalid chatId format: expected "<service>;<address>" or group GUID')
        }
        return
    }

    // No semicolon: treat as GUID-like; ensure non-trivial length
    if (chatId.length < 8) {
        throw new Error('Invalid chatId format: GUID too short')
    }
}
