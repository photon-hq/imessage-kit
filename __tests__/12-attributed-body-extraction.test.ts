/**
 * Tests for attributedBody text extraction fixes
 *
 * Fixed issues:
 * 1. Smart quotes (U+2018-U+201F) breaking text extraction
 * 2. Short messages filtered by minimum length requirement
 * 3. Binary plist length prefixes (+digit) appearing in output
 */
import { describe, expect, test } from 'bun:test'

/** Simulates the fixed extraction logic */
function extractFixed(bufferStr: string): string | null {
    const excluded =
        /^(NSAttributedString|NSMutableAttributedString|NSObject|NSString|NSDictionary|NSNumber|NSValue|streamtyped|__kIM\w+|NS\.\w+)$/i

    const matches = bufferStr.match(/[\x20-\x7E\u2018-\u201F\u4e00-\u9fff]+/g)
    if (!matches) return null

    const candidates = matches
        .filter((m) => !excluded.test(m) && !/^[\[\(\)\]\*,\-:X]+$/.test(m) && !/\$\w+/.test(m))
        .map((m) => ({ text: m, score: m.length + (m.match(/[\u4e00-\u9fff]/g)?.length || 0) * 10 }))
        .sort((a, b) => b.score - a.score)

    if (!candidates.length) return null
    return candidates[0]!.text.replace(/^\+./, '').replace(/"$/, '').trim()
}

/** Simulates the buggy extraction logic */
function extractBuggy(bufferStr: string): string | null {
    const excluded =
        /^(NSAttributedString|NSMutableAttributedString|NSObject|NSString|NSDictionary|NSNumber|NSValue|streamtyped|__kIM\w+|NS\.\w+)$/i

    // BUG: Missing smart quotes, requires 5+ chars
    const matches = bufferStr.match(/[\x20-\x7E\u4e00-\u9fff]{5,}/g)
    if (!matches) return null

    const candidates = matches.filter((m) => !excluded.test(m) && m.length > 5).sort((a, b) => b.length - a.length)

    if (!candidates.length) return null
    // BUG: Only removes +"
    return candidates[0]!.replace(/^\+"/, '').replace(/"$/, '').trim()
}

describe('attributedBody extraction', () => {
    const SMART_QUOTE = '\u2019' // Right single quote (')

    describe('smart quotes', () => {
        test('buggy: splits on smart quote', () => {
            const input = `\x00abc${SMART_QUOTE}xyz\x00`
            expect(extractBuggy(input)).toBe(null)
        })

        test('fixed: preserves text with smart quote', () => {
            const input = `\x00abc${SMART_QUOTE}xyz\x00`
            expect(extractFixed(input)).toBe(`abc${SMART_QUOTE}xyz`)
        })

        test('fixed: handles multiple smart quotes', () => {
            const input = `\x00don${SMART_QUOTE}t won${SMART_QUOTE}t\x00`
            expect(extractFixed(input)).toBe(`don${SMART_QUOTE}t won${SMART_QUOTE}t`)
        })
    })

    describe('short messages', () => {
        test('buggy: filters short text', () => {
            expect(extractBuggy('\x00test\x00')).toBe(null)
            expect(extractBuggy('\x00hi\x00')).toBe(null)
        })

        test('fixed: preserves short text', () => {
            expect(extractFixed('\x00test\x00')).toBe('test')
            expect(extractFixed('\x00hi\x00')).toBe('hi')
        })
    })

    describe('length prefix cleanup', () => {
        test('buggy: keeps +digit prefix', () => {
            expect(extractBuggy('\x00+3hello world\x00')).toBe('+3hello world')
        })

        test('fixed: removes +digit prefix', () => {
            expect(extractFixed('\x00+3hello world\x00')).toBe('hello world')
            expect(extractFixed('\x00+1message\x00')).toBe('message')
        })
    })

    describe('regression', () => {
        test('normal ASCII text', () => {
            expect(extractFixed('\x00Hello, world!\x00')).toBe('Hello, world!')
        })

        test('Chinese text', () => {
            expect(extractFixed('\x00你好世界\x00')).toBe('你好世界')
        })

        test('mixed content', () => {
            expect(extractFixed('\x00Hello你好\x00')).toBe('Hello你好')
        })

        test('ASCII apostrophe unchanged', () => {
            expect(extractFixed("\x00it's fine\x00")).toBe("it's fine")
        })
    })
})
