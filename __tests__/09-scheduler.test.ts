import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { IMessageSDK } from '../src/core/sdk'
import { createSpy, waitFor } from './setup'

// Mock platform to avoid macOS restriction during tests
mock.module('../src/utils/platform', () => ({
  requireMacOS: () => {},
  isMacOS: () => true,
  getDefaultDatabasePath: () => '/mock/path/chat.db',
}))

describe('Scheduler APIs', () => {
  let senderCalls: Array<{ chatId: string; text?: string; attachments?: string[] }>
  let sdk: IMessageSDK

  beforeEach(() => {
    senderCalls = []
    const dummyDb: any = { close: async () => {} }
    const mockSender: any = {
      sendToChat: async (opts: { chatId: string; text?: string; attachments?: string[] }) => {
        senderCalls.push({ chatId: opts.chatId, text: opts.text, attachments: opts.attachments || [] })
        return { sentAt: new Date() }
      },
    }

    sdk = new IMessageSDK({}, { sender: mockSender, database: dummyDb })
  })

  afterEach(async () => {
    await sdk.close()
  })

  it('schedules message to chat and sends at time', async () => {
    const runAt = new Date(Date.now() + 100)
    const id = sdk.scheduleToChat('iMessage;+15550001111', 'Scheduled hello', runAt)
    expect(typeof id).toBe('string')

    await waitFor(() => senderCalls.length === 1, 2000, 50)
    expect(senderCalls[0].chatId).toBe('iMessage;+15550001111')
    expect(senderCalls[0].text).toBe('Scheduled hello')
  })

  it('cancels scheduled task before sending', async () => {
    const runAt = new Date(Date.now() + 200)
    const id = sdk.scheduleToChat('iMessage;+15550002222', 'Will be cancelled', runAt)
    const cancelled = sdk.cancelScheduled(id)
    expect(cancelled).toBe(true)

    // Wait some time to ensure it would have fired if not cancelled
    await new Promise((r) => setTimeout(r, 300))
    expect(senderCalls.length).toBe(0)
  })

  it('lists and clears scheduled tasks', async () => {
    const t1 = sdk.scheduleToChat('iMessage;+15550003333', 'A', new Date(Date.now() + 2000))
    const t2 = sdk.scheduleToChat('chatGroupGuid123', { text: 'B', files: ['/tmp/file.pdf'] }, new Date(Date.now() + 2000))

    const listed = sdk.listScheduled()
    expect(listed.length).toBeGreaterThanOrEqual(2)

    const cleared = sdk.clearScheduled()
    expect(cleared).toBeGreaterThanOrEqual(2)
    expect(sdk.listScheduled().length).toBe(0)
  })

  it('schedule by recipient converts to chatId', async () => {
    const runAt = new Date(Date.now() + 100)
    sdk.schedule('+15550004444', 'By recipient', runAt)
    await waitFor(() => senderCalls.length === 1, 2000, 50)
    expect(senderCalls[0].chatId).toBe('iMessage;+15550004444')
  })
})