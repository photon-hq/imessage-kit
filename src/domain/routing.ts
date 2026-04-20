/**
 * Message target resolution.
 *
 * Maps a user-provided target string to either a DM (buddy method) or
 * group (chat method) send target. Format validity is delegated to
 * `ChatId.validate()`; this function only decides the routing kind.
 */

import { ChatId } from './chat-id'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Discriminated union for resolved send targets. */
export type MessageTarget =
    | { readonly kind: 'dm'; readonly recipient: string }
    | { readonly kind: 'group'; readonly chatId: ChatId }

// -----------------------------------------------
// Resolution
// -----------------------------------------------

/**
 * Resolve a target string.
 *
 * Exposed publicly so callers can pre-validate a `to` value (and branch
 * on DM vs group) before calling `sdk.send()` — the SDK itself invokes
 * this internally, so you only need it for up-front validation or
 * routing-aware UI.
 *
 * Accepted formats (enforced by `ChatId.validate`):
 *
 *   service;+;guid  /  chat<id>        → group
 *   service;-;addr  /  bare address    → DM
 *
 * Throws `IMessageError` (code `CONFIG`) for empty or malformed input.
 */
export function resolveTarget(input: string): MessageTarget {
    const chatId = ChatId.fromUserInput(input)
    chatId.validate()

    if (chatId.isGroup) {
        return { kind: 'group', chatId }
    }

    return { kind: 'dm', recipient: chatId.extractRecipient() ?? chatId.raw }
}
