/**
 * Error Types Tests
 *
 * Tests for all SDK error types and error handling
 */

import { describe, expect, it } from 'bun:test'
import { ConfigError, DatabaseError, IMessageError, PlatformError, SendError } from '../src/domain/errors'

describe('IMessageError', () => {
    it('should create error with code and message', () => {
        const error = DatabaseError('Test error')

        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('DATABASE')
        expect(error.message).toBe('Test error')
        expect(error.name).toBe('IMessageError')
    })

    it('should have stack trace', () => {
        const error = SendError('Send failed')

        expect(error.stack).toBeDefined()
        expect(error.stack).toContain('IMessageError')
    })

    it('should support instanceof', () => {
        const error = SendError('Send failed')
        const regularError = new Error('Regular error')

        expect(error instanceof IMessageError).toBe(true)
        expect(regularError instanceof IMessageError).toBe(false)
        expect(null instanceof IMessageError).toBe(false)
        expect(undefined instanceof IMessageError).toBe(false)
        expect(('string' as unknown) instanceof IMessageError).toBe(false)
    })

    it('should compare code with ===', () => {
        const error = DatabaseError('DB error')

        expect(error.code === 'DATABASE').toBe(true)
        expect(error.code === 'SEND').toBe(false)
        expect(error.code === 'PLATFORM').toBe(false)
    })
})

describe('Error Factory Functions', () => {
    it('should create PlatformError', () => {
        const error = PlatformError()

        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('PLATFORM')
        expect(error.message).toBe('Only macOS is supported')
    })

    it('should create PlatformError with custom message', () => {
        const error = PlatformError('Custom platform error')

        expect(error.code).toBe('PLATFORM')
        expect(error.message).toBe('Custom platform error')
    })

    it('should create DatabaseError', () => {
        const error = DatabaseError('Failed to open database')

        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('DATABASE')
        expect(error.message).toBe('Failed to open database')
    })

    it('should create SendError', () => {
        const error = SendError('Failed to send message')

        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('SEND')
        expect(error.message).toBe('Failed to send message')
    })

    it('should create ConfigError', () => {
        const error = ConfigError('Invalid configuration')

        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('CONFIG')
        expect(error.message).toBe('Invalid configuration')
    })
})

describe('Error Inheritance and Catching', () => {
    it('should be catchable as Error', () => {
        try {
            throw DatabaseError('Test')
        } catch (error) {
            expect(error).toBeInstanceOf(Error)
            expect(error).toBeInstanceOf(IMessageError)
        }
    })

    it('should preserve error information when catching', () => {
        try {
            throw SendError('Original error')
        } catch (error) {
            expect(error).toBeInstanceOf(IMessageError)
            expect((error as IMessageError).code).toBe('SEND')
            expect((error as IMessageError).message).toBe('Original error')
        }
    })
})
