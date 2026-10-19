/**
 * Decode Messages.app `attributedBody` BLOBs (typedstream): the plain text, and
 * the @mention tags carried on it.
 */

import { NSAttributedString, Unarchiver } from '@parseaple/typedstream'
import type { MessageMention } from '../../domain/message'

/** Attribute Messages puts on a confirmed @mention run; its value is the mentioned handle. */
const MENTION_ATTRIBUTE = '__kIMMentionConfirmedMention'

/**
 * Unwrap the BLOB's single root `NSAttributedString`.
 *
 * The BLOB is a NeXTSTEP typedstream whose single root value is an
 * `NSAttributedString`. We ask the unarchiver for the unwrapped root
 * directly — `decodeAll()` would return the outer `TypedGroup` wrappers,
 * which is one level above the object we want.
 *
 * Returns `null` on any decode error or a non-string root.
 */
function decodeAttributedString(blob: Buffer | Uint8Array): NSAttributedString | null {
    try {
        const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)

        if (buffer.length === 0) return null

        const root = Unarchiver.open(buffer, Unarchiver.BinaryDecoding.decodable).decodeSingleRoot()
        return root instanceof NSAttributedString ? root : null
    } catch {
        return null
    }
}

/**
 * Extract plain text from a Messages `attributedBody` column BLOB.
 *
 * Returns `null` on any decode error or when no string content is found.
 */
export function extractTextFromAttributedBody(blob: Buffer | Uint8Array): string | null {
    return decodeAttributedString(blob)?.string || null
}

/**
 * Extract the @mentions from a Messages `attributedBody` column BLOB, in
 * text order.
 *
 * Picking a person from the @ suggestions tags that span of the text with
 * their handle. Offsets are UTF-16 code units into the decoded string. A
 * mention split across adjacent runs (e.g. by formatting) is merged back
 * into one.
 *
 * Returns `[]` when the BLOB carries no mention or fails to decode. The
 * byte check skips the typedstream decode for the common untagged message.
 */
export function extractMentionsFromAttributedBody(blob: Buffer | Uint8Array): readonly MessageMention[] {
    const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
    if (!buffer.includes(MENTION_ATTRIBUTE)) return []

    const root = decodeAttributedString(buffer)
    if (!root) return []

    const mentions: { address: string; start: number; length: number }[] = []
    for (const { range, attributes } of root.runs) {
        const address = attributes[MENTION_ATTRIBUTE]
        const [start = 0, length = 0] = range
        if (typeof address !== 'string' || address === '' || length === 0) continue

        const last = mentions[mentions.length - 1]
        if (last && last.address === address && last.start + last.length === start) {
            last.length += length
        } else {
            mentions.push({ address, start, length })
        }
    }
    return mentions
}
