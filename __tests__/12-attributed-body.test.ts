/**
 * AttributedBody Extraction Tests
 *
 * Tests for the @parseaple/typedstream based attributedBody extraction
 */

import { describe, expect, it } from 'bun:test'
import { NSAttributedString, Unarchiver } from '@parseaple/typedstream'
import { extractTextFromAttributedBody } from '../src/infra/db/body-decoder'

describe('AttributedBody Extraction', () => {
    describe('Edge Cases', () => {
        it('should return null for null input', () => {
            expect(extractTextFromAttributedBody(null)).toBeNull()
        })

        it('should return null for undefined input', () => {
            expect(extractTextFromAttributedBody(undefined)).toBeNull()
        })

        it('should return null for empty buffer', () => {
            expect(extractTextFromAttributedBody(Buffer.from([]))).toBeNull()
        })

        it('should return null for empty Uint8Array', () => {
            expect(extractTextFromAttributedBody(new Uint8Array([]))).toBeNull()
        })

        it('should return null for non-buffer input', () => {
            expect(extractTextFromAttributedBody('string')).toBeNull()
            expect(extractTextFromAttributedBody(123)).toBeNull()
            expect(extractTextFromAttributedBody({})).toBeNull()
        })

        it('should return null for invalid binary data', () => {
            const invalidData = Buffer.from([0x01, 0x02, 0x03, 0x04])
            expect(extractTextFromAttributedBody(invalidData)).toBeNull()
        })

        it('should handle Uint8Array input', () => {
            const invalidData = new Uint8Array([0x01, 0x02, 0x03, 0x04])
            expect(extractTextFromAttributedBody(invalidData)).toBeNull()
        })
    })

    describe('NSAttributedString Handling', () => {
        it('should correctly identify NSAttributedString type', () => {
            const instance = new NSAttributedString('', [])
            expect(instance).toBeInstanceOf(NSAttributedString)
        })

        it('should access string property of NSAttributedString', () => {
            const instance = new NSAttributedString('', [])
            // NSAttributedString.string is the property we need
            expect('string' in instance).toBe(true)
        })
    })

    describe('Unarchiver API', () => {
        it('should have BinaryDecoding.decodable option', () => {
            expect(Unarchiver.BinaryDecoding.decodable).toBeDefined()
        })

        it('should throw on invalid typedstream data', () => {
            const invalidData = Buffer.from('not a typedstream')
            expect(() => {
                Unarchiver.open(invalidData, Unarchiver.BinaryDecoding.decodable).decodeAll()
            }).toThrow()
        })
    })
})
