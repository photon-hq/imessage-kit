/**
 * applescript-transport — osascript execution + MessagesAppProbe.
 *
 * Behavioural tests against the real `/usr/bin/osascript` binary and the
 * real `pgrep`. We don't mock the subprocess — the whole value of this
 * module is how it handles stdin, signals, stderr, and timeouts, and those
 * behaviours only manifest in a real child process.
 *
 * Skipped on non-darwin since `osascript` is macOS-only.
 */

import { describe, expect, it } from 'bun:test'
import { platform } from 'node:os'

import { execAppleScript, MessagesAppProbe } from '../src/infra/outgoing/applescript-transport'

const isDarwin = platform() === 'darwin'
const d = isDarwin ? describe : describe.skip

d('execAppleScript — happy path', () => {
    it('returns stdout text from a successful script', async () => {
        const result = await execAppleScript('return "hello"')
        expect(result).toBe('hello')
    })

    it('trims trailing whitespace from osascript output', async () => {
        const result = await execAppleScript('return "padded   "')
        expect(result).toBe('padded')
    })

    it('handles multi-line scripts via stdin without shell escaping', async () => {
        // Stdin transport means even single quotes and shell metacharacters
        // in the script must not break execution.
        const script = 'set x to "hi; rm -rf / # no effect"\nreturn x'
        const result = await execAppleScript(script)
        expect(result).toBe('hi; rm -rf / # no effect')
    })
})

d('execAppleScript — error mapping', () => {
    it('maps "Can\'t get buddy" stderr to a recipient-not-found message', async () => {
        // Synthesise the exact stderr phrase so the includes() heuristic triggers.
        const script = 'error "Can\'t get buddy notfound" number 1728'
        await expect(execAppleScript(script)).rejects.toThrow(/Recipient not found/)
    })

    it('maps "Can\'t send" stderr to a send-failure hint', async () => {
        const script = 'error "Can\'t send this thing" number 1'
        await expect(execAppleScript(script)).rejects.toThrow(/Send failed/)
    })

    it('wraps any other execution error in a generic "AppleScript execution failed"', async () => {
        const script = 'error "something totally different" number 42'
        await expect(execAppleScript(script)).rejects.toThrow(/AppleScript execution failed/)
    })

    it('preserves the original error as `cause` for debuggability', async () => {
        const script = 'error "something totally different" number 42'
        try {
            await execAppleScript(script)
            throw new Error('expected throw')
        } catch (err) {
            expect((err as Error).cause).toBeInstanceOf(Error)
            expect(((err as Error).cause as Error).message).toContain('something totally different')
        }
    })
})

d('execAppleScript — abort and timeout', () => {
    it('rejects immediately when the signal is already aborted before spawn', async () => {
        const ac = new AbortController()
        ac.abort()
        await expect(execAppleScript('return "never"', { signal: ac.signal })).rejects.toThrow(/aborted/)
    })

    it('aborts an in-flight script when the signal fires mid-run', async () => {
        const ac = new AbortController()
        // Long-running script (60s) will be killed well before it completes.
        const promise = execAppleScript('delay 60\nreturn "done"', { signal: ac.signal, timeout: 120_000 })
        setTimeout(() => ac.abort(), 30)
        await expect(promise).rejects.toThrow(/aborted/)
    })

    it('maps timeout kill to a timeout-specific error', async () => {
        // 50ms timeout but the script sleeps 10s — osascript gets SIGTERM'd.
        await expect(execAppleScript('delay 10\nreturn "done"', { timeout: 50 })).rejects.toThrow(/timeout/)
    })
})

d('execAppleScript — debug option', () => {
    it('logs script and success output when debug=true', async () => {
        const lines: string[] = []
        const originalLog = console.log
        console.log = (...args: unknown[]) => {
            lines.push(args.map(String).join(' '))
        }

        try {
            const result = await execAppleScript('return "dbg"', { debug: true })
            expect(result).toBe('dbg')
        } finally {
            console.log = originalLog
        }

        expect(lines.some((line) => line.includes('[AppleScript] Executing script'))).toBe(true)
        expect(lines.some((line) => line.includes('[AppleScript] Success'))).toBe(true)
    })

    it('does not log anything when debug is omitted', async () => {
        const lines: string[] = []
        const originalLog = console.log
        console.log = (...args: unknown[]) => {
            lines.push(args.map(String).join(' '))
        }

        try {
            await execAppleScript('return "quiet"')
        } finally {
            console.log = originalLog
        }

        expect(lines.some((line) => line.includes('[AppleScript]'))).toBe(false)
    })
})

d('MessagesAppProbe', () => {
    it('caches the probe result across rapid-succession calls', async () => {
        const probe = new MessagesAppProbe()
        const first = await probe.isRunning()
        const second = await probe.isRunning()
        // Regardless of whether Messages is running, both calls must agree
        // within the cache TTL.
        expect(first).toBe(second)
    })

    it('returns a boolean without throwing when pgrep is available', async () => {
        const probe = new MessagesAppProbe()
        const result = await probe.isRunning()
        expect(typeof result).toBe('boolean')
    })
})
