/**
 * resolveReactionMeta — pure branch coverage over associated_message_type.
 *
 * This is a domain function: no DB, no IO. Mapping from numeric codes to
 * `{ kind, isRemoved }` is the entire contract. Reaction field projection
 * (targetMessageId, emoji, textRange) is exercised at the mapper layer in
 * `24-messages-db-semantic.test.ts` and end-to-end via the e2e matrix —
 * duplicating it here through MessagesDatabaseReader adds no value.
 */

import { describe, expect, it } from 'bun:test'
import { resolveReactionMeta } from '../src/domain/reaction'

describe('resolveReactionMeta', () => {
    it.each([
        [null, { kind: null, isRemoved: false }],
        [0, { kind: null, isRemoved: false }],
        // Standalone codes
        [1000, { kind: 'sticker', isRemoved: false }],
        [4000, { kind: 'pollVote', isRemoved: false }],
        // Add range 2000-2007
        [2000, { kind: 'love', isRemoved: false }],
        [2001, { kind: 'like', isRemoved: false }],
        [2002, { kind: 'dislike', isRemoved: false }],
        [2003, { kind: 'laugh', isRemoved: false }],
        [2004, { kind: 'emphasize', isRemoved: false }],
        [2005, { kind: 'question', isRemoved: false }],
        [2006, { kind: 'emoji', isRemoved: false }],
        [2007, { kind: 'sticker', isRemoved: false }],
        // Remove range 3000-3007 (base = code - 1000)
        [3000, { kind: 'love', isRemoved: true }],
        [3001, { kind: 'like', isRemoved: true }],
        [3002, { kind: 'dislike', isRemoved: true }],
        [3003, { kind: 'laugh', isRemoved: true }],
        [3004, { kind: 'emphasize', isRemoved: true }],
        [3005, { kind: 'question', isRemoved: true }],
        [3006, { kind: 'emoji', isRemoved: true }],
        [3007, { kind: 'sticker', isRemoved: true }],
    ])('maps associated_message_type=%p → %p', (type, expected) => {
        expect(resolveReactionMeta(type as number | null)).toEqual(expected as ReturnType<typeof resolveReactionMeta>)
    })

    it('returns {null, false} for app/balloon markers (2, 3)', () => {
        // Explicit — these codes are reserved for Polls / msgine balloons and
        // MUST NOT be misinterpreted as reactions.
        expect(resolveReactionMeta(2)).toEqual({ kind: null, isRemoved: false })
        expect(resolveReactionMeta(3)).toEqual({ kind: null, isRemoved: false })
    })

    it('returns {null, false} for out-of-range numeric codes', () => {
        // Below the tapback band.
        expect(resolveReactionMeta(1999)).toEqual({ kind: null, isRemoved: false })
        // Between add and remove bands.
        expect(resolveReactionMeta(2500)).toEqual({ kind: null, isRemoved: false })
        // Above the remove band, not standalone.
        expect(resolveReactionMeta(3500)).toEqual({ kind: null, isRemoved: false })
        // Far future code.
        expect(resolveReactionMeta(9999)).toEqual({ kind: null, isRemoved: false })
    })

    it('flags isRemoved=true for all remove-range codes even if kind is unmapped', () => {
        // 3008–3999 fall in the isRemove branch but map to no known base kind
        // (REACTION_KIND_MAP has no entry for 2008+). Current contract: kind=null
        // but isRemoved=false because !isAdd && !isRemove short-circuits first.
        // 3008 and above: isRemove is FALSE (range is 3000–3007 inclusive).
        expect(resolveReactionMeta(3008)).toEqual({ kind: null, isRemoved: false })
    })
})
