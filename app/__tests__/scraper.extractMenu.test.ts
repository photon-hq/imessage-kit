import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractBamcoBlob } from '../src/scraper/extractBamcoBlob'
import { extractMenu, type GeminiClient } from '../src/scraper/extractMenu'
import type { VenueMenu } from '../src/scraper/types'

function fakeClient(response: Omit<VenueMenu, 'venueId' | 'venueName' | 'date' | 'fetchedAt'>): GeminiClient {
    return {
        async extract(_blob, _hints) {
            return response
        },
    }
}

describe('extractMenu', () => {
    it('wraps the Gemini response into a VenueMenu', async () => {
        const client = fakeClient({
            dayparts: [
                {
                    label: 'Lunch',
                    startIso: '2026-04-24T15:00:00Z',
                    endIso: '2026-04-24T19:00:00Z',
                    stations: [
                        {
                            name: 'Grill',
                            items: [{ name: 'Cheeseburger', tags: [] }],
                        },
                    ],
                },
            ],
        })

        const blob = '{}'
        const menu = await extractMenu(blob, {
            venueId: '1920-commons',
            venueName: '1920 Commons',
            date: '2026-04-24',
            client,
        })

        expect(menu.venueId).toBe('1920-commons')
        expect(menu.venueName).toBe('1920 Commons')
        expect(menu.date).toBe('2026-04-24')
        expect(menu.dayparts).toHaveLength(1)
        expect(menu.dayparts[0]?.stations[0]?.items[0]?.name).toBe('Cheeseburger')
        expect(new Date(menu.fetchedAt).toString()).not.toBe('Invalid Date')
    })

    it('parses a real fixture end-to-end with a stub that echoes the blob length', async () => {
        const html = readFileSync(
            join(import.meta.dir, 'fixtures/bonappetit/1920-commons-2026-04-24.html'),
            'utf8'
        )
        const blob = extractBamcoBlob(html)!

        let capturedBlobLen = 0
        const client: GeminiClient = {
            async extract(b, _hints) {
                capturedBlobLen = b.length
                return { dayparts: [] }
            },
        }

        const menu = await extractMenu(blob, {
            venueId: '1920-commons',
            venueName: '1920 Commons',
            date: '2026-04-24',
            client,
        })

        expect(capturedBlobLen).toBeGreaterThan(100)
        expect(menu.dayparts).toEqual([])
    })
})
