/**
 * ChatId Value Object & MessageTarget Tests
 *
 * Covers:
 * - ChatId factory methods (fromDatabaseRow, fromUserInput, fromDMRecipient)
 * - ChatId properties (isGroup, coreIdentifier)
 * - ChatId methods (extractRecipient, validate, buildGroupGuid, toString)
 * - resolveTarget routing logic
 * - buildSendScript unified script generation
 */

import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ChatId } from '../src/domain/chat-id'
import { IMessageError } from '../src/domain/errors'
import { resolveTarget } from '../src/domain/routing'
import { buildChatIdMatchSql } from '../src/infra/db/contract'
import { buildSendScript, type ResolvedAttachment } from '../src/infra/outgoing/applescript-builder'

const SAFE_DIRS = ['Pictures', 'Downloads', 'Documents'].map((d) => join(homedir(), d))
const attachmentFor = (path: string): ResolvedAttachment => ({
    localPath: path,
    needsBypass: !SAFE_DIRS.some((d) => path.startsWith(`${d}/`) || path === d),
    sizeBytes: 1024,
})

// ============================================================
// ChatId Value Object
// ============================================================
describe('ChatId', () => {
    // -------------------- Factory: fromUserInput --------------------
    describe('fromUserInput', () => {
        test('should create from bare group GUID', () => {
            const id = ChatId.fromUserInput('chat61321855167474084')
            expect(id.raw).toBe('chat61321855167474084')
            expect(id.isGroup).toBe(true)
        })

        test('should create from service-prefixed group', () => {
            const id = ChatId.fromUserInput('iMessage;+;chat61321855167474084')
            expect(id.raw).toBe('iMessage;+;chat61321855167474084')
            expect(id.isGroup).toBe(true)
        })

        test('should create from bare recipient (phone)', () => {
            const id = ChatId.fromUserInput('+1234567890')
            expect(id.isGroup).toBe(false)
        })

        test('should create from bare recipient (email)', () => {
            const id = ChatId.fromUserInput('user@example.com')
            expect(id.isGroup).toBe(false)
        })

        test('should create from 3-part DM format', () => {
            const id = ChatId.fromUserInput('iMessage;-;+1234567890')
            expect(id.isGroup).toBe(false)
        })

        test('should create from 2-part legacy DM format', () => {
            const id = ChatId.fromUserInput('iMessage;+1234567890')
            expect(id.isGroup).toBe(false)
        })

        test('should handle UUID-style group GUIDs', () => {
            const id = ChatId.fromUserInput('chat45e2b868ce1e43da89af262922733382')
            expect(id.isGroup).toBe(true)
        })
    })

    // -------------------- Factory: fromUserInput covers database row scenarios --------------------
    // Note: fromDatabaseRow was removed; the mapper in infra/db/mapper.ts resolves
    // chat ids before constructing ChatId via fromUserInput.

    describe('buildChatIdMatchSql', () => {
        test('should produce OR clause params for guid / identifier / core', () => {
            const raw = 'iMessage;+;chatABC'
            const m = buildChatIdMatchSql(raw, {
                identifier: 'chat.chat_identifier',
                guid: 'chat.guid',
            })
            expect(m.sql).toContain('chat.chat_identifier')
            expect(m.params).toEqual([raw, 'chatABC', raw, 'chatABC'])
        })
    })

    // -------------------- Factory: fromDMRecipient --------------------
    describe('fromDMRecipient', () => {
        test('should create with default iMessage service', () => {
            const id = ChatId.fromDMRecipient('+1234567890')
            expect(id.raw).toBe('iMessage;-;+1234567890')
            expect(id.isGroup).toBe(false)
        })

        test('should create with explicit SMS service', () => {
            const id = ChatId.fromDMRecipient('+1234567890', 'SMS')
            expect(id.raw).toBe('SMS;-;+1234567890')
        })

        test('should create with "any" service (macOS 14+)', () => {
            const id = ChatId.fromDMRecipient('+1234567890', 'any')
            expect(id.raw).toBe('any;-;+1234567890')
            expect(id.isGroup).toBe(false)
        })

        test('should create with email recipient', () => {
            const id = ChatId.fromDMRecipient('user@example.com')
            expect(id.raw).toBe('iMessage;-;user@example.com')
        })
    })

    // -------------------- Property: coreIdentifier --------------------
    describe('coreIdentifier', () => {
        test('should strip all prefixes from 3-part DM', () => {
            const id = ChatId.fromUserInput('iMessage;-;pilot@photon.codes')
            expect(id.coreIdentifier).toBe('pilot@photon.codes')
        })

        test('should strip all prefixes from 3-part group', () => {
            const id = ChatId.fromUserInput('iMessage;+;chat613218')
            expect(id.coreIdentifier).toBe('chat613218')
        })

        test('should return raw for 2-part legacy DM (no recognized separator)', () => {
            const id = ChatId.fromUserInput('iMessage;+1234567890')
            // Legacy 2-part format has no ;+; or ;-; separator, so coreIdentifier returns raw
            expect(id.coreIdentifier).toBe('iMessage;+1234567890')
        })

        test('should return bare string as-is', () => {
            expect(ChatId.fromUserInput('+1234567890').coreIdentifier).toBe('+1234567890')
            expect(ChatId.fromUserInput('chat613218551674').coreIdentifier).toBe('chat613218551674')
        })
    })

    // -------------------- Method: extractRecipient --------------------
    describe('extractRecipient', () => {
        test('should extract from 3-part DM format', () => {
            expect(ChatId.fromUserInput('iMessage;-;+1234567890').extractRecipient()).toBe('+1234567890')
            expect(ChatId.fromUserInput('any;-;user@example.com').extractRecipient()).toBe('user@example.com')
        })

        test('should return null for 2-part legacy DM format (no ;-; separator)', () => {
            // The new ChatId only recognizes ;-; as a DM separator
            expect(ChatId.fromUserInput('iMessage;+1234567890').extractRecipient()).toBeNull()
            expect(ChatId.fromUserInput('SMS;+1234567890').extractRecipient()).toBeNull()
        })

        test('should return null for group chatIds', () => {
            expect(ChatId.fromUserInput('iMessage;+;chat687179757169191512').extractRecipient()).toBeNull()
            expect(ChatId.fromUserInput('chat61321855167474084').extractRecipient()).toBeNull()
        })

        test('should return null for bare recipients (no semicolons)', () => {
            expect(ChatId.fromUserInput('+1234567890').extractRecipient()).toBeNull()
            expect(ChatId.fromUserInput('user@example.com').extractRecipient()).toBeNull()
        })
    })

    // -------------------- Method: validate --------------------
    describe('validate', () => {
        test('should accept bare group GUID (≥ 8 chars)', () => {
            expect(() => ChatId.fromUserInput('chat61321855167474084').validate()).not.toThrow()
            expect(() => ChatId.fromUserInput('chat45e2b868ce1e43da89af262922733382').validate()).not.toThrow()
        })

        test('should accept service;+;guid format', () => {
            expect(() => ChatId.fromUserInput('iMessage;+;chat61321855167474084').validate()).not.toThrow()
            expect(() => ChatId.fromUserInput('any;+;chat687179757169191512').validate()).not.toThrow()
        })

        test('should accept service;-;address format', () => {
            expect(() => ChatId.fromUserInput('any;-;+1234567890').validate()).not.toThrow()
            expect(() => ChatId.fromUserInput('iMessage;-;user@example.com').validate()).not.toThrow()
        })

        test('should reject legacy service;address format (no recognized separator)', () => {
            // Legacy 2-part format has semicolons but not ;+; or ;-; separators,
            // so validate() rejects them as malformed
            expect(() => ChatId.fromUserInput('iMessage;+1234567890').validate()).toThrow('Malformed chat id')
            expect(() => ChatId.fromUserInput('SMS;+1234567890').validate()).toThrow('Malformed chat id')
            expect(() => ChatId.fromUserInput('any;+1234567890').validate()).toThrow('Malformed chat id')
        })

        // --- macOS Tahoe chatId format ---
        test('should accept macOS Tahoe group chatId format', () => {
            expect(() =>
                ChatId.fromUserInput('iMessage;+;chat45e2b868ce1e43da89af262922733382').validate()
            ).not.toThrow()
        })

        // --- Rejection cases ---
        test('should reject empty string', () => {
            expect(() => ChatId.fromUserInput('').validate()).toThrow('ChatId cannot be empty')
        })

        test('should accept any non-empty semicolon-free bare string', () => {
            // No length pre-flight — defer to the database / Messages.app to reject
            // unknown identifiers with their authoritative error.
            expect(() => ChatId.fromUserInput('invalid').validate()).not.toThrow()
            expect(() => ChatId.fromUserInput('iMessage;+;chat123').validate()).not.toThrow()
        })

        test('should accept future service prefixes when using 3-part format', () => {
            // 2-part legacy format with semicolons is rejected as malformed
            expect(() => ChatId.fromUserInput('FutureService;+1234567890').validate()).toThrow('Malformed chat id')
            // 3-part formats are accepted
            expect(() => ChatId.fromUserInput('FutureService;-;+1234567890').validate()).not.toThrow()
            expect(() => ChatId.fromUserInput('FutureService;+;chat61321855167474084').validate()).not.toThrow()
        })

        test('should reject invalid service prefix tokens', () => {
            expect(() => ChatId.fromUserInput('bad prefix;+1234567890').validate()).toThrow('Malformed chat id')
        })

        test('should reject incomplete formats', () => {
            expect(() => ChatId.fromUserInput('iMessage;').validate()).toThrow('Malformed chat id')
            expect(() => ChatId.fromUserInput('any;-;').validate()).toThrow('Malformed chat id')
            expect(() => ChatId.fromUserInput('iMessage;+;').validate()).toThrow('Malformed chat id')
        })

        test('should reject invalid service prefix tokens in 3-part formats', () => {
            expect(() => ChatId.fromUserInput('bad prefix;-;+1234567890').validate()).toThrow('Malformed chat id')
            expect(() => ChatId.fromUserInput(';+;chat61321855167474084').validate()).toThrow('Malformed chat id')
        })

        test('should reject unrecognized semicolon patterns', () => {
            expect(() => ChatId.fromUserInput('a;b;c').validate()).toThrow('Malformed chat id')
        })
    })

    // -------------------- Method: buildGroupGuid --------------------
    describe('buildGroupGuid', () => {
        test('should build with "any" prefix (macOS 14+)', () => {
            const id = ChatId.fromUserInput('chat61321855167474084')
            expect(id.buildGroupGuid('any')).toBe('any;+;chat61321855167474084')
        })

        test('should build with "iMessage" prefix (legacy)', () => {
            const id = ChatId.fromUserInput('chat61321855167474084')
            expect(id.buildGroupGuid('iMessage')).toBe('iMessage;+;chat61321855167474084')
        })

        test('should re-prefix from any to iMessage', () => {
            const id = ChatId.fromUserInput('any;+;chat687179757169191512')
            expect(id.buildGroupGuid('iMessage')).toBe('iMessage;+;chat687179757169191512')
        })

        test('should re-prefix from iMessage to any', () => {
            const id = ChatId.fromUserInput('iMessage;+;chat687179757169191512')
            expect(id.buildGroupGuid('any')).toBe('any;+;chat687179757169191512')
        })

        test('should preserve chat prefix in UUID-style guids', () => {
            const id = ChatId.fromUserInput('chat45e2b868ce1e43da89af262922733382')
            expect(id.buildGroupGuid('any')).toBe('any;+;chat45e2b868ce1e43da89af262922733382')
        })

        test('should preserve existing prefix when it matches', () => {
            const id = ChatId.fromUserInput('any;+;chat613218')
            expect(id.buildGroupGuid('any')).toBe('any;+;chat613218')
        })
    })

    // -------------------- Method: toString --------------------
    describe('toString', () => {
        test('should return raw string', () => {
            const id = ChatId.fromUserInput('iMessage;+;chat613218')
            expect(id.toString()).toBe('iMessage;+;chat613218')
            expect(`${id}`).toBe('iMessage;+;chat613218')
        })
    })
})

