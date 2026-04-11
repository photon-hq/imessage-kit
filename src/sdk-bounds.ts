/**
 * Canonical SDK configuration bounds.
 *
 * Standalone module with zero dependencies — safe to import from anywhere.
 */
export const BOUNDS = {
    maxConcurrentSends: { default: 5, min: 1, max: 50 },
} as const
