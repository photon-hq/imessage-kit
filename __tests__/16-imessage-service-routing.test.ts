import { describe, expect, test } from 'bun:test'

import {
    generateSendAttachmentScript,
    generateSendTextScript,
    generateSendWithAttachmentScript,
} from '../src/utils/applescript'

describe('iMessage service routing for buddy-based sends', () => {
    test('generateSendTextScript should explicitly target iMessage service', () => {
        const script = generateSendTextScript('user@example.com', 'hello')

        expect(script).toContain('set targetService to 1st service whose service type = iMessage')
        expect(script).toContain('set targetBuddy to buddy "user@example.com" of targetService')
    })

    test('generateSendAttachmentScript should explicitly target iMessage service once', () => {
        const { script } = generateSendAttachmentScript('user@example.com', '/Users/me/Pictures/photo.jpg')

        const serviceMatches = script.match(/set targetService to 1st service whose service type = iMessage/g) ?? []
        const buddyMatches = script.match(/set targetBuddy to buddy /g) ?? []

        expect(serviceMatches).toHaveLength(1)
        expect(buddyMatches).toHaveLength(1)
    })

    test('generateSendWithAttachmentScript should not duplicate buddy setup in attachment snippet', () => {
        const { script } = generateSendWithAttachmentScript('user@example.com', 'hello', '/tmp/photo.jpg')

        const serviceMatches = script.match(/set targetService to 1st service whose service type = iMessage/g) ?? []
        const buddyMatches = script.match(/set targetBuddy to buddy /g) ?? []

        expect(serviceMatches).toHaveLength(1)
        expect(buddyMatches).toHaveLength(1)
        expect(script).toContain('send "hello" to targetBuddy')
        expect(script).toContain('send theFile to targetBuddy')
    })
})
