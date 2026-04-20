/**
 * Canonical SDK configuration bounds.
 *
 * Standalone module with zero dependencies — safe to import from anywhere.
 */
export const BOUNDS = {
    maxConcurrentSends: { default: 10, min: 1, max: 50 },
    sendTimeout: { default: 30_000, min: 1_000, max: 300_000 },
} as const
