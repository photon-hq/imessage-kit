/**
 * TempFileManager — symlink / TOCTOU behaviour.
 *
 * This module sweeps expired entries under `~/Pictures/imsg_temp_*`. The
 * security-sensitive property is that cleanup never follows a symlink to
 * stat or unlink its target — otherwise an attacker who can plant entries
 * in that directory could coerce the SDK process into deleting arbitrary
 * user files.
 *
 * The manager hard-codes `join(homedir(), 'Pictures')` at module-load
 * time, so a mid-run mock of `homedir()` is too late. These tests use the
 * real directory and only touch entries with the `imsg_temp_` prefix
 * (which is exclusively ours), isolated by a unique per-run suffix.
 * Every planted entry is removed in `afterEach`, including on failure.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
    existsSync,
    lutimesSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { TempFileManager } from '../src/infra/outgoing/temp-files'

const PREFIX = 'imsg_temp_'
const REAL_TEMP_DIR = join(homedir(), 'Pictures')

// Unique per-run suffix so concurrent test runs can't collide.
const RUN_ID = `test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// Track every path we plant so afterEach can sweep them even if a test throws.
const planted: string[] = []

function plantEntry(name: string, create: (absPath: string) => void): string {
    const abs = join(REAL_TEMP_DIR, `${PREFIX}${RUN_ID}_${name}`)
    create(abs)
    planted.push(abs)
    return abs
}

function backdate(path: string, mtimeMsAgo: number): void {
    const now = Date.now() / 1000
    const target = now - mtimeMsAgo / 1000
    lutimesSync(path, target, target)
}

describe('TempFileManager — symlink / TOCTOU guard', () => {
    beforeEach(() => {
        if (!existsSync(REAL_TEMP_DIR)) mkdirSync(REAL_TEMP_DIR, { recursive: true })
    })

    afterEach(() => {
        while (planted.length > 0) {
            const p = planted.pop()!
            try {
                rmSync(p, { recursive: true, force: true })
            } catch {}
        }
    })

    it('deletes the symlink entry itself, never the target file it points at', async () => {
        // Sensitive target OUTSIDE Pictures — the file an attacker would
        // hope to get unlinked if cleanup followed the link.
        const sensitiveDir = mkdtempSync(join(tmpdir(), 'imessage-kit-sensitive-'))
        const sensitiveTarget = join(sensitiveDir, 'important.txt')
        writeFileSync(sensitiveTarget, 'precious')

        try {
            const plantedLink = plantEntry('symlink_attack', (p) => symlinkSync(sensitiveTarget, p))
            backdate(plantedLink, 60 * 60 * 1_000) // 1h old — well past 10m

            const manager = new TempFileManager({ maxAge: 10 * 60 * 1_000 })
            manager.start()
            await manager.destroy()

            expect(existsSync(plantedLink)).toBe(false)
            // Target must survive with contents intact.
            expect(existsSync(sensitiveTarget)).toBe(true)
            expect(readFileSync(sensitiveTarget, 'utf8')).toBe('precious')
        } finally {
            rmSync(sensitiveDir, { recursive: true, force: true })
        }
    })

    it('keeps fresh temp entries (mtime within maxAge) and deletes only expired ones', async () => {
        const fresh = plantEntry('fresh_dir', (p) => {
            mkdirSync(p)
            writeFileSync(join(p, 'payload'), 'fresh')
        })
        const expired = plantEntry('expired_dir', (p) => {
            mkdirSync(p)
            writeFileSync(join(p, 'payload'), 'expired')
        })
        backdate(fresh, 1_000) // 1s
        backdate(expired, 60 * 60 * 1_000) // 1h

        const manager = new TempFileManager({ maxAge: 10 * 60 * 1_000 })
        manager.start()
        await manager.destroy()

        expect(existsSync(fresh)).toBe(true)
        expect(existsSync(expired)).toBe(false)
    })

    it('ignores non-prefixed entries even when they are expired', async () => {
        // This planting bypasses plantEntry (non-standard name on purpose).
        const foreign = join(REAL_TEMP_DIR, `user_vacation_${RUN_ID}.jpg`)
        writeFileSync(foreign, 'user data')
        planted.push(foreign)
        backdate(foreign, 60 * 60 * 1_000)

        const manager = new TempFileManager({ maxAge: 10 * 60 * 1_000 })
        manager.start()
        await manager.destroy()

        expect(existsSync(foreign)).toBe(true)
    })

    it('start() after destroy() rejects with a ConfigError (prevents reuse)', async () => {
        const manager = new TempFileManager()
        manager.start()
        await manager.destroy()

        expect(() => manager.start()).toThrow(/destroyed/)
    })
})
