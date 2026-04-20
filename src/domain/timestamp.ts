/**
 * macOS timestamp conversion.
 *
 * Messages database stores timestamps as nanoseconds since 2001-01-01T00:00:00Z.
 */

// -----------------------------------------------
// Constants
// -----------------------------------------------

/** macOS epoch (2001-01-01T00:00:00Z) in milliseconds since Unix epoch. */
export const MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()

// -----------------------------------------------
// Conversion
// -----------------------------------------------

/**
 * Convert a JS Date to a macOS nanosecond timestamp.
 *
 * Returned as a `number`. The 2001-01-01 epoch means `Number.MAX_SAFE_INTEGER`
 * is exceeded after ~104 days (≈ April 2001), so precision below ~100 ns is
 * lost for any real-world date. Millisecond-level precision — the resolution
 * of `Date` itself — is always preserved, which is sufficient for chat.db
 * WHERE comparisons.
 */
export function toMacTimestampNs(date: Date): number {
    return (date.getTime() - MAC_EPOCH) * 1_000_000
}

/**
 * Convert a macOS nanosecond timestamp to a JS Date.
 *
 * Sub-millisecond precision is lost because `Date` is millisecond-resolution.
 */
export function fromMacTimestampNs(ns: number): Date {
    return new Date(MAC_EPOCH + ns / 1_000_000)
}
