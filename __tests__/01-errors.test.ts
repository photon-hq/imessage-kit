/**
 * Error Types Tests
 *
 * Tests for all SDK error types and error handling
 */

import { describe, expect, it } from 'bun:test'
import { ConfigError, DatabaseError, IMessageError, PlatformError, SendError, WebhookError } from '../src/core/errors'

describe('IMessageError', () => {
    it('should create error with code and message', () => {
        const error = new IMessageError('DATABASE', 'Test error')

        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('DATABASE')
        expect(error.message).toBe('Test error')
        expect(error.name).toBe('IMessageError')
    })

    it('should have stack trace', () => {
        const error = new IMessageError('SEND', 'Send failed')

        expect(error.stack).toBeDefined()
        expect(error.stack).toContain('IMessageError')
    })

    it('should support type guard', () => {
        const error = new IMessageError('WEBHOOK', 'Webhook failed')
        const regularError = new Error('Regular error')

        expect(IMessageError.is(error)).toBe(true)
        expect(IMessageError.is(regularError)).toBe(false)
        expect(IMessageError.is(null)).toBe(false)
        expect(IMessageError.is(undefined)).toBe(false)
        expect(IMessageError.is('string')).toBe(false)
    })

    it('should check error code with is() method', () => {
        const error = new IMessageError('DATABASE', 'DB error')

        expect(error.is('DATABASE')).toBe(true)
        expect(error.is('SEND')).toBe(false)
        expect(error.is('PLATFORM')).toBe(false)
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

    it('should create WebhookError', () => {
        const error = WebhookError('Webhook request failed')

        expect(error).toBeInstanceOf(IMessageError)
        expect(error.code).toBe('WEBHOOK')
        expect(error.message).toBe('Webhook request failed')
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
