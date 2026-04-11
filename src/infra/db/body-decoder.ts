/**
 * Decode Messages.app `attributedBody` BLOBs (typedstream) to plain text.
 */

import { NSAttributedString, Unarchiver } from '@parseaple/typedstream'

// -----------------------------------------------
// Internal
// -----------------------------------------------

function firstAttributedString(decoded: unknown): string | null {
    const items = Array.isArray(decoded) ? decoded : [decoded]

    for (const item of items) {
        if (item instanceof NSAttributedString && item.string) {
            return item.string
        }

        if (item !== null && typeof item === 'object' && 'values' in item && Array.isArray(item.values)) {
            for (const val of item.values) {
                if (val instanceof NSAttributedString && val.string) {
                    return val.string
                }
            }
        }
    }

    return null
}

// -----------------------------------------------
// Public
// -----------------------------------------------

/**
 * Extract plain text from a Messages `attributedBody` column BLOB.
 *
 * Returns `null` on any decode error or when no text content is found.
 */
export function extractTextFromAttributedBody(blob: Buffer | Uint8Array): string | null {
    try {
        const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)

        if (buffer.length === 0) return null

        const decoded = Unarchiver.open(buffer, Unarchiver.BinaryDecoding.decodable).decodeAll()
        if (!decoded) return null

        return firstAttributedString(decoded)
    } catch {
        return null
    }
}
