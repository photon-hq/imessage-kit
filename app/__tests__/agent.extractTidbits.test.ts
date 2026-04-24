import { describe, expect, it } from 'bun:test'
import { extractTidbits, type TidbitGeminiClient } from '../src/agent/extractTidbits'
import type { MealEvent } from '../src/db/mealEvents'

const event: MealEvent = {
    id: 'x',
    handle: '+14155550123',
    scheduleId: 's1',
    mealKey: 'abc',
    venueId: 'hill-house',
    date: '2026-04-24',
    mealLabel: 'Dinner',
    startIso: '2026-04-24T22:30:00Z',
    endIso: '2026-04-25T01:30:00Z',
    preSentAt: '',
    postSentAt: '',
    userReply: '',
}

describe('extractTidbits', () => {
    it('forwards the user reply and event context to the client', async () => {
        let seenReply = ''
        const client: TidbitGeminiClient = {
            async extract(reply, _ev) {
                seenReply = reply
                return []
            },
        }
        await extractTidbits('pasta ok', event, client)
        expect(seenReply).toBe('pasta ok')
    })

    it('returns the client response as-is', async () => {
        const client: TidbitGeminiClient = {
            async extract() {
                return [
                    { item: 'pasta was fire', tags: ['positive', 'pasta'] },
                    { item: 'salad bar picked over', tags: ['negative', 'salad'] },
                ]
            },
        }
        const out = await extractTidbits('both', event, client)
        expect(out).toHaveLength(2)
        expect(out[0]?.item).toContain('pasta')
    })

    it('drops items with empty text', async () => {
        const client: TidbitGeminiClient = {
            async extract() {
                return [
                    { item: '', tags: [] },
                    { item: 'good', tags: ['positive'] },
                ]
            },
        }
        const out = await extractTidbits('whatever', event, client)
        expect(out).toHaveLength(1)
        expect(out[0]?.item).toBe('good')
    })
})
