/**
 * MessageSender — send pipeline contracts.
 *
 * Covered:
 *   - `SendPort.send` rejects URL attachments with an IMessageError (SEND code)
 *   - Missing attachment files surface ENOENT through SendError, cause preserved
 *   - MessagesApp-not-running short-circuits BEFORE any osascript spawn
 *   - Multi-attachment dispatch: first step carries text, later steps are
 *     numbered "attachment i/N" in the failure message
 *   - Retry respects the configured attempt count before giving up
 *   - Semaphore serialises concurrent sends when `limit = 1`
 *   - AbortSignal fired before the task runs surfaces as a wrapped SendError
 *   - AbortSignal fired during retry causes the retry loop to stop
 *
 * The AppleScript transport is mocked — behaviour under test is the
 * orchestration, not the subprocess wrapper (which has its own tests).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IMessageError } from '../src/domain/errors'
import { Semaphore } from '../src/utils/async'

// -----------------------------------------------
// Transport stub
// -----------------------------------------------

type ExecStub = (script: string, options?: { signal?: AbortSignal }) => Promise<string>

let execStub: ExecStub = async () => ''
let isRunningStub: () => Promise<boolean> = async () => true
const execCalls: Array<{ script: string; signalAborted: boolean }> = []

mock.module('../src/infra/outgoing/applescript-transport', () => ({
    execAppleScript: async (script: string, options?: { signal?: AbortSignal }) => {
        execCalls.push({ script, signalAborted: options?.signal?.aborted ?? false })
        return execStub(script, options)
    },
    MessagesAppProbe: class {
        async isRunning() {
            return isRunningStub()
        }
    },
}))

// Platform — fresh stub so `detectChatServicePrefix` has a predictable value.
mock.module('../src/infra/platform', () => ({
    detectChatServicePrefix: () => 'iMessage',
    requireMacOS: () => {},
    getDefaultDatabasePath: () => '/tmp/mock.db',
    getDarwinMajorVersion: () => 24,
}))

beforeEach(() => {
    execStub = async () => ''
    isRunningStub = async () => true
    execCalls.length = 0
})

afterEach(() => {
    execCalls.length = 0
})

// -----------------------------------------------
// Helpers
// -----------------------------------------------

async function makeSender(opts: Record<string, unknown> = {}) {
    const { MessageSender } = await import('../src/infra/outgoing/sender')
    return new MessageSender({ retryDelay: 1, ...opts })
}

function writeTempFile(name: string, contents = 'x'): string {
    const p = join(tmpdir(), `sender-test-${process.pid}-${Date.now()}-${Math.random()}-${name}`)
    writeFileSync(p, contents)
    return p
}

// -----------------------------------------------
// Validation
// -----------------------------------------------

describe('MessageSender — input validation', () => {
    it('rejects http:// URL attachments with a SEND-coded IMessageError', async () => {
        const sender = await makeSender()
        try {
            await sender.send({ to: '+1234567890', attachments: ['https://example.com/x.jpg'] })
            throw new Error('expected throw')
        } catch (err) {
            expect(err).toBeInstanceOf(IMessageError)
            expect((err as InstanceType<typeof IMessageError>).code).toBe('SEND')
            expect((err as Error).message).toMatch(/URLs are not supported/)
        }
    })

    it('wraps ENOENT as SendError and preserves the cause', async () => {
        const sender = await makeSender()
        const missing = join(tmpdir(), `does-not-exist-${Date.now()}.bin`)
        try {
            await sender.send({ to: '+1234567890', attachments: [missing] })
            throw new Error('expected throw')
        } catch (err) {
            expect(err).toBeInstanceOf(IMessageError)
            expect((err as InstanceType<typeof IMessageError>).code).toBe('SEND')
            expect((err as Error).message).toMatch(/Attachment unreadable/)
            const cause = (err as Error).cause as Error | undefined
            expect(cause).toBeInstanceOf(Error)
            expect(cause?.message).toMatch(/ENOENT/)
        }
    })

    it('short-circuits with "Messages app is not running" BEFORE spawning osascript', async () => {
        isRunningStub = async () => false
        const sender = await makeSender()
        await expect(sender.send({ to: '+1234567890', text: 'hi' })).rejects.toThrow(/Messages app is not running/)
        expect(execCalls).toHaveLength(0)
    })
})

// -----------------------------------------------
// Multi-attachment labeling
// -----------------------------------------------

describe('MessageSender — multi-attachment dispatch', () => {
    it('labels a mid-batch failure with the step index (e.g. "attachment 2/3")', async () => {
        const a1 = writeTempFile('a1.txt')
        const a2 = writeTempFile('a2.txt')
        const a3 = writeTempFile('a3.txt')

        let call = 0
        execStub = async () => {
            call += 1
            // First step (text+attachment1) succeeds; step 2 explodes.
            if (call >= 2) throw new Error('boom')
            return ''
        }

        const sender = await makeSender({ retryAttempts: 1 })
        try {
            await sender.send({ to: '+1234567890', text: 'hi', attachments: [a1, a2, a3] })
            throw new Error('expected throw')
        } catch (err) {
            expect((err as Error).message).toMatch(/attachment 2\/3/)
            expect((err as Error).message).toMatch(/boom/)
        }
    })

    it('labels the first step "text + attachment 1/N" when both are present', async () => {
        const a = writeTempFile('a.txt')
        execStub = async () => {
            throw new Error('early fail')
        }
        const sender = await makeSender({ retryAttempts: 1 })
        try {
            await sender.send({ to: '+1234567890', text: 'hi', attachments: [a] })
            throw new Error('expected throw')
        } catch (err) {
            expect((err as Error).message).toMatch(/text \+ attachment 1\/1/)
        }
    })
})

// -----------------------------------------------
// Retry
// -----------------------------------------------

describe('MessageSender — retry', () => {
    it('retries up to N times and then reports "failed after N attempts"', async () => {
        let call = 0
        execStub = async () => {
            call += 1
            throw new Error(`attempt ${call}`)
        }

        const sender = await makeSender({ retryAttempts: 3 })
        try {
            await sender.send({ to: '+1234567890', text: 'hi' })
            throw new Error('expected throw')
        } catch (err) {
            expect((err as Error).message).toMatch(/failed after 3 attempts/)
        }
        expect(call).toBe(3)
    })

    it('resolves when a later retry attempt succeeds', async () => {
        let call = 0
        execStub = async () => {
            call += 1
            if (call < 3) throw new Error('transient')
            return ''
        }

        const sender = await makeSender({ retryAttempts: 3 })
        await expect(sender.send({ to: '+1234567890', text: 'hi' })).resolves.toBeUndefined()
        expect(call).toBe(3)
    })
})

// -----------------------------------------------
// Semaphore
// -----------------------------------------------

describe('MessageSender — semaphore', () => {
    it('serialises concurrent sends under a limit=1 semaphore', async () => {
        let inFlight = 0
        let maxInFlight = 0
        execStub = async () => {
            inFlight += 1
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise((r) => setTimeout(r, 20))
            inFlight -= 1
            return ''
        }

        const sender = await makeSender({ semaphore: new Semaphore(1), retryAttempts: 1 })
        await Promise.all([
            sender.send({ to: '+1111111111', text: 'one' }),
            sender.send({ to: '+2222222222', text: 'two' }),
            sender.send({ to: '+3333333333', text: 'three' }),
        ])

        expect(maxInFlight).toBe(1)
    })
})

// -----------------------------------------------
// Routing (DM vs group)
// -----------------------------------------------

describe('MessageSender — inter-attachment pacing', () => {
    it('waits ~500ms between each attachment dispatch', async () => {
        const a1 = writeTempFile('a1.txt')
        const a2 = writeTempFile('a2.txt')
        const timestamps: number[] = []
        execStub = async () => {
            timestamps.push(Date.now())
            return ''
        }

        const sender = await makeSender({ retryAttempts: 1 })
        await sender.send({ to: '+1234567890', text: 'hi', attachments: [a1, a2] })

        expect(timestamps).toHaveLength(2)
        // INTER_ATTACHMENT_DELAY_MS is 500 — allow a small floor for timer drift.
        const gap = timestamps[1]! - timestamps[0]!
        expect(gap).toBeGreaterThanOrEqual(450)
    })
})

describe('MessageSender — routing', () => {
    it('uses the chat method with a group chat GUID identifier for group targets', async () => {
        execStub = async () => ''
        const sender = await makeSender({ retryAttempts: 1 })
        await sender.send({ to: 'chatABC123', text: 'hi group' })

        expect(execCalls).toHaveLength(1)
        // buildSendScript emits `send … to chat id "iMessage;+;chatABC123"` for the chat method.
        const script = execCalls[0]!.script
        expect(script).toMatch(/chat id "iMessage;\+;chatABC123"/)
    })

    it('uses the buddy method with the raw recipient for DM targets', async () => {
        execStub = async () => ''
        const sender = await makeSender({ retryAttempts: 1 })
        await sender.send({ to: '+1234567890', text: 'hi dm' })

        expect(execCalls).toHaveLength(1)
        const script = execCalls[0]!.script
        // Buddy path must NOT reference a chat id.
        expect(script).not.toMatch(/chat id /)
        expect(script).toContain('+1234567890')
    })
})

// -----------------------------------------------
// Timeout / debug propagation
// -----------------------------------------------

describe('MessageSender — options propagation', () => {
    it('propagates timeout and debug flags into every execAppleScript invocation', async () => {
        // Capture the options the sender passes down to the transport.
        const observedOptions: Array<Record<string, unknown>> = []
        const { MessageSender } = await import('../src/infra/outgoing/sender')

        // Shadow the module mock with a direct transport spy by wrapping execStub.
        execStub = async () => ''
        const originalMock = execCalls.slice()
        void originalMock

        // The module-level mock already forwards `options` to execStub — add a tap.
        const sender = new MessageSender({ retryAttempts: 1, retryDelay: 1, debug: true, timeout: 1234 })
        // Re-wire execStub to capture options passed from sender → transport mock.
        execStub = async (_script, options) => {
            observedOptions.push({ ...(options as object) })
            return ''
        }

        await sender.send({ to: '+1234567890', text: 'hi' })

        expect(observedOptions).toHaveLength(1)
        expect(observedOptions[0]?.debug).toBe(true)
        expect(observedOptions[0]?.timeout).toBe(1234)
    })
})

// -----------------------------------------------
// Abort
// -----------------------------------------------

describe('MessageSender — abort', () => {
    it('aborts queued sends with a SEND-coded IMessageError when the signal fires before the task runs', async () => {
        const sem = new Semaphore(1)
        let releaseFirst: () => void = () => {}
        // Occupy the single slot with a promise we control.
        void sem.run(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirst = resolve
                })
        )

        const ac = new AbortController()
        const sender = await makeSender({ semaphore: sem, signal: ac.signal, retryAttempts: 1 })

        const pending = sender.send({ to: '+1234567890', text: 'hi' }).catch((e) => e)
        // Give the send a chance to queue on the semaphore.
        await new Promise((r) => setTimeout(r, 10))
        ac.abort()
        releaseFirst()

        const err = await pending
        expect(err).toBeInstanceOf(IMessageError)
        expect((err as InstanceType<typeof IMessageError>).code).toBe('SEND')
    })

    it('stops retrying once the signal fires mid-loop', async () => {
        let call = 0
        const ac = new AbortController()
        execStub = async () => {
            call += 1
            if (call === 1) {
                // Fire the abort AFTER the first failure, before the next attempt.
                queueMicrotask(() => ac.abort())
            }
            throw new Error('boom')
        }

        const sender = await makeSender({ signal: ac.signal, retryAttempts: 5, retryDelay: 10 })
        await expect(sender.send({ to: '+1234567890', text: 'hi' })).rejects.toThrow(/Send/)
        // First attempt ran; the retry loop is aborted before attempt 5.
        expect(call).toBeLessThan(5)
    })
})
