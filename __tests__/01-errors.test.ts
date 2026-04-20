/**
 * domain/errors — IMessageError factories + normalization utilities.
 */

import { describe, expect, it } from 'bun:test'
import {
    ConfigError,
    DatabaseError,
    IMessageError,
    PlatformError,
    SendError,
    toError,
    toErrorMessage,
} from '../src/domain/errors'

describe('IMessageError — class', () => {
    it('is an Error with a populated stack under the IMessageError name', () => {
        const err = SendError('boom')
        expect(err).toBeInstanceOf(Error)
        expect(err).toBeInstanceOf(IMessageError)
        expect(err.name).toBe('IMessageError')
        expect(err.stack).toBeDefined()
    })

    it('preserves the `cause` passed through the factory', () => {
        const root = new Error('root')
        const err = DatabaseError('db failed', root)
        expect(err.cause).toBe(root)
    })
})

describe('Error factories — code + default messages', () => {
    it.each([
        ['PlatformError', PlatformError, 'PLATFORM', 'Only macOS is supported'],
        ['DatabaseError', DatabaseError, 'DATABASE', 'db broke'],
        ['SendError', SendError, 'SEND', 'send broke'],
        ['ConfigError', ConfigError, 'CONFIG', 'config broke'],
    ] as const)('%s sets code and message', (_name, factory, code, defaultOrExplicit) => {
        // PlatformError has a default message; the rest always take an explicit message.
        const err = factory === PlatformError ? factory() : factory(defaultOrExplicit)
        expect(err.code).toBe(code)
        expect(err.message).toBe(defaultOrExplicit)
        expect(err).toBeInstanceOf(IMessageError)
    })

    it('PlatformError overrides the default message when one is provided', () => {
        const err = PlatformError('Linux is not supported here')
        expect(err.message).toBe('Linux is not supported here')
        expect(err.code).toBe('PLATFORM')
    })
})

describe('toError', () => {
    it('passes Error instances through unchanged (identity)', () => {
        const root = new Error('x')
        expect(toError(root)).toBe(root)
    })

    it('wraps non-Error values via String() coercion', () => {
        expect(toError('oops').message).toBe('oops')
        expect(toError(42).message).toBe('42')
        expect(toError(null).message).toBe('null')
        expect(toError(undefined).message).toBe('undefined')
        expect(toError({ a: 1 }).message).toBe('[object Object]')
    })

    it('preserves IMessageError identity (code + message survive)', () => {
        const original = SendError('send-level boom')
        const normalised = toError(original)
        expect(normalised).toBe(original)
        expect((normalised as IMessageError).code).toBe('SEND')
    })
})

describe('toErrorMessage', () => {
    it('returns the .message of an Error instance', () => {
        expect(toErrorMessage(new Error('hello'))).toBe('hello')
    })

    it('String-coerces non-Error values', () => {
        expect(toErrorMessage('oops')).toBe('oops')
        expect(toErrorMessage(123)).toBe('123')
        expect(toErrorMessage(null)).toBe('null')
    })
})