// ============================================================
// resolveTarget
// ============================================================
describe('resolveTarget', () => {
    test('should resolve bare phone number as recipient', () => {
        const target = resolveTarget('+1234567890')
        expect(target.kind).toBe('dm')
        if (target.kind === 'dm') {
            expect(target.recipient).toBe('+1234567890')
        }
    })

    test('should resolve bare email as recipient', () => {
        const target = resolveTarget('user@example.com')
        expect(target.kind).toBe('dm')
        if (target.kind === 'dm') {
            expect(target.recipient).toBe('user@example.com')
        }
    })

    test('should resolve bare group GUID as group', () => {
        const target = resolveTarget('chat61321855167474084')
        expect(target.kind).toBe('group')
        if (target.kind === 'group') {
            expect(target.chatId.isGroup).toBe(true)
            expect(target.chatId.raw).toBe('chat61321855167474084')
        }
    })

    test('should resolve service-prefixed group as group', () => {
        const target = resolveTarget('iMessage;+;chat687179757169191512')
        expect(target.kind).toBe('group')
        if (target.kind === 'group') {
            expect(target.chatId.isGroup).toBe(true)
        }
    })

    test('should resolve service-prefixed DM as recipient', () => {
        const target = resolveTarget('iMessage;-;+1234567890')
        expect(target.kind).toBe('dm')
        if (target.kind === 'dm') {
            expect(target.recipient).toBe('+1234567890')
        }
    })

    test('should pass bare non-address strings through as DM for Messages.app to reject', () => {
        // No local recipient-shape validation — Messages.app is the source of truth
        const target = resolveTarget('some-arbitrary-string-long-enough')
        expect(target.kind).toBe('dm')
        if (target.kind === 'dm') {
            expect(target.recipient).toBe('some-arbitrary-string-long-enough')
        }
    })

    test('should throw for empty string', () => {
        expect(() => resolveTarget('')).toThrow(IMessageError)
    })

    test('should throw for whitespace-only inputs', () => {
        // Whitespace-only trims to empty → throws
        expect(() => resolveTarget('   ')).toThrow(IMessageError)
    })

    test('should throw for malformed semicolon formats', () => {
        // Has semicolons but not `;+;` or `;-;` with a valid prefix/suffix
        expect(() => resolveTarget('iMessage;+')).toThrow('Malformed chat id')
        expect(() => resolveTarget('iMessage;user@example.com')).toThrow('Malformed chat id')
        expect(() => resolveTarget('abc;def')).toThrow('Malformed chat id')
        expect(() => resolveTarget('a;b;c')).toThrow('Malformed chat id')
    })
})

