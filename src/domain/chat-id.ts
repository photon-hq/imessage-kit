/**
 * ChatId value object.
 *
 * Parses, normalizes, validates, and matches iMessage chat identifiers.
 *
 * Supported formats:
 *   service;+;guid        group chat       (iMessage;+;chat613..., any;+;chat687...)
 *   service;-;address     direct message   (iMessage;-;+1234567890)
 *   chat<id>              bare group GUID  (chat61321855167474084)
 */

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

const CHAT_SERVICE_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/
const GUID_MIN_LENGTH = 8
const BARE_GUID_MIN_LENGTH = 10
const BARE_GUID_PREFIX = 'chat'
const GROUP_SEPARATOR = ';+;'
const DM_SEPARATOR = ';-;'

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

    if (index === -1) {
        return false
    }

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

    /** Construct from a raw identifier string. */
    static fromUserInput(raw: string): ChatId {
        return new ChatId(raw, ChatId.detectGroup(raw))
    }

    /** Construct a DM chat id from a recipient address and optional service prefix. */
    static fromDMRecipient(recipient: string, prefix: ChatServicePrefix = 'iMessage'): ChatId {
        return new ChatId(`${prefix}${DM_SEPARATOR}${recipient}`, false)
    }

    // -----------------------------------------------
    // Computed properties
    // -----------------------------------------------

    /** Chat kind as a string. */
    get kind(): 'group' | 'dm' {
        return this.isGroup ? 'group' : 'dm'
    }

    /**
     * Core identifier with all service prefixes stripped.
     *
     * `iMessage;-;pilot@photon.codes` → `pilot@photon.codes`
     * `iMessage;+;chat613ABF`         → `chat613ABF`
     * `chat613ABF`                    → `chat613ABF`
     */
    get coreIdentifier(): string {
        return this.extractAfter(GROUP_SEPARATOR) ?? this.extractAfter(DM_SEPARATOR) ?? this.raw
    }

    /**
     * Group identifier: the GUID portion for groups, raw for non-groups.
     */
    get groupIdentifier(): string {
        if (!this.isGroup) return this.raw

        return this.extractAfter(GROUP_SEPARATOR) ?? this.raw
    }

    // -----------------------------------------------
    // Methods
    // -----------------------------------------------

    /**
     * Extract the recipient address from a DM chat id.
     *
     * Returns `null` for group chats or bare values without a separator.
     */
    extractRecipient(): string | null {
        if (this.isGroup) return null

        return this.extractAfter(DM_SEPARATOR)
    }

    /** Extract everything after a separator, or null if the separator is absent. */
    private extractAfter(separator: string): string | null {
        if (!this.raw.includes(separator)) return null

        return this.raw.split(separator).slice(1).join(separator)
    }

    /**
     * Check whether this ChatId matches another.
     *
     * Compares raw strings and core identifiers (case-sensitive).
     */
    matches(other: ChatId): boolean {
        return this.raw === other.raw || this.coreIdentifier === other.coreIdentifier
    }

    /**
     * Validate the chat id format.
     *
     * Throws `Error` for malformed inputs. Accepts the three documented formats:
     * `service;+;guid`, `service;-;address`, and bare GUIDs (≥8 chars, no semicolons).
     */
    validate(): void {
        if (this.raw === '') {
            throw new Error('ChatId cannot be empty')
        }

        if (!this.raw.includes(';')) {
            if (this.raw.length < GUID_MIN_LENGTH) {
                throw new Error(`Bare GUID too short: "${this.raw}" (minimum ${GUID_MIN_LENGTH} characters)`)
            }
            return
        }

        if (isValidPrefixedFormat(this.raw, GROUP_SEPARATOR) || isValidPrefixedFormat(this.raw, DM_SEPARATOR)) {
            return
        }

        throw new Error(`Malformed chat id: "${this.raw}" (expected service;+;guid or service;-;address)`)
    }

    /**
     * Build a full Messages.app guid with a service prefix.
     *
     * `chat613ABF` + `iMessage` → `iMessage;+;chat613ABF`
     */
    buildGroupGuid(prefix: ChatServicePrefix): string {
        const core = this.groupIdentifier
        return `${prefix}${GROUP_SEPARATOR}${core}`
    }

    toString(): string {
        return this.raw
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private static detectGroup(raw: string): boolean {
        if (raw.includes(GROUP_SEPARATOR)) return true

        if (!raw.includes(';') && raw.startsWith(BARE_GUID_PREFIX) && raw.length > BARE_GUID_MIN_LENGTH) {
            return true
        }

        return false
    }
}
