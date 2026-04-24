import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GeminiClient } from '../src/scraper/extractMenu'
import { getVenueMenu } from '../src/scraper'

const html = readFileSync(
    join(import.meta.dir, 'fixtures/bonappetit/1920-commons-2026-04-24.html'),
    'utf8'
)

describe('getVenueMenu', () => {
    it('composes fetch + extractBlob + extractMenu', async () => {
        const fetchStub = async () => new Response(html, { status: 200 })
        const client: GeminiClient = {
            async extract(blob, hints) {
                expect(blob.length).toBeGreaterThan(100)
                expect(hints.venueId).toBe('1920-commons')
                return {
                    dayparts: [
                        {
                            label: 'Lunch',
                            startIso: '2026-04-24T15:00:00Z',
                            endIso: '2026-04-24T19:00:00Z',
                            stations: [],
                        },
                    ],
                }
            },
        }

        const menu = await getVenueMenu('1920-commons', '2026-04-24', {
            client,
            fetchImpl: fetchStub as unknown as typeof fetch,
        })

        expect(menu.venueName).toBe('1920 Commons')
        expect(menu.dayparts).toHaveLength(1)
    })

    it('throws for unknown venue id', async () => {
        const client: GeminiClient = { async extract() { return { dayparts: [] } } }
        await expect(
            getVenueMenu('not-a-venue', '2026-04-24', { client })
        ).rejects.toThrow(/unknown venue/i)
    })

    it('returns an empty-dayparts menu if blob is missing', async () => {
        const fetchStub = async () => new Response('<html>no bamco</html>', { status: 200 })
        const client: GeminiClient = { async extract() { return { dayparts: [] } } }
        const menu = await getVenueMenu('1920-commons', '2026-04-24', {
            client,
            fetchImpl: fetchStub as unknown as typeof fetch,
        })
        expect(menu.dayparts).toEqual([])
    })
})