// ============================================================
// buildSendScript (unified generator)
// ============================================================
describe('buildSendScript', () => {
    test('buddy + text only', () => {
        const script = buildSendScript({
            method: 'buddy',
            identifier: '+1234567890',
            text: 'Hello',
        })
        expect(script).toContain('set targetService to 1st service whose service type = iMessage')
        expect(script).toContain('set targetBuddy to buddy "+1234567890" of targetService')
        expect(script).toContain('send "Hello" to targetBuddy')
        expect(script).not.toContain('targetChat')
    })

    test('chat + text only', () => {
        const script = buildSendScript({
            method: 'chat',
            identifier: 'iMessage;+;chat613218',
            text: 'Hello',
        })
        expect(script).toContain('set targetChat to chat id "iMessage;+;chat613218"')
        expect(script).toContain('send "Hello" to targetChat')
        expect(script).not.toContain('targetBuddy')
    })

    test('buddy + attachment only (sandbox bypass)', () => {
        const script = buildSendScript({
            method: 'buddy',
            identifier: '+1234567890',
            attachment: attachmentFor('/tmp/test.jpg'),
        })
        expect(script).toContain('mktemp')
        expect(script).toContain('send theFile to targetBuddy')
    })

    test('chat + attachment only (direct send in Pictures)', () => {
        const picturesPath = join(homedir(), 'Pictures', 'photo.jpg')
        const script = buildSendScript({
            method: 'chat',
            identifier: 'iMessage;+;chat613218',
            attachment: attachmentFor(picturesPath),
        })
        expect(script).toContain('send POSIX file')
        expect(script).toContain('to targetChat')
        expect(script).not.toContain('mktemp')
    })

    test('buddy + text + attachment', () => {
        const downloadsPath = join(homedir(), 'Downloads', 'file.pdf')
        const script = buildSendScript({
            method: 'buddy',
            identifier: 'user@example.com',
            text: 'Check this out',
            attachment: attachmentFor(downloadsPath),
        })
        expect(script).toContain('send "Check this out" to targetBuddy')
        expect(script).toContain('send POSIX file')
    })

    test('should escape special characters in identifier', () => {
        const script = buildSendScript({
            method: 'buddy',
            identifier: 'user"test@example.com',
            text: 'Hello',
        })
        expect(script).toContain('buddy "user\\"test@example.com"')
    })

    test('should escape special characters in text', () => {
        const script = buildSendScript({
            method: 'buddy',
            identifier: '+1234567890',
            text: 'Line1\nLine2\twith "quotes"',
        })
        expect(script).toContain('\\n')
        expect(script).toContain('\\t')
        expect(script).toContain('\\"quotes\\"')
    })
})
