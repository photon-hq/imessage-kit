/**
 * Message target resolution.
 *
 * Routes a user-provided input string into either a DM (buddy method)
 * or group (chat ID method) send target.
 */

import { ChatId } from './chat-id'
import { SendError } from './errors'
import { validateRecipient } from './validate'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Discriminated union for resolved send targets. */
export type MessageTarget =
    | { readonly kind: 'dm'; readonly recipient: string; readonly chatIdHint: string }
    | { readonly kind: 'group'; readonly chatId: ChatId }

// -----------------------------------------------
// Resolution
// -----------------------------------------------

/**
 * Resolve a user-provided input into a send target.
 *
 * Decision order:
 *   1. Explicit group format (`;+;` or bare GUID) → group target
 *   2. No semicolons → DM target (validates as phone/email, throws on invalid)
 *   3. Service-prefixed DM (`;-;`) → DM target (validates recipient, throws on invalid)
 *   4. Unrecognized semicolon format → group target
 *
 * Throws `IMessageError` with code `SEND` for invalid inputs.
 */
export function resolveTarget(input: string): MessageTarget {
    if (input === '') {
        throw SendError('Target cannot be empty')
    }

    const trimmed = input.trim()
    if (trimmed === '') {
        throw SendError('Target cannot be empty')
    }

    const chatId = ChatId.fromUserInput(trimmed)

    // 1. Explicit group format (`;+;` or bare GUID starting with "chat")
    if (chatId.isGroup) {
        return { kind: 'group', chatId }
    }

    // 2. Bare recipient (no semicolons) — must be a valid phone or email
    if (!trimmed.includes(';')) {
        const validated = validateRecipient(trimmed)
        return { kind: 'dm', recipient: validated, chatIdHint: trimmed }
    }

    // 3. Service-prefixed DM (`;-;`)
    const recipient = chatId.extractRecipient()
    if (recipient != null) {
        const validated = validateRecipient(recipient)
        return { kind: 'dm', recipient: validated, chatIdHint: trimmed }
    }

    // 4. Unrecognized semicolon format — treat as group chat id
    return { kind: 'group', chatId }
}
