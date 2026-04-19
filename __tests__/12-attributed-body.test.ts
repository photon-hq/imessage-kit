/**
 * body-decoder.ts — extractTextFromAttributedBody behaviour.
 *
 * Scope: exercise ONLY what this module owns — "happy path" unwraps the
 * NSAttributedString root and returns .string, "anything else" returns
 * null without throwing. Fixtures are real BLOBs captured from chat.db so
 * the typedstream parse is end-to-end, not a fabricated hand-encoded
 * snippet.
 */

import { describe, expect, it } from 'bun:test'
import { extractTextFromAttributedBody } from '../src/infra/db/body-decoder'

// -----------------------------------------------
// Fixtures (real chat.db BLOBs, base64)
// -----------------------------------------------

// A normal chat message with plain ASCII text "Check this out!" (duplicated
// in the typedstream because the NSAttributedString stores the same string
// twice for part tracking — the unwrapped `.string` returns the whole run).
const REAL_ATTRIBUTED_BODY_CHECK_THIS_OUT =
    'BAtzdHJlYW10eXBlZIHoA4QBQISEhBJOU0F0dHJpYnV0ZWRTdHJpbmcAhIQITlNPYmplY3QAhZKEhIQITlNTdHJpbmcBlIQBKx5DaGVjayB0aGlzIG91dCFDaGVjayB0aGlzIG91dCGGhAJpSQEPkoSEhAxOU0RpY3Rpb25hcnkAlIQBaQKShJaWJl9fa0lNQmFzZVdyaXRpbmdEaXJlY3Rpb25BdHRyaWJ1dGVOYW1lhpKEhIQITlNOdW1iZXIAhIQHTlNWYWx1ZQCUhAEqhIQBcZ3/hpKElpYdX19rSU1NZXNzYWdlUGFydEF0dHJpYnV0ZU5hbWWGkoSbnJ2dAIaGlwIPkoSYmQKSmZKakp6ShJucnZ0BhoaG'

// A message that was edited (date_edited != 0); the BLOB carries only the
// new single-run text "Edited".
const REAL_ATTRIBUTED_BODY_EDITED =
    'BAtzdHJlYW10eXBlZIHoA4QBQISEhBJOU0F0dHJpYnV0ZWRTdHJpbmcAhIQITlNPYmplY3QAhZKEhIQITlNTdHJpbmcBlIQBKwZFZGl0ZWSGhAJpSQEGkoSEhAxOU0RpY3Rpb25hcnkAlIQBaQKShJaWJl9fa0lNQmFzZVdyaXRpbmdEaXJlY3Rpb25BdHRyaWJ1dGVOYW1lhpKEhIQITlNOdW1iZXIAhIQHTlNWYWx1ZQCUhAEqhIQBcZ3/hpKElpYdX19rSU1NZXNzYWdlUGFydEF0dHJpYnV0ZU5hbWWGkoSbnJ2dAIaGhg=='

function b64(s: string): Buffer {
    return Buffer.from(s, 'base64')
}

// -----------------------------------------------
// Tests
// -----------------------------------------------

describe('extractTextFromAttributedBody', () => {
    describe('happy path — real chat.db BLOBs', () => {
        it('returns the string content of a normal NSAttributedString', () => {
            const text = extractTextFromAttributedBody(b64(REAL_ATTRIBUTED_BODY_CHECK_THIS_OUT))
            // Messages.app serialises the same run twice (full string then
            // per-part copy) — extractTextFromAttributedBody returns the root
            // `.string`, which includes both runs.
            expect(text).toBe('Check this out!Check this out!')
        })

        it('returns the string content of an edited-message BLOB', () => {
            const text = extractTextFromAttributedBody(b64(REAL_ATTRIBUTED_BODY_EDITED))
            expect(text).toBe('Edited')
        })

        it('accepts a Uint8Array (not just Buffer) with identical output', () => {
            const buf = b64(REAL_ATTRIBUTED_BODY_EDITED)
            // Copy bytes into a plain Uint8Array to make sure the branch that
            // converts non-Buffer input still lands on the same parse path.
            const asU8 = new Uint8Array(buf.byteLength)
            asU8.set(buf)
            expect(extractTextFromAttributedBody(asU8)).toBe('Edited')
        })
    })

    describe('null returns — bad or missing input', () => {
        it('returns null for an empty buffer', () => {
            expect(extractTextFromAttributedBody(Buffer.from([]))).toBeNull()
        })

        it('returns null for an empty Uint8Array', () => {
            expect(extractTextFromAttributedBody(new Uint8Array(0))).toBeNull()
        })

        it('returns null for non-typedstream garbage (does not throw)', () => {
            const junk = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
            expect(extractTextFromAttributedBody(junk)).toBeNull()
        })

        it('returns null when the magic header is present but body is truncated', () => {
            // 'streamtyped' prefix but cut off before any objects — the parser
            // will start reading and throw; the catch must swallow.
            const truncated = Buffer.from('040b73747265616d7479706564', 'hex')
            expect(extractTextFromAttributedBody(truncated)).toBeNull()
        })
    })
})
