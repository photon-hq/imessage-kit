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
        message: string
    ) {
        super(message)
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
export const PlatformError = (msg = 'Only macOS is supported') => new IMessageError('PLATFORM', msg)
export const DatabaseError = (msg: string) => new IMessageError('DATABASE', msg)
export const SendError = (msg: string) => new IMessageError('SEND', msg)
export const WebhookError = (msg: string) => new IMessageError('WEBHOOK', msg)
export const ConfigError = (msg: string) => new IMessageError('CONFIG', msg)
