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
 * Validate chatId format
 * - Must be a non-empty string
 * - Two accepted forms:
 *   1) Group chats: GUID-like string without semicolon (e.g., `chat...`)
 *   2) DMs: service-prefixed identifier with semicolon (e.g., `iMessage;+1234567890`)
 * @throws Error when chatId is invalid
 */
export function validateChatId(chatId: string): void {
    if (!chatId || typeof chatId !== 'string') {
        throw new Error('chatId must be a non-empty string')
    }

    // Accept two forms:
    // 1) Group chats: GUID-like string without semicolon (e.g., chat GUID)
    // 2) DMs: service-prefixed identifier with semicolon (e.g., 'iMessage;+1234567890')
    if (chatId.includes(';')) {
        const parts = chatId.split(';', 2)
        const service = parts[0] || ''
        const address = parts[1] || ''
        const allowedServices = new Set(['iMessage', 'SMS', 'RCS'])
        if (!allowedServices.has(service) || !address) {
            throw new Error('Invalid chatId format: expected "<service>;<address>"')
        }
        return
    }

    // No semicolon: treat as GUID-like; ensure non-trivial length
    if (chatId.length < 8) {
        throw new Error('Invalid chatId format: GUID too short')
    }
}
