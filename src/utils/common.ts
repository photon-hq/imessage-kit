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
 * Normalize chatId format by extracting the core identifier.
 * - Group: `any;+;534ce85d...` -> `534ce85d...`
 * - Legacy group: `iMessage;+;chat534ce85d...` -> `chat534ce85d...`
 * - DM: `any;-;+1234567890` -> `+1234567890`
 * - Already bare: returned as-is
 */
export function normalizeChatId(chatId: string): string {
    if (chatId.includes(';')) {
        const parts = chatId.split(';')
        return parts[parts.length - 1] ?? chatId
    }
    return chatId
}

/**
 * Check if a chatId represents a group chat (not a DM).
 * Recognizes:
 * - Modern macOS: `any;+;{guid}` or any `service;+;identifier`
 * - Legacy: `iMessage;+;chat{guid}`
 * - Bare GUID: `chat{guid}` (no semicolons, starts with "chat")
 */
export function isGroupChatId(chatId: string): boolean {
    if (chatId.includes(';+;')) return true
    if (chatId.startsWith('iMessage;+;chat')) return true
    if (!chatId.includes(';') && chatId.startsWith('chat') && chatId.length > 10) return true
    return false
}

/**
 * Extract recipient from a service-prefixed DM chatId.
 * Handles:
 * - 3-part modern: `any;-;+1234567890` -> `+1234567890`
 * - 2-part legacy: `iMessage;+1234567890` -> `+1234567890`
 */
export function extractRecipientFromChatId(chatId: string): string | null {
    if (!chatId.includes(';')) return null
    if (isGroupChatId(chatId)) return null

    const parts = chatId.split(';')
    // 3-part DM: service;-;address (e.g., any;-;+1234567890)
    if (parts.length === 3 && parts[1] === '-') return parts[2] || null
    // 2-part DM: service;address (e.g., iMessage;+1234567890)
    if (parts.length === 2) return parts[1] || null
    return null
}

/**
 * Validate chatId format.
 * Accepted forms:
 *   1) Group: `service;+;guid` (e.g., `any;+;534ce85d...`)
 *   2) Legacy group: `iMessage;+;chat{guid}`
 *   3) Bare group GUID: `chat{guid}` or raw hex GUID (length >= 8)
 *   4) DM: `service;-;address` (e.g., `any;-;+1234567890`)
 *   5) Legacy DM: `service;address` (e.g., `iMessage;+1234567890`)
 * @throws Error when chatId is invalid
 */
export function validateChatId(chatId: string): void {
    if (!chatId || typeof chatId !== 'string') {
        throw new Error('chatId must be a non-empty string')
    }

    if (chatId.includes(';')) {
        const parts = chatId.split(';')

        // Group format: service;+;guid (e.g., any;+;534ce85d...)
        if (parts.length >= 3 && parts[1] === '+') {
            const guidPart = parts.slice(2).join(';')
            if (guidPart.length < 8) {
                throw new Error('Invalid chatId format: GUID too short')
            }
            return
        }

        // DM format: service;-;address (e.g., any;-;+1234567890)
        if (parts.length === 3 && parts[1] === '-') {
            if (!parts[2]) {
                throw new Error('Invalid chatId format: missing address')
            }
            return
        }

        // Legacy DM format: service;address (e.g., iMessage;+1234567890)
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

    // No semicolons: bare GUID or chat-prefixed GUID
    if (chatId.length < 8) {
        throw new Error('Invalid chatId format: GUID too short')
    }
}

/**
 * Build a full Messages.app guid for a group chat using the discovered prefix.
 * Strips any existing prefixes and reconstructs with the local format.
 * @param rawChatId Chat identifier in any format
 * @param discoveredPrefix The prefix discovered from chat.db at init (e.g., "any;+;" or "iMessage;+;chat")
 */
export function buildGroupChatGuid(rawChatId: string, discoveredPrefix: string): string {
    let guid = rawChatId
    if (guid.includes(';')) {
        const parts = guid.split(';')
        guid = parts[parts.length - 1] ?? guid
    }
    if (guid.startsWith('chat')) guid = guid.substring(4)
    return `${discoveredPrefix}${guid}`
}
