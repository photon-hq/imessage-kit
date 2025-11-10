/**
 * SDK Error Types
 */

/** Error code types */
export type ErrorCode = 'PLATFORM' | 'DATABASE' | 'SEND' | 'WEBHOOK' | 'CONFIG' | 'UNKNOWN'

/**
 * Unified SDK Error Class
 */
export class IMessageError extends Error {
    constructor(
        public readonly code: ErrorCode,
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options)
        this.name = 'IMessageError'
        Error.captureStackTrace?.(this, this.constructor)
    }

    /** Type guard */
    static is(error: unknown): error is IMessageError {
        return error instanceof IMessageError
    }

    /** Check if error is of specific type */
    is(code: ErrorCode): boolean {
        return this.code === code
    }
}

/** Factory functions */
export const PlatformError = (msg = 'Only macOS is supported', cause?: Error) =>
    new IMessageError('PLATFORM', msg, cause ? { cause } : undefined)
export const DatabaseError = (msg: string, cause?: Error) =>
    new IMessageError('DATABASE', msg, cause ? { cause } : undefined)
export const SendError = (msg: string, cause?: Error) => new IMessageError('SEND', msg, cause ? { cause } : undefined)
export const WebhookError = (msg: string, cause?: Error) =>
    new IMessageError('WEBHOOK', msg, cause ? { cause } : undefined)
export const ConfigError = (msg: string, cause?: Error) =>
    new IMessageError('CONFIG', msg, cause ? { cause } : undefined)
