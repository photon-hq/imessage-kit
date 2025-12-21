/**
 * Temp File Security Tests
 *
 * Tests for Issue #31: Symlink/TOCTOU attack prevention
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { generateSendAttachmentScript, generateSendAttachmentToChat } from '../src/utils/applescript'

describe('Security: Temp File Symlink/TOCTOU Protection', () => {
    // ------------------------------------------------------------
    // AppleScript: Atomic temp file creation
    // ------------------------------------------------------------
    describe('AppleScript sandbox bypass uses atomic mktemp', () => {
        test('generateSendAttachmentScript should use mktemp for atomic creation', () => {
            const { script } = generateSendAttachmentScript('user@example.com', '/tmp/test.jpg')

            // Must use mktemp for atomic file creation
            expect(script).toContain('mktemp')

            // Must NOT use predictable Date.now() pattern
            expect(script).not.toMatch(/imsg_temp_\d+/)

            // Must NOT use cp command (can follow symlinks)
            expect(script).not.toContain('"cp "')

            // Must use cat for safe file copy
            expect(script).toContain('cat ')

            // Must set restrictive permissions
            expect(script).toContain('chmod 600')
        })

        test('generateSendAttachmentToChat should use mktemp for atomic creation', () => {
            const { script } = generateSendAttachmentToChat('iMessage;-;+1234567890', '/tmp/test.jpg')

            expect(script).toContain('mktemp')
            expect(script).not.toMatch(/imsg_temp_\d+/)
            expect(script).not.toContain('"cp "')
            expect(script).toContain('cat ')
            expect(script).toContain('chmod 600')
        })
    })

    // ------------------------------------------------------------
    // TempFileManager: Symlink-safe cleanup
    // ------------------------------------------------------------
    describe('TempFileManager uses lstatSync for symlink detection', () => {
        test('temp-file-manager.ts should use lstatSync instead of statSync', () => {
            const source = readFileSync(new URL('../src/utils/temp-file-manager.ts', import.meta.url), 'utf-8')

            // Must import and use lstatSync (does not follow symlinks)
            expect(source).toContain('lstatSync')
            expect(source).toMatch(/lstatSync\(filePath\)/)

            // Must NOT import statSync (follows symlinks)
            // Note: We check the import line specifically since lstatSync contains 'statSync'
            expect(source).not.toMatch(/import.*\bstatSync\b/)
        })

        test('cleanup should check for non-regular files before unlinking', () => {
            const source = readFileSync(new URL('../src/utils/temp-file-manager.ts', import.meta.url), 'utf-8')

            // Must check isFile() before deleting (catches symlinks, dirs, devices, etc.)
            expect(source).toContain('isFile()')

            // Must use lstatSync (already verified in previous test)
            expect(source).toContain('lstatSync')
        })
    })

    // ------------------------------------------------------------
    // Download: Crypto-random filenames with exclusive writes
    // ------------------------------------------------------------
    describe('Download uses crypto-random filenames', () => {
        test('download.ts should use randomBytes for unpredictable filenames', () => {
            const source = readFileSync(new URL('../src/utils/download.ts', import.meta.url), 'utf-8')

            // Must use crypto randomBytes
            expect(source).toContain("import { randomBytes } from 'node:crypto'")
            expect(source).toContain('randomBytes(8)')
        })

        test('download.ts should use exclusive write flag', () => {
            const source = readFileSync(new URL('../src/utils/download.ts', import.meta.url), 'utf-8')

            // Must use 'wx' flag (exclusive write - fails if file exists)
            expect(source).toContain("flag: 'wx'")

            // Must set restrictive permissions
            expect(source).toContain('mode: 0o600')
        })

        test('download.ts should NOT use predictable Date.now() filenames', () => {
            const source = readFileSync(new URL('../src/utils/download.ts', import.meta.url), 'utf-8')

            // Must NOT use Date.now() for temp filenames
            expect(source).not.toMatch(/imsg_temp_\$\{Date\.now\(\)\}/)
        })
    })
})
