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

/** Convert a JS Date to a macOS nanosecond timestamp. */
export function toMacTimestampNs(date: Date): number {
    return (date.getTime() - MAC_EPOCH) * 1_000_000
}

/** Convert a macOS nanosecond timestamp to a JS Date. */
export function fromMacTimestampNs(ns: number): Date {
    return new Date(MAC_EPOCH + ns / 1_000_000)
}
