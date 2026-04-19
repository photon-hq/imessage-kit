/**
 * Decode Messages.app `attributedBody` BLOBs (typedstream) to plain text.
 */

import { NSAttributedString, Unarchiver } from '@parseaple/typedstream'

/**
 * Extract plain text from a Messages `attributedBody` column BLOB.
 *
 * The BLOB is a NeXTSTEP typedstream whose single root value is an
 * `NSAttributedString`. We ask the unarchiver for the unwrapped root
 * directly — `decodeAll()` would return the outer `TypedGroup` wrappers,
 * which is one level above the object we want.
 *
 * Returns `null` on any decode error or when no string content is found.
 */
export function extractTextFromAttributedBody(blob: Buffer | Uint8Array): string | null {
    try {
        const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)

        if (buffer.length === 0) return null

        const root = Unarchiver.open(buffer, Unarchiver.BinaryDecoding.decodable).decodeSingleRoot()

        if (root instanceof NSAttributedString && root.string) {
            return root.string
        }

        return null
    } catch {
        return null
    }
}
