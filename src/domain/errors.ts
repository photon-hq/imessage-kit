/**
 * Unified error type, factory functions, and normalization utilities.
 *
 * Prefer factory functions over `new IMessageError` so the error code
 * always matches the intent.
 */

// -----------------------------------------------
// Types
// -----------------------------------------------

export type ErrorCode = 'PLATFORM' | 'DATABASE' | 'SEND' | 'CONFIG'

// -----------------------------------------------
// Error class
// -----------------------------------------------

export class IMessageError extends Error {
    readonly code: ErrorCode

    constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.code = code
        this.name = 'IMessageError'

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, IMessageError)
        }
    }
}

// -----------------------------------------------
// Factory functions
// -----------------------------------------------

export function PlatformError(message = 'Only macOS is supported', cause?: unknown): IMessageError {
    return new IMessageError('PLATFORM', message, { cause })
}

export function DatabaseError(message: string, cause?: unknown): IMessageError {
    return new IMessageError('DATABASE', message, { cause })
}

export function SendError(message: string, cause?: unknown): IMessageError {
    return new IMessageError('SEND', message, { cause })
}

export function ConfigError(message: string, cause?: unknown): IMessageError {
    return new IMessageError('CONFIG', message, { cause })
}

// -----------------------------------------------
// Normalization utilities
// -----------------------------------------------

/** Normalize an unknown caught value to an Error instance. */
export function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value))
}

/** Extract a human-readable message from an unknown caught value. */
export function toErrorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value)
}
