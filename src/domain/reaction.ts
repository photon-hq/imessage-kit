/**
 * iMessage reaction model (Tapback, sticker, poll).
 *
 * Reaction codes (`associated_message_type`):
 *
 *   0, 2, 3     app / balloon marker (Polls, msgine, etc.) — NOT a reaction;
 *               `resolveReactionMeta` intentionally returns `{kind: null}`.
 *   1000        sticker placement
 *   2000–2007   add reaction (love, like, dislike, laugh, emphasize, question, emoji, sticker)
 *   3000–3007   remove reaction (base = code − 1000)
 *   4000        poll vote
 */

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Normalized Tapback / sticker / poll reaction kind. */
export type ReactionKind =
    | 'love'
    | 'like'
    | 'dislike'
    | 'laugh'
    | 'emphasize'
    | 'question'
    | 'emoji'
    | 'sticker'
    | 'pollVote'

/** UTF-16 range inside the target message text. */
export interface ReactionTextRange {
    /** UTF-16 start index. */
    readonly location: number
    /** UTF-16 length from `location`. */
    readonly length: number
}

/** Tapback or sticker reaction attached to another message. */
export interface Reaction {
    /** Normalized reaction kind. */
    readonly kind: ReactionKind
    /** Public message id that this reaction targets. */
    readonly targetMessageId: string | null
    /** Emoji payload for emoji reactions; `null` for classic Tapbacks. */
    readonly emoji: string | null
    /** Substring range inside the target message text. */
    readonly textRange: ReactionTextRange
    /** `true` when this row removes a previous reaction. */
    readonly isRemoved: boolean
}

// -----------------------------------------------
// Constants
// -----------------------------------------------

/** Maps protocol `associated_message_type` base codes to reaction kinds. */
const REACTION_KIND_MAP: Readonly<Record<number, ReactionKind>> = {
    2000: 'love',
    2001: 'like',
    2002: 'dislike',
    2003: 'laugh',
    2004: 'emphasize',
    2005: 'question',
    2006: 'emoji',
    2007: 'sticker',
}

/** Standalone reaction codes outside the 2000–3007 tapback range. */
const STANDALONE_REACTION_MAP: Readonly<Record<number, ReactionKind>> = {
    1000: 'sticker',
    4000: 'pollVote',
}

// -----------------------------------------------
// Resolution
// -----------------------------------------------

/** Parsed reaction metadata. */
interface ReactionMeta {
    readonly kind: ReactionKind | null
    readonly isRemoved: boolean
}

/** Resolve `message.associated_message_type` into reaction metadata. */
export function resolveReactionMeta(type: number | null): ReactionMeta {
    if (type == null || type === 0) {
        return { kind: null, isRemoved: false }
    }

    // Standalone codes (1000 = sticker, 4000 = poll vote)
    const standalone = STANDALONE_REACTION_MAP[type]
    if (standalone != null) {
        return { kind: standalone, isRemoved: false }
    }

    // Tapback range: 2000–2007 add, 3000–3007 remove
    const isAdd = type >= 2000 && type <= 2007
    const isRemove = type >= 3000 && type <= 3007

    if (!isAdd && !isRemove) {
        return { kind: null, isRemoved: false }
    }

    const baseType = isRemove ? type - 1000 : type
    const kind = REACTION_KIND_MAP[baseType] ?? null

    return { kind, isRemoved: isRemove }
}
