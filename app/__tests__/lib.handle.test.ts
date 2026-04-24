import { describe, expect, it } from 'bun:test'
import { isEmail, isPhone, normalizeHandle } from '../src/lib/handle'

describe('handle normalizer', () => {
    it('normalizes US phone to E.164', () => {
        expect(normalizeHandle('+14155550123')).toBe('+14155550123')
        expect(normalizeHandle('14155550123')).toBe('+14155550123')
        expect(normalizeHandle('4155550123')).toBe('+14155550123')
        expect(normalizeHandle('(415) 555-0123')).toBe('+14155550123')
        expect(normalizeHandle('415-555-0123')).toBe('+14155550123')
        expect(normalizeHandle('1-415-555-0123')).toBe('+14155550123')
    })

    it('lowercases emails', () => {
        expect(normalizeHandle('Foo@Bar.com')).toBe('foo@bar.com')
        expect(normalizeHandle('  FOO@BAR.COM  ')).toBe('foo@bar.com')
    })

    it('throws on unparseable input', () => {
        expect(() => normalizeHandle('hello')).toThrow()
        expect(() => normalizeHandle('')).toThrow()
    })

    it('classifies phone vs email', () => {
        expect(isPhone('+14155550123')).toBe(true)
        expect(isEmail('foo@bar.com')).toBe(true)
        expect(isPhone('foo@bar.com')).toBe(false)
        expect(isEmail('+14155550123')).toBe(false)
    })
})
