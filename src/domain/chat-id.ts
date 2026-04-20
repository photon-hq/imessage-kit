/**
 * ChatId value object.
 *
 * Parses, normalizes, validates, and matches iMessage chat identifiers.
 *
 * Supported formats:
 *
 *   service;+;guid        group chat       (iMessage;+;chat613…, any;+;chat687…)
 *   service;-;address     direct message   (iMessage;-;+1234567890)
 *   chat<id>              bare group GUID  (chat61321855167474084)
 *   bare address          DM recipient     (+1234567890, user@example.com, …)
 */

import { ConfigError } from './errors'

// -----------------------------------------------
// Types
// -----------------------------------------------

/**
 * Known chat service prefixes.
 *
 * Accepts any well-formed token for forward compatibility.
 */
export type ChatServicePrefix = 'iMessage' | 'SMS' | 'RCS' | 'any' | (string & {})

// -----------------------------------------------
// Constants
// -----------------------------------------------

const GROUP_SEPARATOR = ';+;'
const DM_SEPARATOR = ';-;'

const CHAT_SERVICE_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/

/**
 * Bare Messages.app chat GUID: the literal prefix `chat` followed by at least
 * one ASCII alphanumeric or hyphen (`chat61321855167474084`, `chat687E84CA-…`).
 *
 * The trailing `+` rejects the 4-character string `"chat"` alone, and email
 * addresses starting with "chat" (e.g. `chatbot@openai.com`) fail because `@`
 * and `.` are not in the body character class.
 */
const BARE_GROUP_GUID_PATTERN = /^chat[A-Za-z0-9-]+$/

// -----------------------------------------------
// Helpers
// -----------------------------------------------

/**
 * Parse and validate a service prefix string.
 *
 * Returns the prefix if well-formed, or `null` if invalid.
 */
export function parseChatServicePrefix(value: string | null | undefined): ChatServicePrefix | null {
    if (value == null || value === '') return null

    return CHAT_SERVICE_PREFIX_PATTERN.test(value) ? (value as ChatServicePrefix) : null
}

function isValidPrefixedFormat(raw: string, separator: string): boolean {
    const index = raw.indexOf(separator)

    if (index === -1) return false

    const prefix = raw.slice(0, index)
    const suffix = raw.slice(index + separator.length)

    return parseChatServicePrefix(prefix) != null && suffix !== ''
}

// -----------------------------------------------
// Value object
// -----------------------------------------------

export class ChatId {
    /** The raw chat identifier string. */
    readonly raw: string

    /** Whether this identifies a group conversation. */
    readonly isGroup: boolean

    private constructor(raw: string, isGroup: boolean) {
        this.raw = raw
        this.isGroup = isGroup
    }

    // -----------------------------------------------
    // Factory methods
    // -----------------------------------------------

    /**
     * Construct from a raw identifier string. Whitespace is trimmed —
     * the name signals the input may be untrusted.
     */
    static fromUserInput(raw: string): ChatId {
        const trimmed = raw.trim()
        return new ChatId(trimmed, ChatId.detectGroup(trimmed))
    }

    /** Construct a DM chat id from a recipient address and optional service prefix. */
    static fromDMRecipient(recipient: string, prefix: ChatServicePrefix = 'iMessage'): ChatId {
        return new ChatId(`${prefix}${DM_SEPARATOR}${recipient}`, false)
    }

    // -----------------------------------------------
    // Computed properties
    // -----------------------------------------------

    /**
     * Core identifier with all service prefixes stripped.
     *
     *   iMessage;-;pilot@photon.codes  →  pilot@photon.codes
     *   iMessage;+;chat613ABF          →  chat613ABF
     *   chat613ABF                     →  chat613ABF
     */
    get coreIdentifier(): string {
        return this.extractAfter(GROUP_SEPARATOR) ?? this.extractAfter(DM_SEPARATOR) ?? this.raw
    }

    // -----------------------------------------------
    // Methods
    // -----------------------------------------------

    /**
     * Extract the recipient address from a `service;-;address` DM chat id.
     *
     * Returns `null` for any other form (bare address, group, etc.).
     */
    extractRecipient(): string | null {
        return this.extractAfter(DM_SEPARATOR)
    }

    /**
     * Validate the chat id format.
     *
     * Throws `IMessageError` (code `CONFIG`) for malformed inputs. Accepts the
     * three documented formats: `service;+;guid`, `service;-;address`, and any
     * non-empty bare identifier (no semicolons).
     */
    validate(): void {
        if (this.raw.trim() === '') {
            throw ConfigError('ChatId cannot be empty')
        }

        if (!this.raw.includes(';')) return

        if (isValidPrefixedFormat(this.raw, GROUP_SEPARATOR) || isValidPrefixedFormat(this.raw, DM_SEPARATOR)) {
            return
        }

        throw ConfigError(`Malformed chat id: "${this.raw}" (expected service;+;guid or service;-;address)`)
    }

    /**
     * Build a full Messages.app guid with a service prefix.
     *
     *   chat613ABF + `iMessage`  →  iMessage;+;chat613ABF
     *
     * Group-only: throws `IMessageError` (code `CONFIG`) on DM instances —
     * calling on a DM would produce a malformed id like `any;+;+1234567890`.
     */
    buildGroupGuid(prefix: ChatServicePrefix): string {
        if (!this.isGroup) {
            throw ConfigError(`buildGroupGuid is group-only; "${this.raw}" is not a group chat id`)
        }
        return `${prefix}${GROUP_SEPARATOR}${this.coreIdentifier}`
    }

    toString(): string {
        return this.raw
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    /**
     * Extract everything after the first occurrence of separator, or `null`
     * if the separator is absent OR the suffix is empty (e.g. `iMessage;-;`).
     * Empty-suffix inputs are malformed; treating them as "not found" keeps
     * callers from receiving `""` as if it were a valid identifier.
     */
    private extractAfter(separator: string): string | null {
        const index = this.raw.indexOf(separator)

        if (index === -1) return null

        const suffix = this.raw.slice(index + separator.length)
        return suffix === '' ? null : suffix
    }

    private static detectGroup(raw: string): boolean {
        if (raw.includes(GROUP_SEPARATOR)) return true

        if (!raw.includes(';') && BARE_GROUP_GUID_PATTERN.test(raw)) return true

        return false
    }
}
